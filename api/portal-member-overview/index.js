const { getTableClient } = require("../_shared/tableStorage");
const { requireAdmin } = require("../_shared/adminAuth");
const { getAttachmentSasUrl } = require("../_shared/blobStorage");

const MEMBERS_TABLE = "Members";
const PROFILES_TABLE = "MemberProfiles";
const REGISTRATIONS_TABLE = "Registrations";
const DONATIONS_TABLE = "Donations";
const GRADES_TABLE = "Grades";
const TUITION_TABLE = "TuitionPayments";
const STUDENTS_TABLE = "Students";
const SCHEDULE_TABLE = "ClassSchedules";
const REDEMPTIONS_TABLE = "GiftRedemptions";
const INVOICES_TABLE = "Invoices";

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

    // Học phí đã đóng
    const tuitionPayments = [];
    try {
      const tuitionTable = await getTableClient(TUITION_TABLE);
      const iterator = tuitionTable.listEntities({
        queryOptions: { filter: `PartitionKey eq '${email.replace(/'/g, "''")}'` }
      });
      for await (const entity of iterator) {
        tuitionPayments.push({
          studentName: entity.studentName,
          program: entity.program,
          amount: Number(entity.amount) || 0,
          period: entity.period || "",
          confirmationStatus: entity.confirmationStatus,
          paidAt: entity.paidAt
        });
      }
      tuitionPayments.sort((a, b) => new Date(b.paidAt) - new Date(a.paidAt));
    } catch (e) {}

    // Học sinh đã được gán (kèm nhiều chương trình nếu có)
    const students = [];
    try {
      const studentsTable = await getTableClient(STUDENTS_TABLE);
      const iterator = studentsTable.listEntities({
        queryOptions: { filter: `PartitionKey eq '${email.replace(/'/g, "''")}'` }
      });
      for await (const entity of iterator) {
        let programs = [];
        try { programs = JSON.parse(entity.programsJson || "[]"); } catch (e) {}
        if (!Array.isArray(programs) || programs.length === 0) programs = entity.program ? [entity.program] : [];
        students.push({
          id: entity.rowKey,
          studentName: entity.studentName,
          dob: entity.dob || "",
          program: entity.program || "",
          programs,
          note: entity.note || ""
        });
      }
    } catch (e) {}

    // Lịch học — chỉ hiện đúng những chương trình mà thành viên/con em đang tham gia
    const memberPrograms = new Set();
    registrations.forEach(r => { if (r.data && r.data.chuong_trinh) memberPrograms.add(r.data.chuong_trinh); });
    grades.forEach(g => { if (g.program) memberPrograms.add(g.program); });
    tuitionPayments.forEach(p => { if (p.program) memberPrograms.add(p.program); });
    students.forEach(s => (s.programs.length ? s.programs : [s.program]).forEach(p => p && memberPrograms.add(p)));

    const schedules = [];
    try {
      const scheduleTable = await getTableClient(SCHEDULE_TABLE);
      for await (const entity of scheduleTable.listEntities()) {
        if (memberPrograms.has(entity.program)) {
          schedules.push({
            program: entity.program,
            days: entity.days,
            startTime: entity.startTime,
            endTime: entity.endTime,
            location: entity.location || "",
            teacherName: entity.teacherName || "",
            note: entity.note || ""
          });
        }
      }
    } catch (e) {}

    // Yêu cầu đổi quà
    const giftRedemptions = [];
    try {
      const redemptionsTable = await getTableClient(REDEMPTIONS_TABLE);
      const iterator = redemptionsTable.listEntities({
        queryOptions: { filter: `PartitionKey eq '${email.replace(/'/g, "''")}'` }
      });
      for await (const entity of iterator) {
        giftRedemptions.push({
          id: entity.rowKey,
          giftId: entity.giftId,
          giftName: entity.giftName,
          status: entity.status || "pending",
          requestedAt: entity.requestedAt,
          shippedAt: entity.shippedAt || null,
          fulfilledAt: entity.fulfilledAt || null,
          cancelledAt: entity.cancelledAt || null,
          cancelReason: entity.cancelReason || ""
        });
      }
      giftRedemptions.sort((a, b) => new Date(b.requestedAt) - new Date(a.requestedAt));
    } catch (e) {}

    // Hoá đơn
    const invoices = [];
    try {
      const invoicesTable = await getTableClient(INVOICES_TABLE);
      const iterator = invoicesTable.listEntities({
        queryOptions: { filter: `PartitionKey eq '${email.replace(/'/g, "''")}'` }
      });
      for await (const entity of iterator) {
        let items = [];
        try { items = JSON.parse(entity.itemsJson || "[]"); } catch (e) {}
        invoices.push({
          id: entity.rowKey,
          invoiceNumber: entity.invoiceNumber,
          studentName: entity.studentName || "",
          program: entity.program || "",
          items,
          totalAmount: Number(entity.totalAmount) || 0,
          issueDate: entity.issueDate,
          note: entity.note || ""
        });
      }
      invoices.sort((a, b) => new Date(b.issueDate) - new Date(a.issueDate));
    } catch (e) {}

    context.res.status = 200;
    context.res.body = {
      success: true, email, hasAccount, isBlocked, profile, registrations, donations, grades,
      tuitionPayments, students, schedules, giftRedemptions, invoices
    };
  } catch (err) {
    context.log.error("Lỗi lấy tổng quan thành viên:", err.message);
    context.res.status = 500;
    context.res.body = { success: false, message: "Đã có lỗi xảy ra, vui lòng thử lại sau." };
  }
};
