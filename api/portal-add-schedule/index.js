const { getTableClient } = require("../_shared/tableStorage");
const { requireAdmin } = require("../_shared/adminAuth");

const SCHEDULE_TABLE = "ClassSchedules";

module.exports = async function (context, req) {
  context.res = { headers: { "Content-Type": "application/json" } };

  if (!(await requireAdmin(context, req))) return;

  const body = req.body || {};
  const id = String(body.id || "").trim(); // nếu có id -> sửa, không có -> tạo mới
  const program = String(body.program || "").trim();
  const days = String(body.days || "").trim();
  const startTime = String(body.startTime || "").trim();
  const endTime = String(body.endTime || "").trim();
  const location = String(body.location || "").trim();
  const teacherName = String(body.teacherName || "").trim();
  const note = String(body.note || "").trim();

  if (!program || !days || !startTime || !endTime) {
    context.res.status = 400;
    context.res.body = { success: false, message: "Vui lòng nhập đủ chương trình học, ngày học và giờ học." };
    return;
  }

  try {
    const scheduleTable = await getTableClient(SCHEDULE_TABLE);
    const rowKey = id || `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    await scheduleTable.upsertEntity({
      partitionKey: "schedule",
      rowKey,
      program,
      days,
      startTime,
      endTime,
      location,
      teacherName,
      note,
      updatedAt: new Date().toISOString()
    }, "Merge");

    context.res.status = 200;
    context.res.body = { success: true };
  } catch (err) {
    context.log.error("Lỗi lưu lịch học:", err.message);
    context.res.status = 500;
    context.res.body = { success: false, message: "Đã có lỗi xảy ra, vui lòng thử lại sau." };
  }
};
