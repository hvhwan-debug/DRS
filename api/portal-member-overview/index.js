const { getTableClient } = require("../_shared/tableStorage");
const { requireAdmin } = require("../_shared/adminAuth");
const { getAttachmentSasUrl } = require("../_shared/blobStorage");

const MEMBERS_TABLE = "Members";
const PROFILES_TABLE = "MemberProfiles";
const REGISTRATIONS_TABLE = "Registrations";
const DONATIONS_TABLE = "Donations";
const GRADES_TABLE = "Grades";

const FORM_TITLES = {
  contact: "Liên hệ",
  volunteer: "Đăng ký tình nguyện viên",
  item: "Đăng ký gây quỹ hiện vật",
  donor: "Đăng ký trở thành nhà tài trợ",
  support: "Yêu cầu kết nối hỗ trợ",
  newsletter: "Đăng ký nhận bản tin",
  luyen_chu_phu_huynh: "Đăng ký Luyện Chữ Đẹp — Phụ huynh",
  luyen_chu_tinh_nguyen: "Đăng ký Luyện Chữ Đẹp — Tình nguyện viên",
  luyen_chu_tai_tro: "Đăng ký Luyện Chữ Đẹp — Nhà tài trợ",
  tien_tieu_hoc: "Đăng ký Chương Trình Tiền Tiểu Học"
};

async function resolveAttachments(rawJson) {
  try {
    const rawAttachments = JSON.parse(rawJson || "[]");
    return await Promise.all(
      rawAttachments.map(async (att) => ({
        filename: att.filename,
        url: await getAttachmentSasUrl(att.blobName)
      }))
    );
  } catch (e) {
    return [];
  }
}

module.exports = async function (context, req) {
  context.res = { headers: { "Content-Type": "application/json" } };

  if (!(await requireAdmin(context, req))) return;

  const email = String((req.query && req.query.email) || "").trim().toLowerCase();
  if (!email) {
    context.res.status = 400;
    context.res.body = { success: false, message: "Thiếu email." };
    return;
  }

  try {
    // Có tài khoản đăng nhập hay không
    let hasAccount = false;
    let isBlocked = false;
    try {
      const membersTable = await getTableClient(MEMBERS_TABLE);
      const memberEntity = await membersTable.getEntity("member", email);
      hasAccount = true;
      isBlocked = !!memberEntity.isBlocked;
    } catch (e) { /* không có tài khoản -> mặc định false */ }

    // Hồ sơ tự điền
    let profile = { fullName: "", phone: "", address: "", dob: "" };
    try {
      const profilesTable = await getTableClient(PROFILES_TABLE);
      const p = await profilesTable.getEntity("profile", email);
      profile = { fullName: p.fullName || "", phone: p.phone || "", address: p.address || "", dob: p.dob || "" };
    } catch (e) { /* chưa có hồ sơ */ }

    // Đơn đăng ký
    const registrations = [];
    try {
      const regTable = await getTableClient(REGISTRATIONS_TABLE);
      const iterator = regTable.listEntities({
        queryOptions: { filter: `PartitionKey eq '${email.replace(/'/g, "''")}'` }
      });
      for await (const entity of iterator) {
        let data = {};
        try { data = JSON.parse(entity.dataJson || "{}"); } catch (e) {}
        registrations.push({
          formType: entity.formType,
          formTitle: FORM_TITLES[entity.formType] || entity.formType,
          status: entity.status || "Đã ghi nhận",
          submittedAt: entity.submittedAt,
          data,
          attachments: await resolveAttachments(entity.attachmentsJson)
        });
      }
      registrations.sort((a, b) => new Date(b.submittedAt) - new Date(a.submittedAt));
    } catch (e) {}

    // Quyên góp
    const donations = [];
    try {
      const donationsTable = await getTableClient(DONATIONS_TABLE);
      const iterator = donationsTable.listEntities({
        queryOptions: { filter: `PartitionKey eq 'donation' and donorEmail eq '${email.replace(/'/g, "''")}'` }
      });
      for await (const entity of iterator) {
        donations.push({
          donorName: entity.donorName,
          amount: entity.amount,
          method: entity.method || "",
          transactionCode: entity.transactionCode || "",
          note: entity.note || "",
          attachments: await resolveAttachments(entity.attachmentsJson),
          donatedAt: entity.donatedAt
        });
      }
      donations.sort((a, b) => new Date(b.donatedAt) - new Date(a.donatedAt));
    } catch (e) {}

    // Bảng điểm con em
    const grades = [];
    try {
      const gradesTable = await getTableClient(GRADES_TABLE);
      const iterator = gradesTable.listEntities({
        queryOptions: { filter: `PartitionKey eq '${email.replace(/'/g, "''")}'` }
      });
      for await (const entity of iterator) {
        grades.push({
          studentName: entity.studentName,
          program: entity.program,
          assessmentType: entity.assessmentType || "Buổi học",
          term: entity.term,
          score: entity.score !== undefined && entity.score !== null ? entity.score : null,
          comment: entity.comment || "",
          attachments: await resolveAttachments(entity.attachmentsJson),
          recordedAt: entity.recordedAt
        });
      }
      grades.sort((a, b) => new Date(b.recordedAt) - new Date(a.recordedAt));
    } catch (e) {}

    context.res.status = 200;
    context.res.body = { success: true, email, hasAccount, isBlocked, profile, registrations, donations, grades };
  } catch (err) {
    context.log.error("Lỗi lấy tổng quan thành viên:", err.message);
    context.res.status = 500;
    context.res.body = { success: false, message: "Đã có lỗi xảy ra, vui lòng thử lại sau." };
  }
};
