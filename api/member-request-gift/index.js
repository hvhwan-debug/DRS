const { getTableClient } = require("../_shared/tableStorage");
const { findGift } = require("../_shared/giftCatalog");
const { getPointsBalance, redemptionPoints } = require("../_shared/memberTier");
const { getMemberDisplayName, buildGreeting } = require("../_shared/memberName");
const { sendTrackedEmail } = require("../_shared/sendTrackedEmail");

const SESSION_TABLE = "AuthSessions";
const REDEMPTIONS_TABLE = "GiftRedemptions";
const esc = v => String(v == null ? "" : v).replace(/[&<>"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));

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

  const body = req.body || {};
  const giftId = String(body.giftId || "").trim();
  // Thông tin nhận quà: số lượng + hình thức nhận (tại trung tâm / giao tận nơi) + người nhận
  const clip = (v, n) => String(v == null ? "" : v).replace(/[\u0000-\u001f]/g, " ").trim().slice(0, n);
  const quantity = Math.floor(Number(body.quantity || 1));
  const deliveryMethod = body.deliveryMethod === "ship" ? "ship" : "pickup";
  const recipientName = clip(body.recipientName, 100);
  const recipientPhone = clip(body.recipientPhone, 20);
  const shippingAddress = clip(body.shippingAddress, 300);
  const note = clip(body.note, 500);
  if (!(quantity >= 1 && quantity <= 50)) {
    context.res.status = 400;
    context.res.body = { success: false, message: "Số lượng phải từ 1 đến 50." };
    return;
  }
  if (deliveryMethod === "ship") {
    if (!recipientName || !shippingAddress || !/^[0-9+().\s-]{8,20}$/.test(recipientPhone)) {
      context.res.status = 400;
      context.res.body = { success: false, message: "Giao tận nơi cần đủ họ tên người nhận, số điện thoại hợp lệ và địa chỉ." };
      return;
    }
  }

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

    const totalCost = gift.cost * quantity;
    // Kiểm tra nhanh trước (để báo lỗi rõ ràng khi chắc chắn không đủ điểm)
    const before = await getPointsBalance(email);
    if (before.available < totalCost) {
      context.res.status = 403;
      context.res.body = { success: false, message: `Bạn cần ${totalCost.toLocaleString("vi-VN")} điểm cho ${quantity} phần quà này (hiện có ${before.available.toLocaleString("vi-VN")} điểm).` };
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
      giftCost: totalCost, // tổng ĐIỂM của lần đổi này (đơn giá × số lượng); điểm đã dùng = tổng giftCost các yêu cầu chưa huỷ
      unitCost: gift.cost,
      quantity,
      deliveryMethod, // pickup (nhận tại trung tâm) | ship (giao tận nơi)
      recipientName,
      recipientPhone,
      shippingAddress: deliveryMethod === "ship" ? shippingAddress : "",
      note,
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
        <p style="margin:0 0 16px;">Chúng tôi đã ghi nhận yêu cầu đổi quà <strong>${esc(gift.name)}${quantity > 1 ? ` × ${quantity}` : ""}</strong> của bạn (đã trừ <strong>${totalCost.toLocaleString("vi-VN")} điểm</strong>, còn lại <strong>${after.remaining.toLocaleString("vi-VN")} điểm</strong>) — trạng thái hiện tại: <strong>Chờ duyệt</strong>. Đội ngũ sẽ xét duyệt và cập nhật trạng thái sớm nhất.</p>
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border:1px solid #e2e8f0;border-collapse:collapse;margin:0 0 16px;font-family:Arial,Helvetica,sans-serif;font-size:13px;">
          ${[["Số lượng", String(quantity)], ["Hình thức nhận", deliveryMethod === "ship" ? "Giao tận nơi" : "Nhận tại trung tâm"],
             ...(deliveryMethod === "ship" ? [["Người nhận", recipientName], ["Số điện thoại", recipientPhone], ["Địa chỉ", shippingAddress]] : (recipientName ? [["Người nhận", recipientName + (recipientPhone ? " · " + recipientPhone : "")]] : [])),
             ...(note ? [["Ghi chú", note]] : [])]
            .map(([k, v]) => `<tr><td style="padding:8px 12px;border-bottom:1px solid #e2e8f0;color:#64748b;width:120px;font-family:Arial,Helvetica,sans-serif;">${k}</td><td style="padding:8px 12px;border-bottom:1px solid #e2e8f0;color:#0f172a;font-weight:bold;font-family:Arial,Helvetica,sans-serif;">${esc(v)}</td></tr>`).join("")}
        </table>`
    });

    context.res.status = 200;
    context.res.body = { success: true, available: after.remaining };
  } catch (err) {
    context.log.error("Lỗi yêu cầu đổi quà:", err.message);
    context.res.status = 500;
    context.res.body = { success: false, message: "Đã có lỗi xảy ra, vui lòng thử lại sau." };
  }
};
