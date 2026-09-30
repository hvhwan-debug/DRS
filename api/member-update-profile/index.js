const { getTableClient } = require("../_shared/tableStorage");
const { buildGreeting, normalizeGender, getMemberGender } = require("../_shared/memberName");
const { sendTrackedEmail } = require("../_shared/sendTrackedEmail");
const { getApprovalStatus, notifyAdminNewMember } = require("../_shared/memberApproval");
const { logFamilyEvent } = require("../_shared/linkage");

const SESSION_TABLE = "AuthSessions";
const PROFILES_TABLE = "MemberProfiles";

function getMemberToken(req) {
  const header = req.headers && (req.headers["x-member-token"] || req.headers["X-Member-Token"]);
  return header ? header.trim() : null;
}

module.exports = async function (context, req) {
  context.res = { headers: { "Content-Type": "application/json" } };

  const token = getMemberToken(req);
  if (!token) {
    context.res.status = 401;
    context.res.body = { success: false, message: "Chưa đăng nhập." };
    return;
  }

  try {
    const sessionTable = await getTableClient(SESSION_TABLE);
    let session;
    let isSetup = false;
    try {
      session = await sessionTable.getEntity("session", token);
    } catch (err) {
      // Không phải phiên thường -> thử "vé hoàn tất hồ sơ" của tài khoản mới đăng ký, đang chờ duyệt
      if (err.statusCode === 404) {
        try { session = await sessionTable.getEntity("setup", token); isSetup = true; } catch (e) { if (e.statusCode !== 404) throw e; }
      }
      if (!session) {
        if (err.statusCode !== 404) throw err;
        context.res.status = 401;
        context.res.body = { success: false, message: "Phiên đăng nhập không hợp lệ." };
        return;
      }
    }
    if (new Date(session.expiresAt).getTime() < Date.now()) {
      context.res.status = 401;
      context.res.body = { success: false, message: "Phiên đăng nhập đã hết hạn." };
      return;
    }

    const email = session.email;
    const body = req.body || {};
    // Mã giới thiệu (?ref=...) từ trang đăng ký: chỉ ghi 1 lần, không tự giới thiệu chính mình
    const refCode = String(body.referralCode || "").trim().toLowerCase();
    if (/^[0-9a-f]{8}$/.test(refCode)) {
      try {
        const pt = await getTableClient(PROFILES_TABLE);
        let mine = null; try { mine = await pt.getEntity("profile", email); } catch (e) {}
        if (!mine || !mine.referredBy) {
          for await (const r of pt.listEntities({ queryOptions: { filter: `referralCode eq '${refCode}'`, select: ["rowKey"] } })) {
            if (String(r.rowKey).toLowerCase() !== String(email).toLowerCase()) await pt.upsertEntity({ partitionKey: "profile", rowKey: email, referredBy: String(r.rowKey).toLowerCase(), referredAt: new Date().toISOString() }, "Merge");
            break;
          }
        }
      } catch (e) { context.log.warn("Không ghi được người giới thiệu:", e.message); }
    }
    const fullName = String(body.fullName || "").trim();
    const phone = String(body.phone || "").trim();
    const address = String(body.address || "").trim();
    // Giới tính (để xưng hô anh/chị trong email) — chỉ cập nhật khi form có gửi trường này
    const hasGender = Object.prototype.hasOwnProperty.call(body, "gender");
    const gender = hasGender ? normalizeGender(body.gender) : await getMemberGender(email);
    let dob = String(body.dob || "").trim();
    if (dob) {
      const dobYear = Number(dob.slice(0, 4));
      const currentYear = new Date().getFullYear();
      if (isNaN(dobYear) || dobYear < 1920 || dobYear > currentYear) {
        dob = ""; // Bỏ qua giá trị năm sinh bất thường thay vì lưu lại
      }
    }

    const profilesTable = await getTableClient(PROFILES_TABLE);
    await profilesTable.upsertEntity({
      partitionKey: "profile",
      rowKey: email,
      fullName,
      phone,
      address,
      dob,
      ...(hasGender ? { gender } : {}),
      updatedAt: new Date().toISOString()
    }, "Merge");

    // Bước cuối của đăng ký mới (tài khoản chờ duyệt): báo đội ngũ duyệt + báo thành viên đang chờ,
    // huỷ vé hoàn tất hồ sơ. Không gửi email "thông tin tài khoản vừa thay đổi" trong trường hợp này.
    if (isSetup) {
      await sessionTable.deleteEntity("setup", token).catch(() => {});
      const membersTable = await getTableClient("Members");
      let member = null;
      try { member = await membersTable.getEntity("member", email); } catch (e) { /* bỏ qua */ }
      if (member && getApprovalStatus(member) === "pending" && !member.approvalNotifiedAt) {
        await membersTable.updateEntity({ partitionKey: "member", rowKey: email, approvalNotifiedAt: new Date().toISOString() }, "Merge").catch(() => {});
        await notifyAdminNewMember(context, { email, fullName, phone, address, dob });
        await logFamilyEvent(context, email, "Đăng ký tài khoản thành viên trên website, đang chờ duyệt.", { by: "Thành viên (website)" });
        await sendTrackedEmail(context, {
          to: email,
          subject: "Đã nhận đăng ký tài khoản của bạn",
          type: "registration",
          eyebrow: "Đăng Ký Thành Viên",
          title: "Tài khoản đang chờ phê duyệt",
          bodyHtml: `
            <p style="margin:0 0 16px;">${buildGreeting(fullName || null, gender)}</p>
            <p style="margin:0 0 12px;">Cảm ơn bạn đã đăng ký tài khoản tại Mạng Lưới Tri Thức Việt Nam. Đội ngũ sẽ xem xét và phê duyệt trong thời gian sớm nhất.</p>
            <p style="margin:0;">Chúng tôi sẽ gửi email cho bạn ngay khi tài khoản được kích hoạt để bạn đăng nhập.</p>`
        });
      }
      context.res.status = 200;
      context.res.body = { success: true, pending: true };
      return;
    }

    // Gửi email báo mọi thay đổi thông tin tài khoản (best-effort — không chặn phản hồi thành công nếu gửi lỗi)
    const greeting = buildGreeting(fullName || null, gender);
    await sendTrackedEmail(context, {
      to: email,
      subject: "Thông tin tài khoản của bạn vừa được cập nhật",
      type: "profile_update",
      eyebrow: "Bảo Mật Tài Khoản",
      title: "Thông tin tài khoản đã thay đổi",
      bodyHtml: `
        <p style="margin:0 0 16px;">${greeting}</p>
        <p style="margin:0 0 14px;">Thông tin tài khoản của bạn tại Mạng Lưới Tri Thức Việt Nam vừa được cập nhật:</p>
        <table style="width:100%; border-collapse:collapse; font-size:13px; margin-bottom:14px; font-family:Arial,Helvetica,sans-serif;">
          <tr><td style="padding:6px 0; color:#64748b; width:120px; font-family:Arial,Helvetica,sans-serif;">Họ và tên</td><td style="padding:6px 0; font-weight:700; font-family:Arial,Helvetica,sans-serif;">${fullName || "—"}</td></tr>
          <tr><td style="padding:6px 0; color:#64748b; font-family:Arial,Helvetica,sans-serif;">Số điện thoại</td><td style="padding:6px 0; font-weight:700; font-family:Arial,Helvetica,sans-serif;">${phone || "—"}</td></tr>
          <tr><td style="padding:6px 0; color:#64748b; font-family:Arial,Helvetica,sans-serif;">Ngày sinh</td><td style="padding:6px 0; font-weight:700; font-family:Arial,Helvetica,sans-serif;">${dob || "—"}</td></tr>
          <tr><td style="padding:6px 0; color:#64748b; font-family:Arial,Helvetica,sans-serif;">Xưng hô</td><td style="padding:6px 0; font-weight:700; font-family:Arial,Helvetica,sans-serif;">${gender === "male" ? "Anh (Nam)" : gender === "female" ? "Chị (Nữ)" : "—"}</td></tr>
          <tr><td style="padding:6px 0; color:#64748b; font-family:Arial,Helvetica,sans-serif;">Địa chỉ</td><td style="padding:6px 0; font-weight:700; font-family:Arial,Helvetica,sans-serif;">${address || "—"}</td></tr>
        </table>
        <p style="font-size:13px; color:#64748b; margin:0;">Nếu bạn không thực hiện thay đổi này, vui lòng liên hệ với chúng tôi ngay.</p>`
    });

    context.res.status = 200;
    context.res.body = { success: true };
  } catch (err) {
    context.log.error("Lỗi cập nhật thông tin thành viên:", err.message);
    context.res.status = 500;
    context.res.body = { success: false, message: "Đã có lỗi xảy ra, vui lòng thử lại sau." };
  }
};
