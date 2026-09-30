const { getTableClient } = require("../_shared/tableStorage");
const { requireAdmin, loadSessionAndAccount, accountPermissions, isSuperAdmin, ADMIN_ACCOUNTS_TABLE } = require("../_shared/adminAuth");
const { TASKS_TABLE, PROJECTS_TABLE, toTask } = require("../_shared/work");
const { buildInbox } = require("../_shared/workInbox");

// Mọi thứ màn Công Việc cần trong 1 lần gọi: việc, dự án, danh sách đồng nghiệp để giao việc,
// và "Hộp việc hệ thống" — các đầu việc tự sinh từ dữ liệu vận hành (đơn chờ duyệt, hoá đơn chờ
// xác nhận, quà chờ trao, phụ huynh cần gọi...). Mỗi nhóm chỉ hiện khi tài khoản có quyền khu vực đó.

async function listAll(name, filter) {
  const t = await getTableClient(name);
  const rows = [];
  for await (const e of t.listEntities(filter ? { queryOptions: { filter } } : undefined)) rows.push(e);
  return rows;
}
const todayVN = () => new Date(Date.now() + 7 * 3600e3).toISOString().slice(0, 10);

module.exports = async function (context, req) {
  context.res = { headers: { "Content-Type": "application/json" } };
  if (!(await requireAdmin(context, req))) return;

  try {
    const { session, account } = await loadSessionAndAccount(null, req);
    const superAdmin = isSuperAdmin(account);
    const perms = accountPermissions(account);
    const can = k => superAdmin || perms.includes(k);
    const me = { email: session.adminEmail || "", name: session.displayName || "", role: superAdmin ? "super" : "staff" };

    const doneCutoff = Date.now() - 45 * 864e5;
    const [taskRows, projectRows, accountRows] = await Promise.all([
      listAll(TASKS_TABLE, "PartitionKey eq 'task'"),
      listAll(PROJECTS_TABLE, "PartitionKey eq 'project'"),
      listAll(ADMIN_ACCOUNTS_TABLE, "PartitionKey eq 'admin'")
    ]);
    // Việc đã xong quá 45 ngày không tải về (vẫn còn trong kho) để màn hình luôn nhẹ
    const tasks = taskRows.map(toTask).filter(t => t.status !== "done" || !t.completedAt || new Date(t.completedAt).getTime() >= doneCutoff);
    const projects = projectRows.map(p => ({
      id: p.rowKey, name: p.name || "", color: p.color || "#2563eb", description: p.description || "",
      archived: !!p.archived, order: Number(p.order) || 0, createdAt: p.createdAt || null
    })).sort((a, b) => a.order - b.order || a.name.localeCompare(b.name, "vi"));
    const staff = accountRows.filter(a => a.isActive !== false).map(a => ({ email: a.rowKey, name: a.displayName || a.rowKey }))
      .sort((a, b) => a.name.localeCompare(b.name, "vi"));

    // ---------- Hộp việc hệ thống (dùng chung với chuông thông báo — _shared/workInbox.js) ----------
    const today = todayVN();
    const inbox = await buildInbox(context, can);

    context.res.status = 200;
    context.res.body = { success: true, me, tasks, projects, staff, inbox, today };
  } catch (err) {
    context.log.error("Lỗi tải Công Việc:", err.message);
    context.res.status = 500;
    context.res.body = { success: false, message: "Đã có lỗi xảy ra, vui lòng thử lại sau." };
  }
};
