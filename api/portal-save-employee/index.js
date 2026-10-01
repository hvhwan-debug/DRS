const { getTableClient } = require("../_shared/tableStorage");
const { requireSuperAdmin, getAdminIdentity } = require("../_shared/adminAuth");
const { logAdminActivity } = require("../_shared/activityLog");

const EMPLOYEES_TABLE = "Employees";
const NOTES_TABLE = "EmployeeNotes";

function genId() {
  return `emp-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

module.exports = async function (context, req) {
  context.res = { headers: { "Content-Type": "application/json" } };
  if (!(await requireSuperAdmin(context, req))) return;

  const body = req.body || {};
  const fullName = String(body.fullName || "").trim();
  if (!fullName) {
    context.res.status = 400;
    context.res.body = { success: false, message: "Thiếu họ tên nhân sự." };
    return;
  }

  const id = String(body.id || "").trim() || genId();
  const isNew = !body.id;

  const fields = {
    fullName,
    dob: String(body.dob || "").trim(),
    idNumber: String(body.idNumber || "").trim(),
    address: String(body.address || "").trim(),
    emergencyContactName: String(body.emergencyContactName || "").trim(),
    emergencyContactPhone: String(body.emergencyContactPhone || "").trim(),
    position: String(body.position || "").trim(),
    contractType: String(body.contractType || "").trim(),
    contractStart: String(body.contractStart || "").trim(),
    contractEnd: String(body.contractEnd || "").trim(),
    linkedAdminEmail: String(body.linkedAdminEmail || "").trim().toLowerCase(),
    status: String(body.status || "active").trim()
  };

  try {
    const table = await getTableClient(EMPLOYEES_TABLE);
    const now = new Date().toISOString();
    let createdAt = now;
    if (!isNew) {
      try {
        const existing = await table.getEntity("employee", id);
        createdAt = existing.createdAt || now;
      } catch (e) { /* không tìm thấy -> coi như tạo mới, vẫn dùng id được gửi lên */ }
    }

    await table.upsertEntity({
      partitionKey: "employee", rowKey: id, ...fields, createdAt, updatedAt: now, updatedBy: "admin"
    }, "Merge");

    if (isNew) {
      const identity = await getAdminIdentity(req);
      const notesTable = await getTableClient(NOTES_TABLE);
      await notesTable.createEntity({
        partitionKey: id, rowKey: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
        note: "Tạo hồ sơ nhân sự", type: "system", author: identity ? identity.displayName : "", at: now
      });
    }

    await logAdminActivity(req, isNew ? "Tạo hồ sơ nhân sự" : "Sửa hồ sơ nhân sự", `${fullName} (${id})`);

    context.res.status = 200;
    context.res.body = { success: true, id, message: isNew ? "Đã tạo hồ sơ nhân sự." : "Đã lưu thay đổi." };
  } catch (err) {
    context.log.error("Lỗi lưu hồ sơ nhân sự:", err.message);
    context.res.status = 500;
    context.res.body = { success: false, message: "Đã có lỗi xảy ra, vui lòng thử lại sau." };
  }
};
