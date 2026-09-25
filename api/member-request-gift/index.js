const { getTableClient } = require("../_shared/tableStorage");
const { findGift } = require("../_shared/giftCatalog");
const { getPointsBalance, adjustSpentPoints } = require("../_shared/memberTier");
const { getMemberDisplayName, buildGreeting } = require("../_shared/memberName");
const { sendTrackedEmail } = require("../_shared/sendTrackedEmail");

const SESSION_TABLE = "AuthSessions";
const REDEMPTIONS_TABLE = "GiftRedemptions";

function getMemberToken(req) {
  const header = req.headers && (req.headers["x-member-token"] || req.headers["X-Member-Token"]);
  return header ? header.trim() : null;
}

// Đổi quà dùng ĐIỂM TÍCH LŨY làm "tiền tệ" — không giới hạn số lần đổi theo hạng, thành viên có
// thể đổi CÙNG 1 quà nhiều lần miễn còn đủ điểm (điểm bị trừ ngay khi gửi yêu cầu, hoàn lại nếu
// yêu cầu bị huỷ — xem portal-fulfill-gift-redemption).
module.exports = async function (context, req) {
  context.res = { headers: { "Content-Type": "application/json" } };

  const token = getMemberToken(req);
  if (!token) {
    context.res.status = 401;
    context.res.body = { success: false, message: "Chưa đăng nhập." };
    return;
  }

  const giftId = String((req.body && req.body.giftId) || "").trim();

  try {
    const gift = await findGift(giftId);
    if (!gift) {
      context.res.status = 400;
      context.res.body = { success: false, message: "Không tìm thấy quà tặng này." };
      return;
    }

    const sessionTable = await getTableClient(SESSION_TABLE);
    let session;
    try {
      session = await sessionTable.getEntity("session", token);
    } catch (err) {
      if (err.statusCode === 404) {
        context.res.status = 401;
        context.res.body = { success: false, message: "Phiên đăng nhập không hợp lệ." };
        return;
      }
      throw err;
    }
    if (new Date(session.expiresAt).getTime() < Date.now()) {
      context.res.status = 401;
      context.res.body = { success: false, message: "Phiên đăng nhập đã hết hạn." };
      return;
    }
    const email = session.email;

    // Tính lại điểm khả dụng ngay tại server để đảm bảo đúng điều kiện, không tin dữ liệu từ client
    const { available } = await getPointsBalance(email);
    if (available < gift.cost) {
      context.res.status = 403;
      context.res.body = { success: false, message: `Bạn cần ${gift.cost.toLocaleString("vi-VN")} điểm để đổi quà này (hiện có ${available.toLocaleString("vi-VN")} điểm).` };
      return;
    }

    // Trừ điểm NGAY khi gửi yêu cầu (giữ chỗ) — hoàn lại nếu yêu cầu bị huỷ sau đó.
    await adjustSpentPoints(email, gift.cost);

    const redemptionsTable = await getTableClient(REDEMPTIONS_TABLE);
    const rowKey = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    await redemptionsTable.createEntity({
      partitionKey: email,
      rowKey,
      giftId,
      giftName: gift.name,
      giftCost: gift.cost, // số ĐIỂM đã dùng cho lần đổi này (dùng để hoàn điểm nếu huỷ)
      status: "pending", // pending (Chờ duyệt) -> shipping (Đang vận chuyển) -> fulfilled (Đã trao quà) | cancelled (Huỷ)
      requestedAt: new Date().toISOString()
    });

    // Báo lại cho chính thành viên để xác nhận đã ghi nhận (best-effort, tự chuyển bản premium nếu là VIP)
    const displayName = await getMemberDisplayName(email);
    const greeting = buildGreeting(displayName);
    await sendTrackedEmail(context, {
      to: email,
      subject: `Đã ghi nhận yêu cầu đổi quà: ${gift.name}`,
      type: "gift",
      eyebrow: "Đổi Quà Tặng",
      title: "Đã ghi nhận yêu cầu",
      bodyHtml: `<p style="margin:0 0 16px;">${greeting}</p>
        <p style="margin:0 0 16px;">Chúng tôi đã ghi nhận yêu cầu đổi quà <strong>${gift.name}</strong> của bạn (đã trừ <strong>${gift.cost.toLocaleString("vi-VN")} điểm</strong>) — trạng thái hiện tại: <strong>Chờ duyệt</strong>. Đội ngũ sẽ xét duyệt và cập nhật trạng thái sớm nhất.</p>`
    });

    context.res.status = 200;
    context.res.body = { success: true };
  } catch (err) {
    context.log.error("Lỗi yêu cầu đổi quà:", err.message);
    context.res.status = 500;
    context.res.body = { success: false, message: "Đã có lỗi xảy ra, vui lòng thử lại sau." };
  }
};
