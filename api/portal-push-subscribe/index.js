const { requireAdmin, getAdminIdentity } = require("../_shared/adminAuth");
const { saveSubscription, removeSubscription } = require("../_shared/push");

// Lưu (hoặc gỡ) đăng ký nhận thông báo đẩy của THIẾT BỊ đang gọi, gắn với tài khoản admin đang
// đăng nhập. Một người có thể có nhiều thiết bị (máy tính, điện thoại) — mỗi thiết bị 1 dòng riêng.
module.exports = async function (context, req) {
  context.res = { headers: { "Content-Type": "application/json" } };
  if (!(await requireAdmin(context, req))) return;

  const b = req.body || {};
  const sub = b.subscription;
  if (!sub || !sub.endpoint) { context.res.status = 400; context.res.body = { success: false, message: "Thiếu thông tin đăng ký thiết bị." }; return; }

  try {
    const who = (await getAdminIdentity(req)) || {};
    if (!who.email) { context.res.status = 401; context.res.body = { success: false, message: "Không xác định được tài khoản." }; return; }

    if (b.action === "unsubscribe") {
      await removeSubscription(who.email, sub.endpoint);
      context.res.status = 200; context.res.body = { success: true, unsubscribed: true };
      return;
    }
    await saveSubscription(who.email, sub);
    context.res.status = 200; context.res.body = { success: true };
  } catch (err) {
    context.log.error("Lỗi lưu đăng ký thông báo đẩy:", err.message);
    context.res.status = 500; context.res.body = { success: false, message: "Đã có lỗi xảy ra, vui lòng thử lại sau." };
  }
};
