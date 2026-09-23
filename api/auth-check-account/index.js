const { getTableClient } = require("../_shared/tableStorage");

const MEMBERS_TABLE = "Members";

module.exports = async function (context, req) {
  context.res = { headers: { "Content-Type": "application/json" } };

  const email = String((req.body && req.body.email) || "").trim().toLowerCase();
  const emailValid = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
  if (!emailValid) {
    context.res.status = 400;
    context.res.body = { success: false, message: "Email không hợp lệ." };
    return;
  }

  try {
    const membersTable = await getTableClient(MEMBERS_TABLE);
    let hasPassword = false;
    try {
      await membersTable.getEntity("member", email);
      hasPassword = true;
    } catch (err) {
      if (err.statusCode !== 404) throw err;
    }

    context.res.status = 200;
    context.res.body = { success: true, hasPassword };
  } catch (err) {
    context.log.error("Lỗi kiểm tra tài khoản:", err.message);
    context.res.status = 500;
    context.res.body = { success: false, message: "Đã có lỗi xảy ra, vui lòng thử lại sau." };
  }
};
