const { logAdminActivity, summarizeBody } = require("../_shared/activityLog");
const { getTableClient } = require("../_shared/tableStorage");
const { loadSessionAndAccount, isSuperAdmin, accountPermissions } = require("../_shared/adminAuth");
const W = require("../_shared/work");

const STATUS_LABEL = { todo: "Cần làm", doing: "Đang làm", review: "Chờ duyệt", done: "Hoàn thành" };
// Thứ tự luồng Kanban chuẩn — dùng để chặn nhảy cóc (vd. Cần làm -> Hoàn thành thẳng).
const STATUS_ORDER = ["todo", "doing", "review", "done"];

// Tạo mới (không có id) hoặc cập nhật MỘT PHẦN (chỉ các trường gửi lên) một công việc.
// Tự ghi lịch sử thay đổi; khi hoàn thành việc có lặp lại -> tự tạo lần kế tiếp.
//
// LUỒNG WORKFLOW (áp dụng cho MỌI cách đổi trạng thái: kéo-thả, tick xong, sửa form — vì tất cả
// đều đi qua đúng 1 API này):
//  1. Chặn nhảy cóc quá 1 bước về phía trước (todo->doing->review->done), trừ khi người thực hiện
//     có quyền "work-manage" hoặc là Quản Trị Viên Chính — họ được quyền bỏ qua bước khi cần.
//  2. Việc đang bị MỘT việc khác (blockedBy) chặn và việc đó CHƯA xong thì không được chuyển sang
//     Hoàn thành (áp dụng cho tất cả, kể cả quản lý — đây là ràng buộc dữ liệu, không phải phân quyền).
//  3. Chuyển từ "Chờ duyệt" sang "Hoàn thành" CHỈ người có quyền "work-manage" / Quản Trị Viên Chính
//     mới làm được — đây là bước DUYỆT.
//  4. Lùi về phía sau (demote/mở lại) luôn được phép với bất kỳ ai, không bị chặn bởi 3 quy tắc trên.
// Tự động hoá: chuyển sang "Chờ duyệt" -> báo người tạo việc đi duyệt; bị trả lại từ "Chờ duyệt"
// hoặc được duyệt xong -> báo người phụ trách; việc Hoàn thành có việc khác đang chờ nó (blockedBy
// trỏ tới nó) -> báo người phụ trách việc kế tiếp là đã có thể bắt đầu.
module.exports = async function (context, req) {
  context.res = { headers: { "Content-Type": "application/json" } };
  const sess = await loadSessionAndAccount(context, req);
  if (!sess) return;
  const { session, account } = sess;
  const isManager = isSuperAdmin(account) || accountPermissions(account).includes("work-manage");

  const b = req.body || {};
  try {
    const who = { email: session.adminEmail || "", displayName: session.displayName || "Không rõ" };
    const table = await getTableClient(W.TASKS_TABLE);
    const now = new Date().toISOString();
    const isNew = !b.id;
    if (!isNew && !W.isId(b.id)) { context.res.status = 400; context.res.body = { success: false, message: "Mã công việc không hợp lệ." }; return; }

    let current = null;
    if (!isNew) {
      try { current = W.toTask(await table.getEntity("task", b.id)); }
      catch (e) { if (e.statusCode === 404) { context.res.status = 404; context.res.body = { success: false, message: "Công việc này không còn tồn tại." }; return; } throw e; }
    }

    const patch = {};
    const has = k => Object.prototype.hasOwnProperty.call(b, k);
    if (isNew || has("title")) {
      patch.title = W.clean(b.title, 200);
      if (!patch.title) { context.res.status = 400; context.res.body = { success: false, message: "Công việc cần có tên." }; return; }
    }
    if (has("description")) patch.description = W.clean(b.description, 5000);
    if (has("status") && W.STATUSES.includes(b.status)) {
      if (!isNew && current && b.status !== current.status) {
        const fromIdx = STATUS_ORDER.indexOf(current.status);
        const toIdx = STATUS_ORDER.indexOf(b.status);
        const isForward = toIdx > fromIdx;

        if (b.status === "done" && current.blockedBy) {
          try {
            const blocker = W.toTask(await table.getEntity("task", current.blockedBy));
            if (blocker.status !== "done") {
              context.res.status = 409;
              context.res.body = { success: false, message: `Việc này đang chờ "${blocker.title}" hoàn thành trước, chưa thể chuyển sang Hoàn thành.` };
              return;
            }
          } catch (e) { /* việc chặn không còn tồn tại -> bỏ qua ràng buộc */ }
        }

        if (isForward && toIdx - fromIdx > 1 && !isManager) {
          context.res.status = 409;
          context.res.body = { success: false, message: `Cần chuyển lần lượt qua từng bước — hiện đang ở "${STATUS_LABEL[current.status]}", chưa thể nhảy thẳng sang "${STATUS_LABEL[b.status]}".` };
          return;
        }
        if (isForward && current.status === "review" && b.status === "done" && !isManager) {
          context.res.status = 409;
          context.res.body = { success: false, message: "Cần người quản lý duyệt trước khi chuyển sang Hoàn thành." };
          return;
        }
      }
      patch.status = b.status;
    }
    if (has("priority") && W.PRIORITIES.includes(b.priority)) patch.priority = b.priority;
    if (has("dueDate")) patch.dueDate = W.cleanDate(b.dueDate);
    if (has("dueTime")) patch.dueTime = W.cleanTime(b.dueTime);
    if (has("projectId")) patch.projectId = W.isId(b.projectId) ? b.projectId : "";
    if (has("recurrence") && W.RECURRENCES.includes(b.recurrence)) patch.recurrence = b.recurrence;
    if (has("blockedBy")) patch.blockedBy = (b.blockedBy && W.isId(b.blockedBy) && b.blockedBy !== b.id) ? b.blockedBy : "";
    if (has("order")) patch.order = Number(b.order) || 0;
    if (has("assignees") && Array.isArray(b.assignees)) patch.assigneesJson = JSON.stringify(Array.from(new Set(b.assignees.map(x => W.clean(x, 120).toLowerCase()).filter(Boolean))).slice(0, 10));
    if (has("labels") && Array.isArray(b.labels)) patch.labelsJson = JSON.stringify(Array.from(new Set(b.labels.map(x => W.clean(x, 30)).filter(Boolean))).slice(0, 10));
    if (has("checklist") && Array.isArray(b.checklist)) patch.checklistJson = JSON.stringify(b.checklist.slice(0, 50).map(i => ({ id: W.isId(i.id) ? i.id : W.newId(), text: W.clean(i.text, 200), done: !!i.done })).filter(i => i.text));
    if (has("link")) patch.linkJson = b.link && typeof b.link === "object" ? JSON.stringify({ type: W.clean(b.link.type, 20), id: W.clean(b.link.id, 80), label: W.clean(b.link.label, 120), href: /^\/[A-Za-z0-9/_?=&#.-]*$/.test(b.link.href || "") ? b.link.href : "" }) : "";

    // Lịch sử thay đổi (giữ 30 dòng gần nhất)
    const history = current ? current.history.slice(-29) : [];
    const log = text => history.push({ at: now, by: who.displayName || who.email, text });
    if (isNew) log("Tạo công việc");
    else {
      if (patch.status && patch.status !== current.status) {
        log(`Chuyển sang "${STATUS_LABEL[patch.status]}"`);
        if (current.status === "review" && (patch.status === "doing" || patch.status === "todo") && W.clean(b.statusChangeNote, 500)) {
          log(`Lý do trả lại: ${W.clean(b.statusChangeNote, 500)}`);
        }
      }
      if (patch.assigneesJson && patch.assigneesJson !== JSON.stringify(current.assignees)) log("Cập nhật người phụ trách");
      if (has("dueDate") && patch.dueDate !== current.dueDate) log(patch.dueDate ? `Đổi hạn thành ${patch.dueDate.split("-").reverse().join("/")}` : "Bỏ hạn chót");
      if (patch.priority && patch.priority !== current.priority) log("Đổi mức ưu tiên");
    }
    patch.historyJson = JSON.stringify(history);
    patch.updatedAt = now;

    const becameDone = patch.status === "done" && (!current || current.status !== "done");
    if (becameDone) patch.completedAt = now;
    if (patch.status && patch.status !== "done" && current && current.status === "done") patch.completedAt = "";

    const id = isNew ? W.newId() : b.id;
    if (isNew) {
      Object.assign(patch, {
        status: patch.status || "todo", priority: patch.priority || "normal",
        assigneesJson: patch.assigneesJson || JSON.stringify(who.email ? [who.email] : []),
        createdBy: who.email, createdByName: who.displayName, createdAt: now,
        order: has("order") ? patch.order : -Date.now()
      });
      await table.createEntity({ partitionKey: "task", rowKey: id, ...patch });
    } else {
      await table.updateEntity({ partitionKey: "task", rowKey: id, ...patch }, "Merge");
    }

    // Việc lặp lại: hoàn thành -> tự tạo lần kế tiếp (checklist được đặt lại chưa làm)
    let spawned = null;
    const merged = W.toTask({ ...(current ? { rowKey: id, ...fromTask(current) } : {}), rowKey: id, ...patch });
    if (becameDone && merged.recurrence) {
      const nid = W.newId();
      const due = W.nextDue(merged.dueDate || new Date(Date.now() + 7 * 3600e3).toISOString().slice(0, 10), merged.recurrence);
      const next = {
        partitionKey: "task", rowKey: nid, title: merged.title, description: merged.description, status: "todo",
        priority: merged.priority, dueDate: due, dueTime: merged.dueTime, assigneesJson: JSON.stringify(merged.assignees),
        projectId: merged.projectId, labelsJson: JSON.stringify(merged.labels), recurrence: merged.recurrence,
        checklistJson: JSON.stringify(merged.checklist.map(i => ({ ...i, done: false }))),
        linkJson: merged.link ? JSON.stringify(merged.link) : "",
        historyJson: JSON.stringify([{ at: now, by: "Hệ thống", text: "Tự tạo từ việc lặp lại" }]),
        createdBy: merged.createdBy, createdByName: merged.createdByName, createdAt: now, updatedAt: now, order: -Date.now()
      };
      await table.createEntity(next);
      spawned = W.toTask(next);
    }

    const saved = W.toTask(await table.getEntity("task", id));

    // Email báo người MỚI được giao việc (không gửi cho chính người giao, không chặn việc lưu nếu gửi lỗi)
    try {
      const before = new Set(((current && current.assignees) || []).map(x => String(x).toLowerCase()));
      const me = String(who.email || "").toLowerCase();
      const added = (saved.assignees || []).map(x => String(x).toLowerCase()).filter(x => x && !before.has(x) && x !== me && /@/.test(x));
      if (added.length && saved.status !== "done") {
        const { sendTrackedEmail } = require("../_shared/sendTrackedEmail");
        const esc = s => String(s || "").replace(/[&<>"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
        const due = saved.dueDate ? saved.dueDate.split("-").reverse().join("/") + (saved.dueTime ? " lúc " + saved.dueTime : "") : "Chưa đặt hạn";
        const PRI = { urgent: "Khẩn", high: "Cao", normal: "Bình thường", low: "Thấp" };
        const bodyHtml = `<p style="margin:0 0 14px;">${esc(who.displayName || who.email)} vừa giao cho bạn một công việc:</p>
          <p style="margin:0 0 6px;font-size:17px;font-weight:700;">${esc(saved.title)}</p>
          <p style="margin:0 0 14px;color:#475569;">Hạn: <b>${esc(due)}</b> · Mức ưu tiên: <b>${esc(PRI[saved.priority] || "Bình thường")}</b></p>
          ${saved.description ? `<p style="margin:0 0 14px;color:#334155;">${esc(saved.description).slice(0, 600).replace(/\n/g, "<br>")}</p>` : ""}`;
        for (const to of added.slice(0, 10)) {
          await sendTrackedEmail(context, { to, subject: `Bạn được giao việc: ${saved.title}`.slice(0, 150), type: "work", eyebrow: "Công Việc", title: "Bạn có việc mới", bodyHtml,
            ctas: [{ label: "Mở công việc", href: `https://admin.wvn.vn/admin/cong-viec#today&task=${id}`, style: "primary" }] });
        }
        try {
          const { sendPush } = require("../_shared/push");
          for (const to of added.slice(0, 10)) {
            await sendPush(context, to, { title: "Bạn có việc mới", body: saved.title, url: `/admin/cong-viec#today&task=${id}` });
          }
        } catch (e) { /* best-effort */ }
      }
    } catch (e) { context.log.warn("Không gửi được email giao việc:", e.message); }

    // Tự động hoá luồng trạng thái: báo đúng người cần biết ở mỗi bước chuyển, không chặn việc lưu
    // nếu gửi lỗi. statusChangeNote (không bắt buộc): lý do khi trả lại việc từ "Chờ duyệt".
    try {
      if (patch.status && current && patch.status !== current.status) {
        const esc = s => String(s || "").replace(/[&<>"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
        const note = W.clean(b.statusChangeNote, 500);
        const { sendTrackedEmail } = require("../_shared/sendTrackedEmail");
        const { sendPush } = require("../_shared/push");
        const taskUrl = `/admin/cong-viec#today&task=${id}`;
        const notify = async (recipients, { subject, title, bodyHtml }) => {
          const to = Array.from(new Set(recipients.map(x => String(x || "").toLowerCase()).filter(x => x && /@/.test(x) && x !== String(who.email || "").toLowerCase()))).slice(0, 10);
          for (const email of to) {
            await sendTrackedEmail(context, { to: email, subject: subject.slice(0, 150), type: "work", eyebrow: "Công Việc", title, bodyHtml,
              ctas: [{ label: "Mở công việc", href: `https://admin.wvn.vn${taskUrl}`, style: "primary" }] });
          }
          for (const email of to) { try { await sendPush(context, email, { title, body: saved.title, url: taskUrl }); } catch (e) { /* best-effort */ } }
        };

        // 1) Chuyển sang "Chờ duyệt" -> báo người TẠO việc (thường là người giao/quản lý) đi duyệt
        if (patch.status === "review") {
          await notify([current.createdBy], {
            subject: `Cần duyệt: ${saved.title}`,
            title: "Có việc đang chờ bạn duyệt",
            bodyHtml: `<p style="margin:0 0 14px;">${esc(who.displayName)} đã hoàn tất và chuyển việc sau sang <b>Chờ duyệt</b>:</p>
              <p style="margin:0 0 14px;font-size:17px;font-weight:700;">${esc(saved.title)}</p>`
          });
        }

        // 2) Trả lại từ "Chờ duyệt" (lùi về Đang làm/Cần làm) -> báo người phụ trách, kèm lý do nếu có
        if (current.status === "review" && (patch.status === "doing" || patch.status === "todo")) {
          await notify(saved.assignees, {
            subject: `Việc bị trả lại: ${saved.title}`,
            title: "Việc của bạn bị trả lại để chỉnh sửa",
            bodyHtml: `<p style="margin:0 0 14px;">${esc(who.displayName)} đã trả lại việc sau để chỉnh sửa thêm:</p>
              <p style="margin:0 0 14px;font-size:17px;font-weight:700;">${esc(saved.title)}</p>
              ${note ? `<p style="margin:0 0 14px;color:#334155;"><b>Lý do:</b> ${esc(note)}</p>` : ""}`
          });
        }

        // 3) Duyệt xong ("Chờ duyệt" -> "Hoàn thành") -> báo người phụ trách đã được duyệt
        if (current.status === "review" && patch.status === "done") {
          await notify(saved.assignees, {
            subject: `Đã duyệt: ${saved.title}`,
            title: "Việc của bạn đã được duyệt",
            bodyHtml: `<p style="margin:0 0 14px;">${esc(who.displayName)} đã duyệt việc sau, xem như hoàn tất:</p>
              <p style="margin:0 0 14px;font-size:17px;font-weight:700;">${esc(saved.title)}</p>`
          });
        }

        // 4) Việc vừa Hoàn thành có (các) việc khác đang chờ nó (blockedBy trỏ tới việc này)
        //    -> báo người phụ trách việc kế tiếp là đã có thể bắt đầu
        if (becameDone) {
          const waiting = [];
          const it = table.listEntities({ queryOptions: { filter: `PartitionKey eq 'task' and blockedBy eq '${id.replace(/'/g, "''")}'` } });
          for await (const w of it) waiting.push(W.toTask(w));
          for (const nextTask of waiting.slice(0, 10)) {
            await notify(nextTask.assignees, {
              subject: `Có thể bắt đầu: ${nextTask.title}`,
              title: "Việc kế tiếp đã có thể bắt đầu",
              bodyHtml: `<p style="margin:0 0 14px;">Việc chặn trước đó (<b>${esc(saved.title)}</b>) đã hoàn thành, bạn có thể bắt đầu:</p>
                <p style="margin:0 0 14px;font-size:17px;font-weight:700;">${esc(nextTask.title)}</p>`
            });
          }
        }
      }
    } catch (e) { context.log.warn("Không gửi được email luồng trạng thái:", e.message); }

    await logAdminActivity(req, "Công việc: lưu việc", summarizeBody(req.body));
    context.res.status = 200;
    context.res.body = { success: true, task: saved, spawned };
  } catch (err) {
    context.log.error("Lỗi lưu công việc:", err.message);
    context.res.status = 500;
    context.res.body = { success: false, message: "Đã có lỗi xảy ra, vui lòng thử lại sau." };
  }
};

// Chuyển task (dạng API) ngược về dạng lưu trữ, để gộp với phần thay đổi
function fromTask(t) {
  return {
    title: t.title, description: t.description, status: t.status, priority: t.priority, dueDate: t.dueDate, dueTime: t.dueTime,
    assigneesJson: JSON.stringify(t.assignees), projectId: t.projectId, labelsJson: JSON.stringify(t.labels),
    checklistJson: JSON.stringify(t.checklist), recurrence: t.recurrence, blockedBy: t.blockedBy || "", linkJson: t.link ? JSON.stringify(t.link) : "",
    createdBy: t.createdBy, createdByName: t.createdByName
  };
}
