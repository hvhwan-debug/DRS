const { getTableClient } = require("../_shared/tableStorage");
const { requireSuperAdmin } = require("../_shared/adminAuth");

const EMPLOYEES_TABLE = "Employees";

// Mức đầy đủ của hồ sơ — chỉ trả về cờ đủ/thiếu, KHÔNG trả số CCCD hay đường dẫn giấy tờ ra danh sách.
function completeness(e) {
  const checks = [
    ["Ngày sinh & địa chỉ", !!(e.dob && e.address)],
    ["Số CCCD", !!e.idNumber],
    ["Ảnh CCCD (2 mặt)", !!(e.cccdFrontBlobName && e.cccdBackBlobName)],
    ["Liên hệ khẩn cấp", !!(e.emergencyContactName && e.emergencyContactPhone)],
    ["Hợp đồng (loại và ngày bắt đầu)", !!(e.contractType && e.contractStart)],
    ["File hợp đồng", !!e.contractFileBlobName],
    ["Tài khoản chấm công", !!e.linkedAdminEmail]
  ];
  const missing = checks.filter(c => !c[1]).map(c => c[0]);
  return { missing, doneCount: checks.length - missing.length, totalCount: checks.length };
}

module.exports = async function (context, req) {
  context.res = { headers: { "Content-Type": "application/json" } };
  if (!(await requireSuperAdmin(context, req))) return;

  try {
    const table = await getTableClient(EMPLOYEES_TABLE);
    const employees = [];
    const it = table.listEntities({ queryOptions: { filter: "PartitionKey eq 'employee'" } });
    for await (const e of it) {
      employees.push({
        id: e.rowKey,
        fullName: e.fullName || "",
        position: e.position || "",
        contractType: e.contractType || "",
        contractStart: e.contractStart || "",
        contractEnd: e.contractEnd || "",
        status: e.status || "active",
        hasAvatar: !!e.avatarBlobName,
        linkedAdminEmail: e.linkedAdminEmail || "",
        updatedAt: e.updatedAt || e.createdAt || "",
        updatedBy: e.updatedBy || "",
        ...completeness(e)
      });
    }
    employees.sort((a, b) => (a.fullName || "").localeCompare(b.fullName || "", "vi"));
    context.res.status = 200;
    context.res.body = { success: true, employees };
  } catch (err) {
    context.log.error("Lỗi tải danh sách hồ sơ nhân sự:", err.message);
    context.res.status = 500;
    context.res.body = { success: false, message: "Đã có lỗi xảy ra, vui lòng thử lại sau." };
  }
};
