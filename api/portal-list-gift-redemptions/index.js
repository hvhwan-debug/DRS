const { getTableClient } = require("../_shared/tableStorage");
const { requireAdmin } = require("../_shared/adminAuth");

const REDEMPTIONS_TABLE = "GiftRedemptions";

module.exports = async function (context, req) {
  context.res = { headers: { "Content-Type": "application/json" } };

  if (!(await requireAdmin(context, req))) return;

  try {
    const redemptionsTable = await getTableClient(REDEMPTIONS_TABLE);
    const redemptions = [];
    for await (const entity of redemptionsTable.listEntities()) {
      redemptions.push({
        id: entity.rowKey,
        email: entity.partitionKey,
        giftId: entity.giftId,
        giftName: entity.giftName,
        giftCost: entity.giftCost,
        status: entity.status || "pending",
        requestedAt: entity.requestedAt,
        shippedAt: entity.shippedAt || null,
        fulfilledAt: entity.fulfilledAt || null,
        cancelledAt: entity.cancelledAt || null,
        cancelReason: entity.cancelReason || ""
      });
    }
    redemptions.sort((a, b) => new Date(b.requestedAt) - new Date(a.requestedAt));

    context.res.status = 200;
    context.res.body = { success: true, redemptions };
  } catch (err) {
    context.log.error("Lỗi lấy danh sách đổi quà:", err.message);
    context.res.status = 500;
    context.res.body = { success: false, message: "Đã có lỗi xảy ra, vui lòng thử lại sau." };
  }
};
