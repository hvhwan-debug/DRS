const { logAdminActivity, summarizeBody } = require("../_shared/activityLog");
const { getTableClient } = require("../_shared/tableStorage");
const { requireAdmin, getAdminIdentity } = require("../_shared/adminAuth");
const W = require("../_shared/work");

const STATUS_LABEL = { todo: "Cần làm", doing: "Đang làm", review: "Chờ duyệt", done: "Hoàn thành" };

// Tạo mới (không có id) hoặc cập nhật MỘT PHẦN (chỉ các trường gửi lên) một công việc.
// Tự ghi lịch sử thay đổi; khi hoàn thành việc có lặp lại -> tự tạo lần kế tiếp.
module.exports = async function (context, req) {
  context.res = { headers: { "Content-Type": "application/json" } };
  if (!(await requireAdmin(context, req))) return;

  const b = req.body || {};
  try {
    const who = (await getAdminIdentity(req)) || { email: "", displayName: "" };
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
    if (has("status") && W.STATUSES.includes(b.status)) patch.status = b.status;
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
      if (patch.status && patch.status !== current.status) log(`Chuyển sang "${STATUS_LABEL[patch.status]}"`);
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
      }
    } catch (e) { context.log.warn("Không gửi được email giao việc:", e.message); }
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
