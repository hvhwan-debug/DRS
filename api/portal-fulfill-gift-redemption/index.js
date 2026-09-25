const { getTableClient } = require("../_shared/tableStorage");
const { requireAdmin } = require("../_shared/adminAuth");
const { getMemberDisplayName, buildGreeting } = require("../_shared/memberName");
const { sendTrackedEmail } = require("../_shared/sendTrackedEmail");

const REDEMPTIONS_TABLE = "GiftRedemptions";

module.exports = async function (context, req) {
  context.res = { headers: { "Content-Type": "application/json" } };

  if (!(await requireAdmin(context, req))) return;

  const body = req.body || {};
  const email = String(body.email || "").trim().toLowerCase();
  const id = String(body.id || "").trim();
  if (!email || !id) {
    context.res.status = 400;
    context.res.body = { success: false, message: "Thiếu thông tin." };
    return;
  }

  try {
    const redemptionsTable = await getTableClient(REDEMPTIONS_TABLE);
    let entity;
    try {
      entity = await redemptionsTable.getEntity(email, id);
    } catch (err) {
      if (err.statusCode === 404) {
        context.res.status = 404;
        context.res.body = { success: false, message: "Không tìm thấy yêu cầu đổi quà này." };
        return;
      }
      throw err;
    }

    await redemptionsTable.updateEntity({
      partitionKey: email,
      rowKey: id,
      status: "fulfilled",
      fulfilledAt: new Date().toISOString()
    }, "Merge");

    const displayName = await getMemberDisplayName(email);
    const greeting = buildGreeting(displayName);
    const emailResult = await sendTrackedEmail(context, {
      to: email,
      subject: `Đã trao quà: ${entity.giftName}`,
      html: `<!DOCTYPE html><html lang="vi"><body style="font-family:Arial,sans-serif;padding:24px;color:#0f172a;">
        <p>${greeting}</p>
        <p>Quà tặng <strong>${entity.giftName}</strong> của bạn đã được trao. Cảm ơn sự đồng hành của bạn cùng Mạng Lưới Tri Thức Việt Nam!</p>
        <p>Trân trọng,<br>Mạng Lưới Tri Thức Việt Nam</p>
      </body></html>`,
      type: "gift"
    });

    context.res.status = 200;
    context.res.body = { success: true, warning: emailResult.success ? null : "Đã đánh dấu trao quà, nhưng gửi email báo thất bại." };
  } catch (err) {
    context.log.error("Lỗi cập nhật đổi quà:", err.message);
    context.res.status = 500;
    context.res.body = { success: false, message: "Đã có lỗi xảy ra, vui lòng thử lại sau." };
  }
};
