const { getTableClient } = require("../_shared/tableStorage");
const { requireAdmin } = require("../_shared/adminAuth");

const MEMBERS_TABLE = "Members";

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
    try {
      await membersTable.updateEntity({
        partitionKey: "member",
        rowKey: email,
        failedAttempts: 0
      }, "Merge");
    } catch (err) {
      if (err.statusCode === 404) {
        context.res.status = 404;
        context.res.body = { success: false, message: "Không tìm thấy tài khoản này." };
        return;
      }
      throw err;
    }

    context.res.status = 200;
    context.res.body = { success: true };
  } catch (err) {
    context.log.error("Lỗi mở khoá tài khoản:", err.message);
    context.res.status = 500;
    context.res.body = { success: false, message: "Đã có lỗi xảy ra, vui lòng thử lại sau." };
  }
};
