const { logAdminActivity, summarizeBody } = require("../_shared/activityLog");
const { getTableClient } = require("../_shared/tableStorage");
const { requireAdmin } = require("../_shared/adminAuth");
const W = require("../_shared/work");

const COLORS = ["#2563eb", "#0891b2", "#059669", "#ca8a04", "#dc2626", "#db2777", "#7c3aed", "#475569"];

module.exports = async function (context, req) {
  context.res = { headers: { "Content-Type": "application/json" } };
  if (!(await requireAdmin(context, req))) return;
  const b = req.body || {};
  try {
    const table = await getTableClient(W.PROJECTS_TABLE);
    const id = b.id && W.isId(b.id) ? b.id : W.newId();
    const patch = { partitionKey: "project", rowKey: id, updatedAt: new Date().toISOString() };
    if (!b.id || "name" in b) { patch.name = W.clean(b.name, 80); if (!patch.name) { context.res.status = 400; context.res.body = { success: false, message: "Dự án cần có tên." }; return; } }
    if ("color" in b) patch.color = COLORS.includes(b.color) ? b.color : COLORS[0];
    if ("description" in b) patch.description = W.clean(b.description, 500);
    if ("archived" in b) patch.archived = !!b.archived;
    if (!b.id) { patch.createdAt = patch.updatedAt; patch.order = Date.now(); if (!patch.color) patch.color = COLORS[Math.floor(Math.random() * COLORS.length)]; }
    await table.upsertEntity(patch, "Merge");
    const e = await table.getEntity("project", id);
    await logAdminActivity(req, "Công việc: lưu dự án", summarizeBody(req.body));
    context.res.status = 200;
    context.res.body = { success: true, project: { id, name: e.name, color: e.color, description: e.description || "", archived: !!e.archived, order: Number(e.order) || 0 } };
  } catch (err) {
    context.log.error("Lỗi lưu dự án:", err.message);
    context.res.status = 500; context.res.body = { success: false, message: "Đã có lỗi xảy ra, vui lòng thử lại sau." };
  }
};
