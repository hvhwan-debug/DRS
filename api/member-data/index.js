const { getTableClient } = require("../_shared/tableStorage");
const { getAttachmentSasUrl } = require("../_shared/blobStorage");
const { getTierByTotal, isVipTotal, calculatePoints, describeEarnRate } = require("../_shared/memberTier");
const { listActiveGiftCatalog } = require("../_shared/giftCatalog");

const SESSION_TABLE = "AuthSessions";
const REGISTRATIONS_TABLE = "Registrations";
const DONATIONS_TABLE = "Donations";
const PROFILES_TABLE = "MemberProfiles";
const GRADES_TABLE = "Grades";
const TUITION_TABLE = "TuitionPayments";
const SCHEDULE_TABLE = "ClassSchedules";
const STUDENTS_TABLE = "Students";
const REDEMPTIONS_TABLE = "GiftRedemptions";

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

function getBearerToken(req) {
  // Không dùng header "Authorization" vì Azure Static Web Apps có thể can thiệp/loại bỏ
  // header này trước khi chuyển tới Azure Function (dành riêng cho hệ xác thực EasyAuth của Azure).
  // Dùng header tùy chỉnh "x-member-token" để tránh xung đột.
  const header = req.headers && (req.headers["x-member-token"] || req.headers["X-Member-Token"]);
  return header ? header.trim() : null;
}

