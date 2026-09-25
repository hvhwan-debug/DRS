const { requireAdmin } = require("../_shared/adminAuth");
const { listAllGiftCatalog } = require("../_shared/giftCatalog");

module.exports = async function (context, req) {
  context.res = { headers: { "Content-Type": "application/json" } };

  if (!(await requireAdmin(context, req))) return;

  try {
    const items = await listAllGiftCatalog();
    context.res.status = 200;
    context.res.body = { success: true, items };
  } catch (err) {
    context.log.error("Lỗi lấy danh mục quà tặng:", err.message);
    context.res.status = 500;
    context.res.body = { success: false, message: "Đã có lỗi xảy ra, vui lòng thử lại sau." };
  }
};
