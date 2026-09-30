// Phê duyệt tài khoản thành viên tự đăng ký — logic DÙNG CHUNG cho trang quản trị
// (portal-review-member) và nút Duyệt/Từ chối ngay trong email báo admin (public-member-approval).
//
// approvalStatus trên bảng Members: "pending" (chờ duyệt) | "approved" | "rejected".
// Tài khoản tạo trước khi có tính năng này không có trường approvalStatus -> coi như đã duyệt,
// để thành viên cũ vẫn đăng nhập bình thường.
const crypto = require("crypto");
const { getTableClient } = require("./tableStorage");
const { sendTrackedEmail } = require("./sendTrackedEmail");
const { getMemberDisplayName, getMemberGender, buildGreeting } = require("./memberName");
const { logFamilyEvent } = require("./linkage");

const PENDING_MESSAGE = "Tài khoản của bạn đang chờ đội ngũ phê duyệt. Chúng tôi sẽ gửi email ngay khi tài khoản được kích hoạt.";
const REJECTED_MESSAGE = "Tài khoản của bạn chưa được phê duyệt. Vui lòng liên hệ hotro@wvn.vn để được hỗ trợ.";

const MEMBERS_TABLE = "Members";
const SESSION_TABLE = "AuthSessions";
const APPROVAL_TOKENS_TABLE = "MemberApprovalTokens";
const APPROVAL_TOKEN_TTL_DAYS = 14;
const SITE = "https://wvn.vn";

