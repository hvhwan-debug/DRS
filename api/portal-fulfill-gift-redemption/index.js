const { getTableClient } = require("../_shared/tableStorage");
const { requireAdmin } = require("../_shared/adminAuth");
const { getMemberDisplayName, buildGreeting } = require("../_shared/memberName");
const { sendTrackedEmail } = require("../_shared/sendTrackedEmail");

const REDEMPTIONS_TABLE = "GiftRedemptions";

// Luồng trạng thái đầy đủ: pending (Chờ duyệt) -> shipping (Đang vận chuyển) -> fulfilled (Đã trao quà)
// Ở bất kỳ bước nào trước "fulfilled", admin cũng có thể chuyển sang "cancelled" (Huỷ).
const STATUS_META = {
  pending: { label: "Chờ duyệt", timestampField: null },
  shipping: { label: "Đang vận chuyển", timestampField: "shippedAt" },
  fulfilled: { label: "Đã trao quà", timestampField: "fulfilledAt" },
  cancelled: { label: "Đã huỷ", timestampField: "cancelledAt" }
};

// Các bước chuyển hợp lệ — chặn admin bấm nhầm lộn xộn thứ tự (trừ huỷ, có thể huỷ từ pending/shipping).
const ALLOWED_TRANSITIONS = {
  pending: ["shipping", "cancelled"],
  shipping: ["fulfilled", "cancelled"],
  fulfilled: [],
  cancelled: []
};

function buildStatusBodyHtml(status, giftName, greeting, reason) {
  const meta = STATUS_META[status];
  const bodyByStatus = {
    shipping: `<p style="margin:0;">Yêu cầu đổi quà <strong>${giftName}</strong> của bạn đang được <strong>chuẩn bị và vận chuyển</strong>. Chúng tôi sẽ liên hệ khi quà sẵn sàng trao tận nơi.</p>`,
    fulfilled: `<p style="margin:0;">Quà tặng <strong>${giftName}</strong> của bạn đã được <strong>trao thành công</strong>. Cảm ơn sự đồng hành của bạn cùng Mạng Lưới Tri Thức Việt Nam!</p>`,
    cancelled: `<p style="margin:0;">Yêu cầu đổi quà <strong>${giftName}</strong> của bạn đã bị <strong>huỷ</strong>.${reason ? ` Lý do: ${reason}` : ""}</p><p style="margin:10px 0 0;">Nếu có thắc mắc, vui lòng liên hệ đội ngũ hỗ trợ.</p>`
  };
  return `<p style="margin:0 0 16px;">${greeting}</p>
    <div style="text-align:center;margin:0 0 18px;">
      <span style="display:inline-block;font-size:14px;font-weight:800;padding:8px 18px;border-radius:999px;background:#f8fafc;border:1px solid #e2e8f0;color:#0f172a;">${meta.label}</span>
    </div>
    ${bodyByStatus[status]}`;
}

module.exports = async function (context, req) {
  context.res = { headers: { "Content-Type": "application/json" } };

  if (!(await requireAdmin(context, req))) return;

  const body = req.body || {};
  const email = String(body.email || "").trim().toLowerCase();
  const id = String(body.id || "").trim();
  // Giữ tương thích ngược: nếu không truyền status (client cũ), mặc định coi như đánh dấu "Đã trao quà".
  const status = String(body.status || "fulfilled").trim();
  const reason = String(body.reason || "").trim();

  if (!email || !id) {
    context.res.status = 400;
    context.res.body = { success: false, message: "Thiếu thông tin." };
    return;
  }
  if (!STATUS_META[status]) {
    context.res.status = 400;
    context.res.body = { success: false, message: "Trạng thái không hợp lệ." };
    return;
  }

  try {
    const redemptionsTable = await getTableClient(REDEMPTIONS_TABLE);
    let entity;
    try {
      entity = await redemptionsTable.getEntity(email, id);
    } catch (err) {
      if (err.statusCode === 404) {
        context.res.status = 404;
        context.res.body = { success: false, message: "Không tìm thấy yêu cầu đổi quà này." };
        return;
      }
      throw err;
    }

    const currentStatus = entity.status || "pending";
    const allowedNext = ALLOWED_TRANSITIONS[currentStatus] || [];
    if (currentStatus !== status && !allowedNext.includes(status)) {
      context.res.status = 409;
      context.res.body = {
        success: false,
        message: `Không thể chuyển từ trạng thái "${STATUS_META[currentStatus]?.label || currentStatus}" sang "${STATUS_META[status].label}".`
      };
      return;
    }

    const meta = STATUS_META[status];
    const updatePayload = { partitionKey: email, rowKey: id, status };
    if (meta.timestampField) updatePayload[meta.timestampField] = new Date().toISOString();
    if (status === "cancelled" && reason) updatePayload.cancelReason = reason;

    await redemptionsTable.updateEntity(updatePayload, "Merge");

    const displayName = await getMemberDisplayName(email);
    const greeting = buildGreeting(displayName);
    const emailResult = await sendTrackedEmail(context, {
      to: email,
      subject: `Đổi quà "${entity.giftName}": ${meta.label}`,
      type: "gift",
      eyebrow: "Đổi Quà Tặng",
      title: "Cập nhật đổi quà",
      bodyHtml: buildStatusBodyHtml(status, entity.giftName, greeting, reason)
    });

    context.res.status = 200;
    context.res.body = { success: true, status, warning: emailResult.success ? null : "Đã cập nhật trạng thái, nhưng gửi email báo thất bại." };
  } catch (err) {
    context.log.error("Lỗi cập nhật đổi quà:", err.message);
    context.res.status = 500;
    context.res.body = { success: false, message: "Đã có lỗi xảy ra, vui lòng thử lại sau." };
  }
};
