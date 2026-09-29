const { getTableClient } = require("../_shared/tableStorage");
const { requireMember } = require("../_shared/memberSession");
const { INTERACTIONS_TABLE } = require("../_shared/crm");

// Phụ huynh xin nghỉ học cho con: lưu vào LeaveRequests, đồng thời ghi 1 dòng vào lịch sử chăm sóc
// CRM của học sinh để nhân viên thấy ngay. body: { studentId, date: "YYYY-MM-DD", reason }
module.exports = async function (context, req) {
  context.res = { headers: { "Content-Type": "application/json" } };
  const email = await requireMember(context, req); if (!email) return;
  const b = req.body || {};
  const studentId = String(b.studentId || "").trim();
  const date = String(b.date || "").trim();
  const reason = String(b.reason || "").trim().slice(0, 300);
  if (!/^[A-Za-z0-9_-]{1,80}$/.test(studentId) || !/^\d{4}-\d{2}-\d{2}$/.test(date) || !reason) {
    context.res.status = 400; context.res.body = { success: false, message: "Vui lòng chọn con, ngày nghỉ và lý do." }; return;
  }
  const today = new Date(); today.setHours(0, 0, 0, 0);
  if (new Date(date) < new Date(today.getTime() - 86400000)) {
    context.res.status = 400; context.res.body = { success: false, message: "Chỉ xin nghỉ cho hôm nay hoặc các ngày sắp tới." }; return;
  }
  try {
    const students = await getTableClient("Students");
    let student;
    try { student = await students.getEntity(email, studentId); } catch (e) { student = null; }
    if (!student) { context.res.status = 404; context.res.body = { success: false, message: "Không tìm thấy học sinh trong tài khoản của bạn." }; return; }
    const now = new Date().toISOString();
    const leaves = await getTableClient("LeaveRequests");
    const entity = { partitionKey: email, rowKey: `${date}_${studentId}`, studentId, studentName: student.studentName || "", program: student.program || "", date, reason, status: "submitted", createdAt: now };
    await leaves.upsertEntity(entity, "Replace");
    try {
      const it = await getTableClient(INTERACTIONS_TABLE);
      await it.createEntity({ partitionKey: studentId, rowKey: `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`, type: "khac", content: `Phụ huynh xin nghỉ học ngày ${date.split("-").reverse().join("/")}: ${reason}`, outcome: "", happenedAt: now, createdBy: "Phụ huynh (trang thành viên)", createdAt: now, auto: true });
    } catch (e) { context.log.warn("Không ghi được vào CRM:", e.message); }
    context.res.status = 200;
    context.res.body = { success: true, leave: { studentId, studentName: entity.studentName, date, reason, status: "submitted", createdAt: now } };
  } catch (err) {
    context.log.error("Lỗi xin nghỉ:", err.message);
    context.res.status = 500; context.res.body = { success: false, message: "Đã có lỗi xảy ra, vui lòng thử lại sau." };
  }
};
