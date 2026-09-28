const { getTableClient } = require("../_shared/tableStorage");
const { findGift } = require("../_shared/giftCatalog");
const { getPointsBalance, redemptionPoints } = require("../_shared/memberTier");
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

    if (!(gift.cost > 0)) {
      context.res.status = 400;
      context.res.body = { success: false, message: "Quà tặng này chưa được đặt số điểm, vui lòng liên hệ trung tâm." };
      return;
    }

    // Kiểm tra nhanh trước (để báo lỗi rõ ràng khi chắc chắn không đủ điểm)
    const before = await getPointsBalance(email);
    if (before.available < gift.cost) {
      context.res.status = 403;
      context.res.body = { success: false, message: `Bạn cần ${gift.cost.toLocaleString("vi-VN")} điểm để đổi quà này (hiện có ${before.available.toLocaleString("vi-VN")} điểm).` };
      return;
    }

    // Tạo yêu cầu TRƯỚC rồi mới kiểm tra lại số dư SAU KHI đã tính cả yêu cầu này. Nếu thành viên
    // bấm nhiều lần / mở nhiều tab cùng lúc, các yêu cầu đều hiện ra trong phép tính nên không thể
    // tiêu vượt số điểm đang có; yêu cầu nào làm số dư âm sẽ tự rút lại ngay.
    const redemptionsTable = await getTableClient(REDEMPTIONS_TABLE);
    const rowKey = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    await redemptionsTable.createEntity({
      partitionKey: email,
      rowKey,
      giftId,
      giftName: gift.name,
      giftCost: gift.cost, // số ĐIỂM của lần đổi này; điểm đã dùng = tổng giftCost các yêu cầu chưa huỷ
      pointsBased: true, // đánh dấu yêu cầu theo cơ chế điểm (phân biệt với yêu cầu cũ theo mốc học phí VNĐ)
      status: "pending", // pending (Chờ duyệt) -> shipping (Đang vận chuyển) -> fulfilled (Đã trao quà) | cancelled (Huỷ)
      requestedAt: new Date().toISOString()
    });
    // Xếp các yêu cầu CHƯA HUỶ theo thứ tự gửi: yêu cầu gửi trước được ưu tiên. Yêu cầu này chỉ được
    // giữ nếu tính đến nó, tổng điểm vẫn trong số điểm đã tích lũy. Kiểm tra 2 lần (cách nhau chốc lát)
    // để bắt cả trường hợp một yêu cầu gửi trước nhưng ghi xong chậm hơn.
    const fitsInOrder = async () => {
      const earned = (await getPointsBalance(email)).earned;
      const rows = [];
      for await (const r of redemptionsTable.listEntities({ queryOptions: { filter: `PartitionKey eq '${email.replace(/'/g, "''")}'` } })) {
        if ((r.status || "pending") !== "cancelled") rows.push(r);
      }
      rows.sort((a, b) => (a.rowKey < b.rowKey ? -1 : a.rowKey > b.rowKey ? 1 : 0));
      let cumulative = 0, spentAll = 0;
      for (const r of rows) {
        const pts = redemptionPoints(r);
        spentAll += pts;
        if (r.rowKey <= rowKey) cumulative += pts;
      }
      return { ok: cumulative <= earned, remaining: Math.max(0, earned - spentAll) };
    };
    let check = await fitsInOrder();
    if (check.ok) { await new Promise(r => setTimeout(r, 250)); check = await fitsInOrder(); }
    if (!check.ok) {
      await redemptionsTable.deleteEntity(email, rowKey).catch(() => {});
      context.res.status = 409;
      context.res.body = { success: false, message: "Số điểm không còn đủ cho yêu cầu này (bạn vừa gửi yêu cầu khác cùng lúc). Vui lòng tải lại trang để xem số điểm mới." };
      return;
    }
    const after = { remaining: check.remaining };

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
        <p style="margin:0 0 16px;">Chúng tôi đã ghi nhận yêu cầu đổi quà <strong>${gift.name}</strong> của bạn (đã trừ <strong>${gift.cost.toLocaleString("vi-VN")} điểm</strong>, còn lại <strong>${after.remaining.toLocaleString("vi-VN")} điểm</strong>) — trạng thái hiện tại: <strong>Chờ duyệt</strong>. Đội ngũ sẽ xét duyệt và cập nhật trạng thái sớm nhất.</p>`
    });

    context.res.status = 200;
    context.res.body = { success: true, available: after.remaining };
  } catch (err) {
    context.log.error("Lỗi yêu cầu đổi quà:", err.message);
    context.res.status = 500;
    context.res.body = { success: false, message: "Đã có lỗi xảy ra, vui lòng thử lại sau." };
  }
};
