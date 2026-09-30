const { getTableClient } = require("../_shared/tableStorage");
const { requireAdmin } = require("../_shared/adminAuth");
const { logAdminActivity } = require("../_shared/activityLog");
const { getMemberDisplayName, getMemberGender, buildGreeting } = require("../_shared/memberName");
const { sendTrackedEmail } = require("../_shared/sendTrackedEmail");

const MEMBERS_TABLE = "Members";
const SESSION_TABLE = "AuthSessions";

// Duyệt / từ chối tài khoản thành viên tự đăng ký.
// Body: { email, action: "approve" | "reject", reason? }
module.exports = async function (context, req) {
  context.res = { headers: { "Content-Type": "application/json" } };

  if (!(await requireAdmin(context, req, "members"))) return;

  const body = req.body || {};
  const email = String(body.email || "").trim().toLowerCase();
  const action = String(body.action || "");
  const reason = String(body.reason || "").trim().slice(0, 500);

  if (!email || !["approve", "reject"].includes(action)) {
    context.res.status = 400;
    context.res.body = { success: false, message: "Thiếu email hoặc thao tác không hợp lệ." };
    return;
  }

  try {
    const membersTable = await getTableClient(MEMBERS_TABLE);
    try {
      await membersTable.getEntity("member", email);
    } catch (err) {
      if (err.statusCode === 404) {
        context.res.status = 404;
        context.res.body = { success: false, message: "Không tìm thấy tài khoản này." };
        return;
      }
      throw err;
    }

    const approve = action === "approve";
    const now = new Date().toISOString();
    await membersTable.updateEntity({
      partitionKey: "member",
      rowKey: email,
      approvalStatus: approve ? "approved" : "rejected",
      approvalReviewedAt: now,
      approvalReason: approve ? "" : reason,
      updatedAt: now
    }, "Merge");
    await logAdminActivity(req, approve ? "Duyệt tài khoản thành viên" : "Từ chối tài khoản thành viên", email + (reason && !approve ? ` - ${reason}` : ""));

    // Từ chối -> huỷ mọi phiên / vé hoàn tất hồ sơ còn sót (best-effort)
    if (!approve) {
      try {
        const sessionTable = await getTableClient(SESSION_TABLE);
        const safeEmail = email.replace(/'/g, "''");
        for await (const s of sessionTable.listEntities({ queryOptions: { filter: `email eq '${safeEmail}'` } })) {
          await sessionTable.deleteEntity(s.partitionKey, s.rowKey).catch(() => {});
        }
      } catch (err) {
        context.log.error("Huỷ phiên khi từ chối tài khoản thất bại:", err.message);
      }
    }

    const greeting = buildGreeting(await getMemberDisplayName(email), await getMemberGender(email));
    const esc = v => String(v).replace(/[&<>"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
    const emailResult = await sendTrackedEmail(context, {
      to: email,
      subject: approve ? "Tài khoản của bạn đã được kích hoạt" : "Về đăng ký tài khoản của bạn",
      type: "registration",
      eyebrow: "Đăng Ký Thành Viên",
      title: approve ? "Tài khoản đã được phê duyệt" : "Tài khoản chưa được phê duyệt",
      bodyHtml: approve
        ? `<p style="margin:0 0 16px;">${greeting}</p>
           <p style="margin:0 0 12px;">Tài khoản thành viên của bạn tại Mạng Lưới Tri Thức Việt Nam đã được phê duyệt.</p>
           <p style="margin:0;">Bạn có thể đăng nhập ngay bằng email và mật khẩu đã đặt khi đăng ký.</p>`
        : `<p style="margin:0 0 16px;">${greeting}</p>
           <p style="margin:0 0 12px;">Cảm ơn bạn đã quan tâm tới Mạng Lưới Tri Thức Việt Nam. Rất tiếc, đăng ký tài khoản của bạn hiện chưa được phê duyệt.</p>
           ${reason ? `<p style="margin:0 0 12px;"><strong>Lý do:</strong> ${esc(reason)}</p>` : ""}
           <p style="margin:0;">Nếu cần hỗ trợ, vui lòng trả lời email này hoặc liên hệ hotro@wvn.vn.</p>`,
      ctas: approve ? [{ label: "Đăng Nhập Ngay", href: "https://wvn.vn/dang-nhap.html", style: "primary" }] : []
    });

    context.res.status = 200;
    context.res.body = {
      success: true,
      warning: emailResult.success ? null : (approve ? "Đã duyệt tài khoản, nhưng gửi email báo thất bại." : "Đã từ chối tài khoản, nhưng gửi email báo thất bại.")
    };
  } catch (err) {
    context.log.error("Lỗi duyệt tài khoản thành viên:", err.message);
    context.res.status = 500;
    context.res.body = { success: false, message: "Đã có lỗi xảy ra, vui lòng thử lại sau." };
  }
};
