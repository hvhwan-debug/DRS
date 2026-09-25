const { getTableClient } = require("../_shared/tableStorage");
const { requireAdmin } = require("../_shared/adminAuth");

const INVOICES_TABLE = "Invoices";

module.exports = async function (context, req) {
  context.res = { headers: { "Content-Type": "application/json" } };

  if (!(await requireAdmin(context, req))) return;

  const parentEmail = String((req.body && req.body.parentEmail) || "").trim().toLowerCase();
  const id = String((req.body && req.body.id) || "").trim();
  if (!parentEmail || !id) {
    context.res.status = 400;
    context.res.body = { success: false, message: "Thiếu thông tin." };
    return;
  }

  try {
    const invoicesTable = await getTableClient(INVOICES_TABLE);
    try {
      await invoicesTable.deleteEntity(parentEmail, id);
    } catch (err) {
      if (err.statusCode === 404) {
        context.res.status = 404;
        context.res.body = { success: false, message: "Không tìm thấy hoá đơn này." };
        return;
      }
      throw err;
    }

    context.res.status = 200;
    context.res.body = { success: true };
  } catch (err) {
    context.log.error("Lỗi xoá hoá đơn:", err.message);
    context.res.status = 500;
    context.res.body = { success: false, message: "Đã có lỗi xảy ra, vui lòng thử lại sau." };
  }
};
