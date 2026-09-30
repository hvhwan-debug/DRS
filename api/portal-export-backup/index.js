const { logAdminActivity, summarizeBody } = require("../_shared/activityLog");
const { getTableClient } = require("../_shared/tableStorage");
const { requireSuperAdmin } = require("../_shared/adminAuth");

// Sao lưu "đơn giản nhất": đọc toàn bộ các bảng nghiệp vụ chính, trả về 1 file JSON duy nhất
// để admin tải về lưu ngoài. KHÔNG gồm các bảng phiên đăng nhập/OTP (không cần backup, sẽ tự
// hết hạn) và KHÔNG gồm mật khẩu (Members có passwordHash/salt — vẫn giữ lại để có thể khôi phục
// tài khoản nếu cần, nhưng admin cần tự bảo mật file backup này như bảo mật mật khẩu thật).
const TABLES = [
  "Members", "MemberProfiles", "Registrations", "Donations", "Grades", "TuitionPayments",
  "ClassSchedules", "Students", "GiftRedemptions", "GiftCatalog", "Invoices", "Attendance",
  "Transactions", "EmailLogs",
  // Chấm công & tính lương
  "StaffPayProfiles", "StaffTimeEntries", "StaffLeave", "PayAdjustments", "Payslips", "PayPeriods", "PayrollSettings",
  // CRM, công việc, đơn xin nghỉ học
  "StudentCrm", "StudentInteractions", "WorkTasks", "WorkProjects", "LeaveRequests"
];

module.exports = async function (context, req) {
  context.res = { headers: { "Content-Type": "application/json" } };

  if (!(await requireSuperAdmin(context, req))) return;

  try {
    const backup = { exportedAt: new Date().toISOString(), tables: {} };
    for (const tableName of TABLES) {
      try {
        const table = await getTableClient(tableName);
        const rows = [];
        for await (const entity of table.listEntities()) {
          // Bỏ field nội bộ (etag/timestamp) của Azure Table Storage, giữ nguyên dữ liệu thật
          const { etag, timestamp, ...rest } = entity;
          rows.push(rest);
        }
        backup.tables[tableName] = rows;
      } catch (e) {
        context.log.error(`Lỗi đọc bảng ${tableName} khi sao lưu:`, e.message);
        backup.tables[tableName] = { error: e.message };
      }
    }

    await logAdminActivity(req, "Tải bản sao lưu dữ liệu", summarizeBody(req.body));
    context.res.status = 200;
    context.res.body = { success: true, backup };
  } catch (err) {
    context.log.error("Lỗi sao lưu dữ liệu:", err.message);
    context.res.status = 500;
    context.res.body = { success: false, message: "Đã có lỗi xảy ra, vui lòng thử lại sau." };
  }
};
