const { requireAdmin, loadSessionAndAccount, accountPermissions, isSuperAdmin } = require("../_shared/adminAuth");
const { TASKS_TABLE, toTask } = require("../_shared/work");
const { buildInbox, listAll, todayVN } = require("../_shared/workInbox");

// Chuông thông báo trên mọi màn hình làm việc (Quản trị, CRM, Công Việc) — gọi định kỳ ~1 phút/lần.
// Trả các đầu việc cần thao tác theo ĐÚNG quyền của người đang đăng nhập + việc được giao cho chính họ.
// Có bộ nhớ đệm ngắn theo từng bộ quyền để nhiều nhân viên cùng mở màn hình không quét bảng liên tục.

const CACHE_MS = 30 * 1000;
const inboxCache = new Map(); // permKey -> { at, inbox }

module.exports = async function (context, req) {
  context.res = { headers: { "Content-Type": "application/json", "Cache-Control": "no-store" } };
  if (!(await requireAdmin(context, req))) return;

  try {
    const { session, account } = await loadSessionAndAccount(null, req);
    const superAdmin = isSuperAdmin(account);
    const perms = accountPermissions(account);
    const can = k => superAdmin || perms.includes(k);
    const myEmail = String(session.adminEmail || "").toLowerCase();
    const today = todayVN();

    const permKey = superAdmin ? "*" : perms.slice().sort().join(",");
    let cached = inboxCache.get(permKey);
    const fresh = req.query && req.query.fresh === "1";
    if (fresh || !cached || Date.now() - cached.at > CACHE_MS) {
      cached = { at: Date.now(), inbox: await buildInbox(context, can) };
      inboxCache.set(permKey, cached);
    }
    const items = cached.inbox.map(i => ({ ...i }));

    // Việc trên màn Công Việc được giao cho chính người này
    if (myEmail) {
      try {
        const mine = (await listAll(TASKS_TABLE, "PartitionKey eq 'task'")).map(toTask)
          .filter(t => t.status !== "done" && (t.assignees || []).map(x => String(x).toLowerCase()).includes(myEmail));
        const overdue = mine.filter(t => t.dueDate && t.dueDate < today);
        const dueToday = mine.filter(t => t.dueDate === today);
        const since = Date.now() - 3 * 864e5;
        const fresh = mine.filter(t => String(t.createdBy || "").toLowerCase() !== myEmail && t.createdAt && new Date(t.createdAt).getTime() >= since && t.status === "todo");
        const names = list => list.slice(0, 3).map(t => t.title).join(", ") + (list.length > 3 ? "…" : "");
        if (overdue.length) items.unshift({ key: "task-overdue", count: overdue.length, title: `${overdue.length} việc của bạn đã quá hạn`, hint: names(overdue), href: "/admin/cong-viec", tone: "red", level: "urgent" });
        if (fresh.length) items.push({ key: "task-new", count: fresh.length, title: `${fresh.length} việc mới được giao cho bạn`, hint: fresh.slice(0, 3).map(t => `${t.title}${t.createdByName ? " (" + t.createdByName + ")" : ""}`).join(", "), href: "/admin/cong-viec", tone: "violet", level: "action" });
        if (dueToday.length) items.push({ key: "task-today", count: dueToday.length, title: `${dueToday.length} việc của bạn hạn hôm nay`, hint: names(dueToday), href: "/admin/cong-viec", tone: "gold", level: "action" });
      } catch (e) { context.log.warn("alerts: không đọc được việc của tôi:", e.message); }
    }

    const rank = { urgent: 0, action: 1, info: 2 };
    items.sort((a, b) => (rank[a.level] ?? 1) - (rank[b.level] ?? 1));
    const total = items.filter(i => i.level !== "info").reduce((s, i) => s + i.count, 0);

    context.res.status = 200;
    context.res.body = { success: true, items, total, at: new Date().toISOString() };
  } catch (err) {
    context.log.error("Lỗi tải thông báo:", err.message);
    context.res.status = 500;
    context.res.body = { success: false, message: "Không tải được thông báo." };
  }
};
