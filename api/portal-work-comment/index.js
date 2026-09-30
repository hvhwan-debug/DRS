const { logAdminActivity } = require("../_shared/activityLog");
const { getTableClient } = require("../_shared/tableStorage");
const { requireAdmin, getAdminIdentity } = require("../_shared/adminAuth");
const W = require("../_shared/work");

// GET ?taskId=... -> danh sách bình luận; POST {taskId, text} -> thêm bình luận.
module.exports = async function (context, req) {
  context.res = { headers: { "Content-Type": "application/json" } };
  if (!(await requireAdmin(context, req))) return;
  const taskId = String((req.query && req.query.taskId) || (req.body && req.body.taskId) || "");
  if (!W.isId(taskId)) { context.res.status = 400; context.res.body = { success: false, message: "Thiếu mã công việc." }; return; }
  try {
    const comments = await getTableClient(W.COMMENTS_TABLE);
    if ((req.method || "GET").toUpperCase() === "GET") {
      const list = [];
      for await (const c of comments.listEntities({ queryOptions: { filter: `PartitionKey eq '${taskId}'` } })) list.push({ id: c.rowKey, text: c.text, by: c.byName || c.by, at: c.createdAt });
      list.sort((a, b) => new Date(a.at) - new Date(b.at));
      context.res.status = 200; context.res.body = { success: true, comments: list }; return;
    }
    const text = W.clean(req.body && req.body.text, 2000);
    if (!text) { context.res.status = 400; context.res.body = { success: false, message: "Nhập nội dung bình luận." }; return; }
    const who = (await getAdminIdentity(req)) || {};
    const c = { partitionKey: taskId, rowKey: W.newId(), text, by: who.email || "", byName: who.displayName || "", createdAt: new Date().toISOString() };
    await comments.createEntity(c);
    const tasks = await getTableClient(W.TASKS_TABLE);
    let n = 0; for await (const _ of comments.listEntities({ queryOptions: { filter: `PartitionKey eq '${taskId}'` } })) n++;
    await tasks.updateEntity({ partitionKey: "task", rowKey: taskId, commentCount: n, updatedAt: c.createdAt }, "Merge").catch(() => {});
    // Nhắc tên: @Tên trong bình luận -> gửi email cho đúng người đó (không gửi cho chính người viết)
    let mentioned = [];
    try {
      const { ADMIN_ACCOUNTS_TABLE } = require("../_shared/adminAuth");
      const acc = await getTableClient(ADMIN_ACCOUNTS_TABLE || "AdminAccounts");
      const staff = [];
      for await (const a of acc.listEntities({ queryOptions: { filter: "PartitionKey eq 'admin'" } })) if (a.isActive !== false) staff.push({ email: String(a.rowKey).toLowerCase(), name: a.displayName || a.rowKey });
      const asked = new Set(((req.body && req.body.mentions) || []).map(x => String(x).toLowerCase()));
      const low = text.toLowerCase();
      staff.forEach(s => { if (low.includes("@" + String(s.name).toLowerCase())) asked.add(s.email); });
      mentioned = staff.filter(s => asked.has(s.email) && s.email !== String(who.email || "").toLowerCase());
      if (mentioned.length) {
        let task = null; try { task = W.toTask(await tasks.getEntity("task", taskId)); } catch (e) {}
        const { sendTrackedEmail } = require("../_shared/sendTrackedEmail");
        const esc = s => String(s || "").replace(/[&<>"]/g, ch => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[ch]));
        for (const m of mentioned.slice(0, 10)) {
          await sendTrackedEmail(context, {
            to: m.email, subject: `${who.displayName || who.email} nhắc bạn trong: ${task ? task.title : "một công việc"}`.slice(0, 150), type: "work",
            eyebrow: "Công Việc", title: "Bạn được nhắc tên",
            bodyHtml: `<p style="margin:0 0 12px;"><b>${esc(who.displayName || who.email)}</b> vừa nhắc bạn trong công việc <b>${esc(task ? task.title : "")}</b>:</p>
              <blockquote style="margin:0 0 14px;padding:10px 14px;border-left:3px solid #0284c7;background:#f0f9ff;border-radius:8px;color:#0f172a;">${esc(text).replace(/\n/g, "<br>")}</blockquote>`,
            ctas: [{ label: "Mở công việc", href: `https://admin.wvn.vn/admin/cong-viec#today&task=${taskId}`, style: "primary" }]
          });
        }
        try {
          const { sendPush } = require("../_shared/push");
          for (const m of mentioned.slice(0, 10)) {
            await sendPush(context, m.email, { title: `${who.displayName || who.email} nhắc bạn`, body: text.slice(0, 120), url: `/admin/cong-viec#today&task=${taskId}` });
          }
        } catch (e) { /* best-effort */ }
      }
    } catch (e) { context.log.warn("Không gửi được email nhắc tên:", e.message); }
    await logAdminActivity(req, "Công việc: bình luận", `việc ${String((req.body && req.body.taskId) || "")}: ${String(text).slice(0, 80)}`);
    context.res.status = 200; context.res.body = { success: true, comment: { id: c.rowKey, text, by: c.byName || c.by, at: c.createdAt }, commentCount: n, mentioned: mentioned.map(m => m.name) };
  } catch (err) {
    context.log.error("Lỗi bình luận:", err.message);
    context.res.status = 500; context.res.body = { success: false, message: "Đã có lỗi xảy ra, vui lòng thử lại sau." };
  }
};
