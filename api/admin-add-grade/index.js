const { getTableClient } = require("../_shared/tableStorage");
const { requireAdmin } = require("../_shared/adminAuth");

const GRADES_TABLE = "Grades";

module.exports = async function (context, req) {
  context.res = { headers: { "Content-Type": "application/json" } };

  if (!(await requireAdmin(context, req))) return;

  const body = req.body || {};
  const parentEmail = String(body.parentEmail || "").trim().toLowerCase();
  const studentName = String(body.studentName || "").trim();
  const program = String(body.program || "").trim();
  const subject = String(body.subject || "").trim();
  const term = String(body.term || "").trim();
  const scoreRaw = body.score;
  const score = scoreRaw !== undefined && scoreRaw !== null && scoreRaw !== "" ? Number(scoreRaw) : null;
  const comment = String(body.comment || "").trim();

  const emailValid = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(parentEmail);
  if (!emailValid || !studentName || !subject) {
    context.res.status = 400;
    context.res.body = { success: false, message: "Vui lòng nhập đủ email phụ huynh, tên học sinh và môn học." };
    return;
  }
  if (score !== null && (isNaN(score) || score < 0 || score > 10)) {
    context.res.status = 400;
    context.res.body = { success: false, message: "Điểm số phải là số từ 0 đến 10 (hoặc để trống nếu chỉ ghi nhận xét)." };
    return;
  }

  try {
    const gradesTable = await getTableClient(GRADES_TABLE);
    await gradesTable.createEntity({
      partitionKey: parentEmail,
      rowKey: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      studentName,
      program,
      subject,
      term,
      score,
      comment,
      recordedAt: new Date().toISOString()
    });

    context.res.status = 200;
    context.res.body = { success: true };
  } catch (err) {
    context.log.error("Lỗi thêm điểm:", err.message);
    context.res.status = 500;
    context.res.body = { success: false, message: "Đã có lỗi xảy ra, vui lòng thử lại sau." };
  }
};
