const { getTableClient } = require("../_shared/tableStorage");
const { requireMember } = require("../_shared/memberSession");

// Tuỳ chọn nhận email của thành viên. Email bắt buộc (hoá đơn, học phí, bảo mật tài khoản) luôn được gửi;
// thành viên chỉ tắt được email tin tức/sự kiện (gửi hàng loạt) và email nhắc lịch học.
const KEYS = ["news", "reminders"];
module.exports = async function (context, req) {
  context.res = { headers: { "Content-Type": "application/json" } };
  const email = await requireMember(context, req); if (!email) return;
  const input = (req.body && req.body.prefs) || {};
  const prefs = {}; KEYS.forEach(k => { prefs[k] = input[k] !== false; });
  try {
    const t = await getTableClient("MemberProfiles");
    await t.upsertEntity({ partitionKey: "profile", rowKey: email, prefsJson: JSON.stringify(prefs), prefsUpdatedAt: new Date().toISOString() }, "Merge");
    context.res.status = 200; context.res.body = { success: true, prefs };
  } catch (err) {
    context.log.error("Lỗi lưu tuỳ chọn:", err.message);
    context.res.status = 500; context.res.body = { success: false, message: "Đã có lỗi xảy ra, vui lòng thử lại sau." };
  }
};
