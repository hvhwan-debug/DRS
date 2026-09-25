const { getTableClient } = require("../_shared/tableStorage");
const { requireAdmin } = require("../_shared/adminAuth");

const SCHEDULE_TABLE = "ClassSchedules";

module.exports = async function (context, req) {
  context.res = { headers: { "Content-Type": "application/json" } };

  if (!(await requireAdmin(context, req))) return;

  try {
    const scheduleTable = await getTableClient(SCHEDULE_TABLE);
    const schedules = [];
    for await (const entity of scheduleTable.listEntities()) {
      schedules.push({
        id: entity.rowKey,
        program: entity.program,
        days: entity.days,
        startTime: entity.startTime,
        endTime: entity.endTime,
        location: entity.location || "",
        teacherName: entity.teacherName || "",
        note: entity.note || ""
      });
    }
    schedules.sort((a, b) => a.program.localeCompare(b.program));

    context.res.status = 200;
    context.res.body = { success: true, schedules };
  } catch (err) {
    context.log.error("Lỗi lấy danh sách lịch học:", err.message);
    context.res.status = 500;
    context.res.body = { success: false, message: "Đã có lỗi xảy ra, vui lòng thử lại sau." };
  }
};
