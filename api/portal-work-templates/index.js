const { logAdminActivity, summarizeBody } = require("../_shared/activityLog");
const { getTableClient } = require("../_shared/tableStorage");
const { requireAdmin, getAdminIdentity } = require("../_shared/adminAuth");
const W = require("../_shared/work");

const TEMPLATES_TABLE = "WorkTemplates";

async function listAll(name, filter) {
  const t = await getTableClient(name);
  const rows = [];
  for await (const e of t.listEntities(filter ? { queryOptions: { filter } } : undefined)) rows.push(e);
  return rows;
}

// GET: liệt kê mẫu dự án đã lưu, để dùng lại khi bắt đầu một đợt việc quen thuộc
// (khai giảng lớp mới, onboarding nhân viên...). POST: lưu các việc ĐANG MỞ của một dự án
// thành một mẫu — mỗi việc giữ lại tên, mức ưu tiên, nhãn, checklist và "lệch bao nhiêu ngày"
// so với việc có hạn sớm nhất, để khi áp dụng mẫu có thể dời cả cụm theo ngày bắt đầu mới.
module.exports = async function (context, req) {
  context.res = { headers: { "Content-Type": "application/json" } };
  if (!(await requireAdmin(context, req))) return;

  try {
    if (req.method === "GET") {
      const rows = await listAll(TEMPLATES_TABLE, "PartitionKey eq 'template'");
      const templates = rows.map(e => ({
        id: e.rowKey, name: e.name || "", color: e.color || "#2563eb", description: e.description || "",
        taskCount: W.parseJson(e.tasksJson, []).length, createdAt: e.createdAt || null
      })).sort((a, b) => (b.createdAt || "").localeCompare(a.createdAt || ""));
      context.res.status = 200;
      context.res.body = { success: true, templates };
      return;
    }

    const b = req.body || {};
    if (!W.isId(b.projectId)) { context.res.status = 400; context.res.body = { success: false, message: "Thiếu dự án nguồn." }; return; }
    const name = W.clean(b.name, 80);
    if (!name) { context.res.status = 400; context.res.body = { success: false, message: "Mẫu cần có tên." }; return; }

    const who = (await getAdminIdentity(req)) || { email: "", displayName: "" };
    const projectTable = await getTableClient(W.PROJECTS_TABLE);
    let project = null;
    try { project = await projectTable.getEntity("project", b.projectId); }
    catch (e) { if (e.statusCode === 404) { context.res.status = 404; context.res.body = { success: false, message: "Dự án này không còn tồn tại." }; return; } throw e; }

    const rows = (await listAll(W.TASKS_TABLE, "PartitionKey eq 'task'")).map(W.toTask).filter(t => t.projectId === b.projectId && t.status !== "done");
    if (!rows.length) { context.res.status = 400; context.res.body = { success: false, message: "Dự án chưa có việc đang mở để lưu thành mẫu." }; return; }

    const dated = rows.map(t => t.dueDate).filter(Boolean).sort();
    const base = dated[0] || null;
    const dayDiff = (a, z) => Math.round((new Date(z + "T00:00:00Z") - new Date(a + "T00:00:00Z")) / 864e5);
    const tasks = rows.map(t => ({
      title: t.title, priority: t.priority, labels: t.labels,
      checklist: (t.checklist || []).map(i => i.text),
      dayOffset: t.dueDate && base ? dayDiff(base, t.dueDate) : null,
      dueTime: t.dueTime || ""
    })).slice(0, 60);

    const id = W.newId();
    const now = new Date().toISOString();
    const table = await getTableClient(TEMPLATES_TABLE);
    await table.createEntity({
      partitionKey: "template", rowKey: id, name, color: project.color || "#2563eb",
      description: W.clean(b.description, 300), tasksJson: JSON.stringify(tasks),
      createdBy: who.email, createdByName: who.displayName, createdAt: now
    });

    await logAdminActivity(req, "Công việc: lưu mẫu dự án", summarizeBody(req.body));
    context.res.status = 200;
    context.res.body = { success: true, template: { id, name, color: project.color || "#2563eb", description: b.description || "", taskCount: tasks.length, createdAt: now } };
  } catch (err) {
    context.log.error("Lỗi xử lý mẫu dự án:", err.message);
    context.res.status = 500;
    context.res.body = { success: false, message: "Đã có lỗi xảy ra, vui lòng thử lại sau." };
  }
};
