const sgMail = require("@sendgrid/mail");
const { getTableClient } = require("../_shared/tableStorage");
const { findGift } = require("../_shared/giftCatalog");
const { getMemberDisplayName, buildGreeting } = require("../_shared/memberName");

const SESSION_TABLE = "AuthSessions";
const TUITION_TABLE = "TuitionPayments";
const REDEMPTIONS_TABLE = "GiftRedemptions";

function getMemberToken(req) {
  const header = req.headers && (req.headers["x-member-token"] || req.headers["X-Member-Token"]);
  return header ? header.trim() : null;
}

module.exports = async function (context, req) {
  context.res = { headers: { "Content-Type": "application/json" } };

  const token = getMemberToken(req);
  if (!token) {
    context.res.status = 401;
    context.res.body = { success: false, message: "Chưa đăng nhập." };
    return;
  }

  const giftId = String((req.body && req.body.giftId) || "").trim();
  const gift = findGift(giftId);
  if (!gift) {
    context.res.status = 400;
    context.res.body = { success: false, message: "Không tìm thấy quà tặng này." };
    return;
  }

  try {
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

    // Tính lại tổng học phí đã đóng ngay tại server để đảm bảo đúng điều kiện, không tin dữ liệu từ client
    const tuitionTable = await getTableClient(TUITION_TABLE);
    let totalPaid = 0;
    const iterator = tuitionTable.listEntities({
      queryOptions: { filter: `PartitionKey eq '${email.replace(/'/g, "''")}'` }
    });
    for await (const entity of iterator) {
      totalPaid += Number(entity.amount) || 0;
    }

    if (totalPaid < gift.cost) {
      context.res.status = 403;
      context.res.body = { success: false, message: `Bạn cần tổng học phí tối thiểu ${gift.cost.toLocaleString("vi-VN")}đ để đổi quà này.` };
      return;
    }

    const redemptionsTable = await getTableClient(REDEMPTIONS_TABLE);

    // Không cho đổi trùng quà đã yêu cầu hoặc đã nhận trước đó
    const existingIterator = redemptionsTable.listEntities({
      queryOptions: { filter: `PartitionKey eq '${email.replace(/'/g, "''")}' and giftId eq '${giftId}'` }
    });
    for await (const existing of existingIterator) {
      if (existing.status !== "cancelled") {
        context.res.status = 409;
        context.res.body = { success: false, message: "Bạn đã yêu cầu đổi quà này rồi." };
        return;
      }
    }

    const rowKey = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    await redemptionsTable.createEntity({
      partitionKey: email,
      rowKey,
      giftId,
      giftName: gift.name,
      giftCost: gift.cost,
      status: "pending",
      requestedAt: new Date().toISOString()
    });

    // Báo cho đội ngũ qua email admin? Không bắt buộc — chỉ báo lại cho chính thành viên để xác nhận đã ghi nhận
    const apiKey = process.env.SENDGRID_API_KEY;
    const fromEmail = process.env.SENDGRID_FROM_EMAIL;
    if (apiKey && fromEmail) {
      try {
        const displayName = await getMemberDisplayName(email);
        const greeting = buildGreeting(displayName);
        sgMail.setApiKey(apiKey);
        await sgMail.send({
          to: email,
          from: { email: fromEmail, name: "Mạng Lưới Tri Thức Việt Nam" },
          subject: `Đã ghi nhận yêu cầu đổi quà: ${gift.name}`,
          html: `<!DOCTYPE html><html lang="vi"><body style="font-family:Arial,sans-serif;padding:24px;color:#0f172a;">
            <p>${greeting}</p>
            <p>Chúng tôi đã ghi nhận yêu cầu đổi quà <strong>${gift.name}</strong> của bạn. Đội ngũ sẽ liên hệ sắp xếp trao quà sớm nhất.</p>
            <p>Trân trọng,<br>Mạng Lưới Tri Thức Việt Nam</p>
          </body></html>`
        });
      } catch (err) {
        context.log.error("Gửi email báo đổi quà thất bại:", err?.response?.body || err.message);
      }
    }

    context.res.status = 200;
    context.res.body = { success: true };
  } catch (err) {
    context.log.error("Lỗi yêu cầu đổi quà:", err.message);
    context.res.status = 500;
    context.res.body = { success: false, message: "Đã có lỗi xảy ra, vui lòng thử lại sau." };
  }
};
