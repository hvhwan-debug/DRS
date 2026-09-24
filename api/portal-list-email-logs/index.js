const { getTableClient } = require("../_shared/tableStorage");
const { requireAdmin } = require("../_shared/adminAuth");

const EMAIL_LOGS_TABLE = "EmailLogs";
const MAX_LOGS = 300;

module.exports = async function (context, req) {
  context.res = { headers: { "Content-Type": "application/json" } };

  if (!(await requireAdmin(context, req))) return;

  try {
    const logsTable = await getTableClient(EMAIL_LOGS_TABLE);
    const logs = [];
    for await (const entity of logsTable.listEntities()) {
      logs.push({
        to: entity.to,
        subject: entity.subject,
        type: entity.type || "other",
        success: !!entity.success,
        errorMessage: entity.errorMessage || "",
        sentAt: entity.sentAt
      });
    }
    logs.sort((a, b) => new Date(b.sentAt) - new Date(a.sentAt));

    context.res.status = 200;
    context.res.body = { success: true, logs: logs.slice(0, MAX_LOGS), total: logs.length };
  } catch (err) {
    context.log.error("Lỗi lấy lịch sử email:", err.message);
    context.res.status = 500;
    context.res.body = { success: false, message: "Đã có lỗi xảy ra, vui lòng thử lại sau." };
  }
};
