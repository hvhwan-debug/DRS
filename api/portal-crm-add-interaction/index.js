const { getTableClient } = require("../_shared/tableStorage");
const { requireAdmin, getAdminIdentity } = require("../_shared/adminAuth");
const { logAdminActivity } = require("../_shared/activityLog");
const {
  INTERACTIONS_TABLE, CRM_TABLE, CRM_PARTITION, INTERACTION_TYPES,
  clean, cleanDate, isValidStudentId
} = require("../_shared/crm");

module.exports = async function (context, req) {
  context.res = { headers: { "Content-Type": "application/json" } };

  if (!(await requireAdmin(context, req, "students"))) return;

  const body = req.body || {};
  const studentId = clean(body.studentId, 80);
  const content = clean(body.content, 2000);
  if (!isValidStudentId(studentId) || !content) {
    context.res.status = 400;
    context.res.body = { success: false, message: "Vui lòng nhập nội dung chăm sóc." };
    return;
  }

  const type = INTERACTION_TYPES.includes(body.type) ? body.type : "khac";
  const happenedDate = cleanDate(body.happenedAt);
  const happenedAt = happenedDate ? new Date(happenedDate + "T12:00:00+07:00").toISOString() : new Date().toISOString();
  const nextFollowUp = cleanDate(body.nextFollowUp);

  try {
    const identity = await getAdminIdentity(req);
    const now = new Date();
    const item = {
      partitionKey: studentId,
      rowKey: `${now.getTime()}-${Math.random().toString(36).slice(2, 8)}`,
      type,
      content,
      outcome: clean(body.outcome, 300),
      happenedAt,
      createdBy: identity ? identity.displayName : "",
      createdAt: now.toISOString()
    };
    const table = await getTableClient(INTERACTIONS_TABLE);
    await table.createEntity(item);

    // Nếu người dùng hẹn lịch liên hệ tiếp theo ngay khi ghi chăm sóc, cập nhật luôn vào hồ sơ.
    // "Merge" để không xoá các trường khác; nếu học sinh chưa có hồ sơ CRM thì tạo mới tối thiểu.
    if (body.nextFollowUp !== undefined) {
      const crm = await getTableClient(CRM_TABLE);
      await crm.upsertEntity({
        partitionKey: CRM_PARTITION,
        rowKey: studentId,
        nextFollowUp,
        followUpNote: clean(body.followUpNote, 300),
        updatedAt: now.toISOString(),
        updatedBy: item.createdBy
      }, "Merge");
    }

    await logAdminActivity(req, "CRM: ghi nhận chăm sóc", `id: ${studentId}, loại: ${type}`);

    context.res.status = 200;
    context.res.body = {
      success: true,
      interaction: {
        id: item.rowKey, type, content, outcome: item.outcome,
        happenedAt, createdBy: item.createdBy, createdAt: item.createdAt
      }
    };
  } catch (err) {
    context.log.error("Lỗi ghi nhận chăm sóc:", err.message);
    context.res.status = 500;
    context.res.body = { success: false, message: "Đã có lỗi xảy ra, vui lòng thử lại sau." };
  }
};
