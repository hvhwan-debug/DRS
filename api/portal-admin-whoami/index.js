const { requireAdmin, loadSessionAndAccount, accountPermissions, isSuperAdmin } = require("../_shared/adminAuth");

module.exports = async function (context, req) {
  context.res = { headers: { "Content-Type": "application/json" } };

  if (!(await requireAdmin(context, req))) return;

  const { session, account } = await loadSessionAndAccount(null, req);
  const role = isSuperAdmin(account) ? "super" : "staff";

  context.res.status = 200;
  context.res.body = {
    success: true,
    email: session.adminEmail || null,
    displayName: session.displayName || (account ? account.displayName : "Quản trị viên"),
    role,
    permissions: role === "super" ? null : accountPermissions(account) // null = toàn quyền, không cần liệt kê
  };
};
