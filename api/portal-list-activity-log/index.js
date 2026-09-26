const { getTableClient } = require("../_shared/tableStorage");
const { requireAdmin } = require("../_shared/adminAuth");
const { ACTIVITY_LOG_TABLE } = require("../_shared/activityLog");

const MAX_ROWS = 200;

module.exports = async function (context, req) {
  context.res = { headers: { "Content-Type": "application/json" } };

  if (!(await requireAdmin(context, req))) return;

  try {
    const table = await getTableClient(ACTIVITY_LOG_TABLE);
    const entries = [];
    // Nhật ký ghi theo ngày (partitionKey = YYYY-MM-DD) — chỉ cần quét vài ngày gần nhất là đủ
    // 200 dòng gần nhất trong hầu hết trường hợp thực tế của 1 trung tâm nhỏ, không cần index phức tạp.
    for await (const entity of table.listEntities()) {
      entries.push({
        adminName: entity.adminName,
        action: entity.action,
        details: entity.details || "",
        createdAt: entity.createdAt
      });
    }
    entries.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));

    context.res.status = 200;
    context.res.body = { success: true, entries: entries.slice(0, MAX_ROWS) };
  } catch (err) {
    context.log.error("Lỗi lấy nhật ký thao tác:", err.message);
    context.res.status = 500;
    context.res.body = { success: false, message: "Đã có lỗi xảy ra, vui lòng thử lại sau." };
  }
};