module.exports = async function (context, req) {
  context.res = { headers: { "Content-Type": "application/json" } };

  const token = getBearerToken(req);
  if (!token) {
    context.res.status = 401;
    context.res.body = { success: false, message: "Chưa đăng nhập." };
    return;
  }

  try {
    const sessionTable = await getTableClient(SESSION_TABLE);
    let session;
    try {
      session = await sessionTable.getEntity("session", token);
    } catch (err) {
      if (err.statusCode === 404) {
        context.res.status = 401;
        context.res.body = { success: false, message: "Phiên đăng nhập không hợp lệ." };
        return;
      }
      throw err;
    }

    if (new Date(session.expiresAt).getTime() < Date.now()) {
      context.res.status = 401;
      context.res.body = { success: false, message: "Phiên đăng nhập đã hết hạn." };
      return;
    }

    const email = session.email;
    const regTable = await getTableClient(REGISTRATIONS_TABLE);

    const registrations = [];
    const iterator = regTable.listEntities({
      queryOptions: { filter: `PartitionKey eq '${email.replace(/'/g, "''")}'` }
    });
    for await (const entity of iterator) {
      let data = {};
      try { data = JSON.parse(entity.dataJson || "{}"); } catch (e) { /* bỏ qua nếu lỗi parse */ }

      let attachments = [];
      try {
        const rawAttachments = JSON.parse(entity.attachmentsJson || "[]");
        attachments = await Promise.all(
          rawAttachments.map(async (att) => ({
            filename: att.filename,
            url: await getAttachmentSasUrl(att.blobName)
          }))
        );
      } catch (e) {
        // Không có tài liệu đính kèm hoặc lỗi tạo link — bỏ qua, không chặn phần còn lại
      }

      registrations.push({
        id: entity.rowKey,
        formType: entity.formType,
        formTitle: FORM_TITLES[entity.formType] || entity.formType,
        status: entity.status || "Đã ghi nhận",
        rejectionReason: entity.rejectionReason || "",
        submittedAt: entity.submittedAt,
        data,
        attachments
      });
    }

    registrations.sort((a, b) => new Date(b.submittedAt) - new Date(a.submittedAt));

    // Lịch sử quyên góp do đội ngũ nhập thủ công, khớp theo email
    const donations = [];
    try {
      const donationsTable = await getTableClient(DONATIONS_TABLE);
      const donationIterator = donationsTable.listEntities({
        queryOptions: { filter: `PartitionKey eq 'donation' and donorEmail eq '${email.replace(/'/g, "''")}'` }
      });
      for await (const entity of donationIterator) {
        let attachments = [];
        try {
          const rawAttachments = JSON.parse(entity.attachmentsJson || "[]");
          attachments = await Promise.all(
            rawAttachments.map(async (att) => ({
              filename: att.filename,
              url: await getAttachmentSasUrl(att.blobName)
            }))
          );
        } catch (e) {
          // Không có ảnh đính kèm — bỏ qua
        }
        donations.push({
          id: entity.rowKey,
          donationType: entity.donationType || "cash",
          amount: entity.amount !== undefined && entity.amount !== null ? entity.amount : null,
          itemDescription: entity.itemDescription || "",
          method: entity.method || "",
          transactionCode: entity.transactionCode || "",
          note: entity.note || "",
          attachments,
          confirmationStatus: entity.confirmationStatus || "pending",
          memberFeedback: entity.memberFeedback || "",
          donatedAt: entity.donatedAt
        });
      }
      donations.sort((a, b) => new Date(b.donatedAt) - new Date(a.donatedAt));
    } catch (e) {
      // Bảng Donations có thể chưa có dữ liệu — bỏ qua, không chặn phần còn lại
    }

    // Bảng điểm / nhận xét của học sinh, khớp theo email phụ huynh
    const grades = [];
    try {
      const gradesTable = await getTableClient(GRADES_TABLE);
      const gradeIterator = gradesTable.listEntities({
        queryOptions: { filter: `PartitionKey eq '${email.replace(/'/g, "''")}'` }
      });
      for await (const entity of gradeIterator) {
        let attachments = [];
        try {
          const rawAttachments = JSON.parse(entity.attachmentsJson || "[]");
          attachments = await Promise.all(
            rawAttachments.map(async (att) => ({
              filename: att.filename,
              url: await getAttachmentSasUrl(att.blobName)
            }))
          );
        } catch (e) {
          // Không có ảnh đính kèm — bỏ qua
        }
        grades.push({
          id: entity.rowKey,
          studentName: entity.studentName,
          program: entity.program,
          assessmentType: entity.assessmentType || "Buổi học",
          term: entity.term,
          score: entity.score !== undefined && entity.score !== null ? entity.score : null,
          comment: entity.comment || "",
          attachments,
          confirmationStatus: entity.confirmationStatus || "pending",
          memberFeedback: entity.memberFeedback || "",
          recordedAt: entity.recordedAt
        });
      }
      grades.sort((a, b) => new Date(b.recordedAt) - new Date(a.recordedAt));
    } catch (e) {
      // Bảng Grades có thể chưa có dữ liệu — bỏ qua, không chặn phần còn lại
    }

    // Thông tin hồ sơ do chính thành viên tự điền
    let profile = { fullName: "", phone: "", address: "", dob: "" };
    let lastSeenTier = null;
    try {
      const profilesTable = await getTableClient(PROFILES_TABLE);
      const p = await profilesTable.getEntity("profile", email);
      profile = { fullName: p.fullName || "", phone: p.phone || "", address: p.address || "", dob: p.dob || "" };
      lastSeenTier = p.lastSeenTier || null;
    } catch (e) {
      // Chưa có hồ sơ nào được lưu — dùng giá trị rỗng mặc định ở trên
    }

    // Học phí đã nộp, khớp theo email phụ huynh
    const tuitionPayments = [];
    try {
      const tuitionTable = await getTableClient(TUITION_TABLE);
      const tuitionIterator = tuitionTable.listEntities({
        queryOptions: { filter: `PartitionKey eq '${email.replace(/'/g, "''")}'` }
      });
      for await (const entity of tuitionIterator) {
        let attachments = [];
        try {
          const rawAttachments = JSON.parse(entity.attachmentsJson || "[]");
          attachments = await Promise.all(
            rawAttachments.map(async (att) => ({
              filename: att.filename,
              url: await getAttachmentSasUrl(att.blobName)
            }))
          );
        } catch (e) {}
        tuitionPayments.push({
          id: entity.rowKey,
          studentName: entity.studentName,
          program: entity.program,
          amount: entity.amount,
          expectedAmount: entity.expectedAmount != null ? entity.expectedAmount : entity.amount,
          period: entity.period || "",
          method: entity.method || "",
          note: entity.note || "",
          attachments,
          confirmationStatus: entity.confirmationStatus || "pending",
          memberFeedback: entity.memberFeedback || "",
          paidAt: entity.paidAt
        });
      }
      tuitionPayments.sort((a, b) => new Date(b.paidAt) - new Date(a.paidAt));
    } catch (e) {}

    // Học sinh đã được admin gán khóa học — dùng để xác định lịch học phù hợp
    let students = [];
    try {
      const studentsTable = await getTableClient(STUDENTS_TABLE);
      const studentsIterator = studentsTable.listEntities({
        queryOptions: { filter: `PartitionKey eq '${email.replace(/'/g, "''")}'` }
      });
      for await (const entity of studentsIterator) {
        students.push({
          id: entity.rowKey,
          studentName: entity.studentName,
          dob: entity.dob || "",
          program: entity.program || "",
          note: entity.note || ""
        });
      }
    } catch (e) {}

    // Lịch học — chỉ hiện đúng những chương trình mà thành viên đang tham gia
    const memberPrograms = new Set();
    registrations.forEach(r => { if (r.data && r.data.chuong_trinh) memberPrograms.add(r.data.chuong_trinh); });
    grades.forEach(g => { if (g.program) memberPrograms.add(g.program); });
    tuitionPayments.forEach(p => { if (p.program) memberPrograms.add(p.program); });
    students.forEach(s => { if (s.program) memberPrograms.add(s.program); });

    let schedules = [];
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

    // Yêu cầu đổi quà của thành viên
    let giftRedemptions = [];
    try {
      const redemptionsTable = await getTableClient(REDEMPTIONS_TABLE);
      const redemptionsIterator = redemptionsTable.listEntities({
        queryOptions: { filter: `PartitionKey eq '${email.replace(/'/g, "''")}'` }
      });
      for await (const entity of redemptionsIterator) {
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
    } catch (e) {}

    // Danh mục quà tặng hiện đang bật (admin quản lý) — kèm ảnh minh hoạ nếu có
    let giftCatalog = [];
    try {
      giftCatalog = await listActiveGiftCatalog();
    } catch (e) {
      context.log.error("Lỗi lấy danh mục quà tặng:", e.message);
    }

    // Hạng thành viên + điểm tích lũy (tính server-side để đảm bảo đúng và không phụ thuộc client)
    const totalTuitionPaid = tuitionPayments.reduce((sum, p) => sum + (Number(p.amount) || 0), 0);
    const tier = getTierByTotal(totalTuitionPaid);
    const loyaltyPoints = {
      total: calculatePoints(totalTuitionPaid, tier),
      rateLabel: describeEarnRate(tier),
      tierName: tier.name
    };
    // Popup thông báo đổi hạng: chỉ báo khi ĐÃ từng ghi nhận 1 hạng trước đó và hạng đó khác hạng hiện tại
    // (bỏ qua lần đăng nhập đầu tiên, vì lúc đó chưa có "hạng cũ" để so sánh).
    const tierChanged = !!(lastSeenTier && lastSeenTier !== tier.name);
    if (!lastSeenTier) {
      // Lần đầu tiên có dữ liệu hạng cho thành viên này -> âm thầm lưu mốc khởi điểm, không hiện popup.
      try {
        const profilesTable2 = await getTableClient(PROFILES_TABLE);
        await profilesTable2.upsertEntity({ partitionKey: "profile", rowKey: email, lastSeenTier: tier.name }, "Merge");
      } catch (e) { /* best-effort, không chặn phản hồi chính */ }
    }

    context.res.status = 200;
    context.res.body = {
      success: true, email, profile, registrations, donations, grades, tuitionPayments, schedules, students, giftRedemptions, giftCatalog,
      totalTuitionPaid,
      tier: { name: tier.name, icon: tier.icon, color: tier.color },
      isVip: isVipTotal(totalTuitionPaid),
      loyaltyPoints,
      tierChanged,
      previousTierName: tierChanged ? lastSeenTier : null
    };
  } catch (err) {
    context.log.error("Lỗi lấy dữ liệu thành viên:", err.message);
    context.res.status = 500;
    context.res.body = { success: false, message: "Đã có lỗi xảy ra, vui lòng thử lại sau." };
  }
};