const esc = v => String(v == null ? "" : v).replace(/[&<>"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));

function getApprovalStatus(member) {
  const s = String((member && member.approvalStatus) || "").toLowerCase();
  return s === "pending" || s === "rejected" ? s : "approved";
}

// ---------- Link duyệt nhanh qua email ----------
async function createApprovalToken(email) {
  const token = crypto.randomBytes(32).toString("hex");
  const t = await getTableClient(APPROVAL_TOKENS_TABLE);
  await t.createEntity({
    partitionKey: "approval",
    rowKey: token,
    email: String(email).toLowerCase(),
    expiresAt: new Date(Date.now() + APPROVAL_TOKEN_TTL_DAYS * 24 * 60 * 60 * 1000).toISOString(),
    createdAt: new Date().toISOString()
  });
  return token;
}

// Trả { email } nếu token còn hợp lệ, null nếu không có / hết hạn
async function readApprovalToken(token) {
  if (!/^[0-9a-f]{64}$/.test(String(token || ""))) return null;
  const t = await getTableClient(APPROVAL_TOKENS_TABLE);
  try {
    const e = await t.getEntity("approval", token);
    if (new Date(e.expiresAt).getTime() < Date.now()) return null;
    return { email: e.email, usedAt: e.usedAt || null, usedAction: e.usedAction || "" };
  } catch (err) {
    if (err.statusCode === 404) return null;
    throw err;
  }
}

async function markApprovalTokenUsed(token, action) {
  const t = await getTableClient(APPROVAL_TOKENS_TABLE);
  await t.updateEntity({ partitionKey: "approval", rowKey: token, usedAt: new Date().toISOString(), usedAction: action }, "Merge").catch(() => {});
}

// ---------- Email báo admin có tài khoản mới, kèm nút Duyệt / Từ chối ----------
async function notifyAdminNewMember(context, { email, fullName, phone, address, dob }) {
  let reviewUrl = `${SITE}/admin#members`;
  let ctas = [{ label: "Mở Trang Quản Trị", href: reviewUrl, style: "primary" }];
  try {
    const token = await createApprovalToken(email);
    const base = `${SITE}/duyet-thanh-vien.html?token=${token}`;
    ctas = [
      { label: "✓ Duyệt tài khoản", href: `${base}&action=approve`, style: "primary" },
      { label: "✕ Từ chối", href: `${base}&action=reject`, style: "danger" }
    ];
  } catch (e) {
    if (context && context.log) context.log.error("Không tạo được link duyệt nhanh:", e.message);
  }
  const row = (k, v) => `<tr><td style="padding:6px 0;color:#64748b;width:120px;font-family:Arial,Helvetica,sans-serif;">${k}</td><td style="padding:6px 0;font-weight:700;font-family:Arial,Helvetica,sans-serif;">${esc(v || "—")}</td></tr>`;
  return sendTrackedEmail(context, {
    to: process.env.NOTIFY_TO_EMAIL || "hotro@wvn.vn",
    subject: `Tài khoản mới chờ duyệt: ${fullName || email}`,
    type: "other",
    eyebrow: "Cần Phê Duyệt",
    title: "Có tài khoản thành viên mới đăng ký",
    bodyHtml: `
      <p style="margin:0 0 14px;">Một tài khoản thành viên mới vừa đăng ký và đang chờ phê duyệt. Người này <strong>chưa đăng nhập được</strong> cho tới khi được duyệt.</p>
      <table style="width:100%;border-collapse:collapse;font-size:13px;margin-bottom:14px;font-family:Arial,Helvetica,sans-serif;">
        ${row("Họ và tên", fullName)}${row("Email", email)}${row("Số điện thoại", phone)}${row("Ngày sinh", dob)}${row("Địa chỉ", address)}
      </table>
      <p style="font-size:13px;color:#64748b;margin:0;">Bấm nút bên dưới để duyệt hoặc từ chối ngay (bạn sẽ được hỏi xác nhận thêm 1 lần). Link có hiệu lực ${APPROVAL_TOKEN_TTL_DAYS} ngày. Bạn cũng có thể xử lý trong Trang Quản Trị → Thành Viên.</p>`,
    ctas
  });
}

// ---------- Duyệt / từ chối (dùng chung) ----------
// by: { displayName, email } — người thao tác (admin đăng nhập, hoặc "qua email")
// Trả { ok, status?, notFound?, alreadyStatus?, emailSent }
async function reviewMemberAccount(context, { email, approve, reason, by }) {
  email = String(email || "").trim().toLowerCase();
  reason = String(reason || "").trim().slice(0, 500);
  const membersTable = await getTableClient(MEMBERS_TABLE);
  let member;
  try { member = await membersTable.getEntity("member", email); }
  catch (err) { if (err.statusCode === 404) return { ok: false, notFound: true }; throw err; }

  const newStatus = approve ? "approved" : "rejected";
  const now = new Date().toISOString();
  await membersTable.updateEntity({
    partitionKey: "member",
    rowKey: email,
    approvalStatus: newStatus,
    approvalReviewedAt: now,
    approvalReviewedBy: (by && by.displayName) || "",
    approvalReason: approve ? "" : reason,
    updatedAt: now
  }, "Merge");

  // Từ chối -> huỷ mọi phiên / vé hoàn tất hồ sơ còn sót (best-effort)
  if (!approve) {
    try {
      const sessionTable = await getTableClient(SESSION_TABLE);
      const safeEmail = email.replace(/'/g, "''");
      for await (const s of sessionTable.listEntities({ queryOptions: { filter: `email eq '${safeEmail}'` } })) {
        await sessionTable.deleteEntity(s.partitionKey, s.rowKey).catch(() => {});
      }
    } catch (err) {
      if (context && context.log) context.log.error("Huỷ phiên khi từ chối tài khoản thất bại:", err.message);
    }
  }

  // Ghi vào lịch sử chăm sóc CRM của gia đình (nếu email này đã có học sinh / đơn đăng ký)
  const who = (by && by.displayName) || "Đội ngũ";
  await logFamilyEvent(context, email,
    approve ? `Tài khoản thành viên đã được duyệt (${who}).` : `Tài khoản thành viên bị từ chối (${who})${reason ? ": " + reason : ""}.`,
    { by: who });

  const greeting = buildGreeting(await getMemberDisplayName(email), await getMemberGender(email));
  const emailResult = await sendTrackedEmail(context, {
    to: email,
    subject: approve ? "Tài khoản của bạn đã được kích hoạt" : "Về đăng ký tài khoản của bạn",
    type: "registration",
    eyebrow: "Đăng Ký Thành Viên",
    title: approve ? "Tài khoản đã được phê duyệt" : "Tài khoản chưa được phê duyệt",
    bodyHtml: approve
      ? `<p style="margin:0 0 16px;">${greeting}</p>
         <p style="margin:0 0 12px;">Tài khoản thành viên của bạn tại Tri thức Việt đã được phê duyệt.</p>
         <p style="margin:0;">Bạn có thể đăng nhập ngay bằng email và mật khẩu đã đặt khi đăng ký.</p>`
      : `<p style="margin:0 0 16px;">${greeting}</p>
         <p style="margin:0 0 12px;">Cảm ơn bạn đã quan tâm tới Tri thức Việt. Rất tiếc, đăng ký tài khoản của bạn hiện chưa được phê duyệt.</p>
         ${reason ? `<p style="margin:0 0 12px;"><strong>Lý do:</strong> ${esc(reason)}</p>` : ""}
         <p style="margin:0;">Nếu cần hỗ trợ, vui lòng trả lời email này hoặc liên hệ hotro@wvn.vn.</p>`,
    ctas: approve ? [{ label: "Đăng Nhập Ngay", href: `${SITE}/dang-nhap.html`, style: "primary" }] : []
  });

  return { ok: true, status: newStatus, previousStatus: getApprovalStatus(member), emailSent: !!emailResult.success };
}

module.exports = {
  getApprovalStatus, PENDING_MESSAGE, REJECTED_MESSAGE,
  createApprovalToken, readApprovalToken, markApprovalTokenUsed,
  notifyAdminNewMember, reviewMemberAccount
};
