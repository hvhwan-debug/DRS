const { getTableClient } = require("../_shared/tableStorage");
const { requireAdmin } = require("../_shared/adminAuth");

const DONATIONS_TABLE = "Donations";

module.exports = async function (context, req) {
  context.res = { headers: { "Content-Type": "application/json" } };

  if (!(await requireAdmin(context, req))) return;

  const body = req.body || {};
  const donorName = String(body.donorName || "").trim();
  const donorEmail = String(body.donorEmail || "").trim().toLowerCase();
  const amount = Number(body.amount);
  const method = String(body.method || "").trim();
  const note = String(body.note || "").trim();
  const donatedAt = body.donatedAt ? new Date(body.donatedAt).toISOString() : new Date().toISOString();

  if (!donorName || !amount || amount <= 0) {
    context.res.status = 400;
    context.res.body = { success: false, message: "Vui lòng nhập tên người quyên góp và số tiền hợp lệ." };
    return;
  }

  try {
    const donationsTable = await getTableClient(DONATIONS_TABLE);
    await donationsTable.createEntity({
      partitionKey: "donation",
      rowKey: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      donorName,
      donorEmail,
      amount,
      method,
      note,
      donatedAt,
      recordedAt: new Date().toISOString()
    });

    context.res.status = 200;
    context.res.body = { success: true };
  } catch (err) {
    context.log.error("Lỗi thêm quyên góp:", err.message);
    context.res.status = 500;
    context.res.body = { success: false, message: "Đã có lỗi xảy ra, vui lòng thử lại sau." };
  }
};
