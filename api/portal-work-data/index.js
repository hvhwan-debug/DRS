const { getTableClient } = require("../_shared/tableStorage");
const { requireAdmin, loadSessionAndAccount, accountPermissions, isSuperAdmin, ADMIN_ACCOUNTS_TABLE } = require("../_shared/adminAuth");
const { TASKS_TABLE, PROJECTS_TABLE, toTask } = require("../_shared/work");

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

    // ---------- Hộp việc hệ thống ----------
    const inbox = [];
    const today = todayVN();
    const safe = async fn => { try { await fn(); } catch (e) { context.log.error("inbox:", e.message); } };
    await Promise.all([
      can("registrations") && safe(async () => {
        const rows = (await listAll("Registrations")).filter(r => /Chờ/.test(r.status || "Chờ"));
        if (rows.length) inbox.push({ key: "registrations", count: rows.length, title: `${rows.length} đơn đăng ký chờ xử lý`, hint: "Duyệt hoặc từ chối đơn", href: "/admin#registrations", tone: "blue" });
      }),
      can("invoices") && safe(async () => {
        const rows = (await listAll("Invoices")).filter(r => r.status === "pending_review");
        if (rows.length) inbox.push({ key: "invoices", count: rows.length, title: `${rows.length} biên lai hoá đơn chờ xác nhận`, hint: "Duyệt để cộng tiền và điểm cho phụ huynh", href: "/admin#invoices", tone: "green" });
      }),
      can("gifts") && safe(async () => {
        const rows = (await listAll("GiftRedemptions")).filter(r => ["pending", "shipping"].includes(r.status || "pending"));
        const pending = rows.filter(r => (r.status || "pending") === "pending").length;
        if (rows.length) inbox.push({ key: "gifts", count: rows.length, title: `${rows.length} yêu cầu đổi quà đang xử lý`, hint: pending ? `${pending} chờ duyệt, ${rows.length - pending} đang vận chuyển` : "Đang vận chuyển, nhớ đánh dấu khi đã trao", href: "/admin#gifts", tone: "gold" });
      }),
      can("tuition") && safe(async () => {
        const rows = (await listAll("TuitionPayments")).filter(r => r.confirmationStatus === "rejected");
        if (rows.length) inbox.push({ key: "tuition", count: rows.length, title: `${rows.length} khoản học phí phụ huynh báo sai`, hint: "Kiểm tra và sửa lại để tính điểm", href: "/admin#tuition", tone: "red" });
      }),
      can("students") && safe(async () => {
        const crm = await listAll("StudentCrm", "PartitionKey eq 'crm'");
        const due = crm.filter(p => p.nextFollowUp && p.nextFollowUp <= today && !["da-nghi", "hoan-thanh"].includes(p.stage));
        if (!due.length) return;
        const students = {};
        for (const s of await listAll("Students")) students[s.rowKey] = s.studentName;
        const names = due.slice(0, 4).map(p => students[p.rowKey]).filter(Boolean);
        inbox.push({ key: "crm", count: due.length, title: `${due.length} phụ huynh cần liên hệ hôm nay`, hint: names.join(", ") + (due.length > names.length ? "…" : ""), href: "/admin/crm", tone: "violet" });
      })
    ].filter(Boolean));
    const order = ["crm", "invoices", "tuition", "registrations", "gifts"];
    inbox.sort((a, b) => order.indexOf(a.key) - order.indexOf(b.key));

    context.res.status = 200;
    context.res.body = { success: true, me, tasks, projects, staff, inbox, today };
  } catch (err) {
    context.log.error("Lỗi tải Công Việc:", err.message);
    context.res.status = 500;
    context.res.body = { success: false, message: "Đã có lỗi xảy ra, vui lòng thử lại sau." };
  }
};
