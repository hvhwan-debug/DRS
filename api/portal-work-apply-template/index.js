const { logAdminActivity, summarizeBody } = require("../_shared/activityLog");
const { getTableClient } = require("../_shared/tableStorage");
const { requireAdmin, getAdminIdentity } = require("../_shared/adminAuth");
const W = require("../_shared/work");

const TEMPLATES_TABLE = "WorkTemplates";
const COLORS = ["#2563eb", "#0891b2", "#059669", "#ca8a04", "#dc2626", "#db2777", "#7c3aed", "#475569"];

// Tạo một dự án mới cùng toàn bộ việc từ một mẫu đã lưu, dời ngày theo "ngày bắt đầu" người dùng chọn
// (mỗi việc giữ nguyên khoảng cách ngày so với việc đầu tiên trong mẫu).
module.exports = async function (context, req) {
  context.res = { headers: { "Content-Type": "application/json" } };
  if (!(await requireAdmin(context, req))) return;

  const b = req.body || {};
  try {
    if (!W.isId(b.templateId)) { context.res.status = 400; context.res.body = { success: false, message: "Thiếu mẫu để áp dụng." }; return; }
    const projectName = W.clean(b.projectName, 80);
    if (!projectName) { context.res.status = 400; context.res.body = { success: false, message: "Đặt tên cho dự án mới." }; return; }
    const startDate = W.cleanDate(b.startDate);

    const tplTable = await getTableClient(TEMPLATES_TABLE);
    let tpl = null;
    try { tpl = await tplTable.getEntity("template", b.templateId); }
    catch (e) { if (e.statusCode === 404) { context.res.status = 404; context.res.body = { success: false, message: "Mẫu này không còn tồn tại." }; return; } throw e; }
    const tasks = W.parseJson(tpl.tasksJson, []);

    const who = (await getAdminIdentity(req)) || { email: "", displayName: "" };
    const now = new Date().toISOString();

    const projTable = await getTableClient(W.PROJECTS_TABLE);
    const projectId = W.newId();
    const color = COLORS.includes(tpl.color) ? tpl.color : COLORS[Math.floor(Math.random() * COLORS.length)];
    await projTable.createEntity({ partitionKey: "project", rowKey: projectId, name: projectName, color, description: tpl.description || "", archived: false, order: Date.now(), createdAt: now, updatedAt: now });

    const taskTable = await getTableClient(W.TASKS_TABLE);
    let created = 0;
    for (const t of tasks.slice(0, 60)) {
      const dueDate = startDate && t.dayOffset != null
        ? new Date(new Date(startDate + "T00:00:00Z").getTime() + t.dayOffset * 864e5).toISOString().slice(0, 10)
        : "";
      const id = W.newId() + "-" + created;
      await taskTable.createEntity({
        partitionKey: "task", rowKey: id, title: W.clean(t.title, 200), description: "",
        status: "todo", priority: W.PRIORITIES.includes(t.priority) ? t.priority : "normal",
        dueDate, dueTime: t.dueTime || "", assigneesJson: JSON.stringify(who.email ? [who.email] : []),
        projectId, labelsJson: JSON.stringify(t.labels || []),
        checklistJson: JSON.stringify((t.checklist || []).map(text => ({ id: W.newId(), text, done: false }))),
        recurrence: "", historyJson: JSON.stringify([{ at: now, by: who.displayName || who.email, text: `Tạo từ mẫu "${tpl.name}"` }]),
        createdBy: who.email, createdByName: who.displayName, createdAt: now, updatedAt: now, order: -Date.now() - created
      });
      created++;
    }

    await logAdminActivity(req, "Công việc: áp dụng mẫu dự án", summarizeBody(req.body));
    context.res.status = 200;
    context.res.body = { success: true, projectId, projectName, taskCount: created };
  } catch (err) {
    context.log.error("Lỗi áp dụng mẫu dự án:", err.message);
    context.res.status = 500;
    context.res.body = { success: false, message: "Đã có lỗi xảy ra, vui lòng thử lại sau." };
  }
};
