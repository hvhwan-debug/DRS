const { getTableClient } = require("../_shared/tableStorage");
const { requireAdmin } = require("../_shared/adminAuth");

const DONATIONS_TABLE = "Donations";

module.exports = async function (context, req) {
  context.res = { headers: { "Content-Type": "application/json" } };

  if (!(await requireAdmin(context, req))) return;

  try {
    const donationsTable = await getTableClient(DONATIONS_TABLE);
    const donations = [];
    for await (const entity of donationsTable.listEntities()) {
      donations.push({
        id: entity.rowKey,
        donorName: entity.donorName,
        donorEmail: entity.donorEmail || "",
        amount: entity.amount,
        method: entity.method || "",
        note: entity.note || "",
        donatedAt: entity.donatedAt,
        recordedAt: entity.recordedAt
      });
    }
    donations.sort((a, b) => new Date(b.donatedAt) - new Date(a.donatedAt));

    context.res.status = 200;
    context.res.body = { success: true, donations };
  } catch (err) {
    context.log.error("Lỗi lấy danh sách quyên góp:", err.message);
    context.res.status = 500;
    context.res.body = { success: false, message: "Đã có lỗi xảy ra, vui lòng thử lại sau." };
  }
};
