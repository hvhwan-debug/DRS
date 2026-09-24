const { getTableClient } = require("../_shared/tableStorage");
const { requireAdmin } = require("../_shared/adminAuth");

const MEMBERS_TABLE = "Members";
const SESSION_TABLE = "AuthSessions";

module.exports = async function (context, req) {
  context.res = { headers: { "Content-Type": "application/json" } };

  if (!(await requireAdmin(context, req))) return;

  const email = String((req.body && req.body.email) || "").trim().toLowerCase();
  if (!email) {
    context.res.status = 400;
    context.res.body = { success: false, message: "Thiếu email." };
    return;
  }

  try {
    const membersTable = await getTableClient(MEMBERS_TABLE);
    await membersTable.deleteEntity("member", email);

    // Huỷ luôn mọi phiên đăng nhập hiện tại của email này (best-effort)
    try {
      const sessionTable = await getTableClient(SESSION_TABLE);
      const iterator = sessionTable.listEntities({
        queryOptions: { filter: `PartitionKey eq 'session' and email eq '${email.replace(/'/g, "''")}'` }
      });
      for await (const s of iterator) {
        await sessionTable.deleteEntity("session", s.rowKey).catch(() => {});
      }
    } catch (err) {
      context.log.error("Huỷ phiên đăng nhập thất bại:", err.message);
    }

    context.res.status = 200;
    context.res.body = { success: true };
  } catch (err) {
    if (err.statusCode === 404) {
      context.res.status = 404;
      context.res.body = { success: false, message: "Không tìm thấy tài khoản này." };
      return;
    }
    context.log.error("Lỗi xoá thành viên:", err.message);
    context.res.status = 500;
    context.res.body = { success: false, message: "Đã có lỗi xảy ra, vui lòng thử lại sau." };
  }
};
