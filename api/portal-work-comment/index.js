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
    await logAdminActivity(req, "Công việc: bình luận", `việc ${String((req.body && req.body.taskId) || "")}: ${String(text).slice(0, 80)}`);
    context.res.status = 200; context.res.body = { success: true, comment: { id: c.rowKey, text, by: c.byName || c.by, at: c.createdAt }, commentCount: n };
  } catch (err) {
    context.log.error("Lỗi bình luận:", err.message);
    context.res.status = 500; context.res.body = { success: false, message: "Đã có lỗi xảy ra, vui lòng thử lại sau." };
  }
};
