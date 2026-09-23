const { getTableClient } = require("../_shared/tableStorage");
const { requireAdmin } = require("../_shared/adminAuth");

const REGISTRATIONS_TABLE = "Registrations";
const ALLOWED_STATUSES = ["Đã ghi nhận - Chờ xử lý", "Đã duyệt", "Từ chối"];

module.exports = async function (context, req) {
  context.res = { headers: { "Content-Type": "application/json" } };

  if (!(await requireAdmin(context, req))) return;

  const email = String((req.body && req.body.email) || "").trim();
  const id = String((req.body && req.body.id) || "").trim();
  const status = String((req.body && req.body.status) || "").trim();

  if (!email || !id || !status) {
    context.res.status = 400;
    context.res.body = { success: false, message: "Thiếu thông tin cần thiết." };
    return;
  }
  if (!ALLOWED_STATUSES.includes(status)) {
    context.res.status = 400;
    context.res.body = { success: false, message: "Trạng thái không hợp lệ." };
    return;
  }

  try {
    const regTable = await getTableClient(REGISTRATIONS_TABLE);
    await regTable.updateEntity({
      partitionKey: email,
      rowKey: id,
      status
    }, "Merge");

    context.res.status = 200;
    context.res.body = { success: true };
  } catch (err) {
    context.log.error("Lỗi cập nhật trạng thái đăng ký:", err.message);
    context.res.status = 500;
    context.res.body = { success: false, message: "Đã có lỗi xảy ra, vui lòng thử lại sau." };
  }
};
