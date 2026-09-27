const { getTableClient } = require("../_shared/tableStorage");
const { requireAdmin, getAdminIdentity } = require("../_shared/adminAuth");
const { logAdminActivity } = require("../_shared/activityLog");
const {
  CRM_TABLE, CRM_PARTITION, STAGES, PRIORITIES,
  clean, cleanDate, cleanTags, isValidStudentId
} = require("../_shared/crm");

module.exports = async function (context, req) {
  context.res = { headers: { "Content-Type": "application/json" } };

  if (!(await requireAdmin(context, req, "students"))) return;

  const body = req.body || {};
  const studentId = clean(body.studentId, 80);
  if (!isValidStudentId(studentId)) {
    context.res.status = 400;
    context.res.body = { success: false, message: "Thiếu hoặc sai mã học sinh." };
    return;
  }

  const stage = STAGES.includes(body.stage) ? body.stage : null;
  if (!stage) {
    context.res.status = 400;
    context.res.body = { success: false, message: "Giai đoạn chăm sóc không hợp lệ." };
    return;
  }

  const phone = clean(body.guardianPhone, 20);
  if (phone && !/^[0-9+\s().-]{8,20}$/.test(phone)) {
    context.res.status = 400;
    context.res.body = { success: false, message: "Số điện thoại người giám hộ không hợp lệ." };
    return;
  }

  try {
    const identity = await getAdminIdentity(req);
    const table = await getTableClient(CRM_TABLE);
    const entity = {
      partitionKey: CRM_PARTITION,
      rowKey: studentId,
      stage,
      priority: PRIORITIES.includes(body.priority) ? body.priority : "thuong",
      gradeLevel: clean(body.gradeLevel, 30),
      school: clean(body.school, 120),
      address: clean(body.address, 200),
      guardianName: clean(body.guardianName, 80),
      guardianPhone: phone,
      guardianRelation: clean(body.guardianRelation, 30),
      source: clean(body.source, 60),
      tagsJson: JSON.stringify(cleanTags(body.tags)),
      nextFollowUp: cleanDate(body.nextFollowUp),
      followUpNote: clean(body.followUpNote, 300),
      caretaker: clean(body.caretaker, 80),
      updatedAt: new Date().toISOString(),
      updatedBy: identity ? identity.displayName : ""
    };
    await table.upsertEntity(entity, "Replace");
    await logAdminActivity(req, "CRM: cập nhật hồ sơ học sinh", `id: ${studentId}, giai đoạn: ${stage}`);

    context.res.status = 200;
    context.res.body = { success: true, updatedAt: entity.updatedAt, updatedBy: entity.updatedBy };
  } catch (err) {
    context.log.error("Lỗi lưu hồ sơ CRM:", err.message);
    context.res.status = 500;
    context.res.body = { success: false, message: "Đã có lỗi xảy ra, vui lòng thử lại sau." };
  }
};
