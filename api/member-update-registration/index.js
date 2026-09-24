const { getTableClient } = require("../_shared/tableStorage");
const { uploadAttachments } = require("../_shared/blobStorage");

const SESSION_TABLE = "AuthSessions";
const REGISTRATIONS_TABLE = "Registrations";

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

  const body = req.body || {};
  const id = String(body.id || "").trim();
  const newData = (body.data && typeof body.data === "object") ? body.data : {};

  if (!id) {
    context.res.status = 400;
    context.res.body = { success: false, message: "Thiếu thông tin đơn cần sửa." };
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
    let entity;
    try {
      entity = await regTable.getEntity(email, id);
    } catch (err) {
      if (err.statusCode === 404) {
        context.res.status = 404;
        context.res.body = { success: false, message: "Không tìm thấy đơn đăng ký." };
        return;
      }
      throw err;
    }

    if (entity.status === "Đã duyệt") {
      context.res.status = 403;
      context.res.body = { success: false, message: "Đơn đã được duyệt, không thể sửa nữa." };
      return;
    }

    // Giữ nguyên dữ liệu cũ, chỉ ghi đè các trường được gửi lên (không cho đổi email để tránh đổi chủ đơn)
    let mergedData = {};
    try { mergedData = JSON.parse(entity.dataJson || "{}"); } catch (e) {}
    mergedData = { ...mergedData, ...newData };
    delete mergedData.email;
    delete mergedData.email_phu_huynh;

    let attachmentsJson = entity.attachmentsJson;
    let warning = null;
    if (Array.isArray(body.attachments) && body.attachments.length > 0) {
      try {
        const uploaded = await uploadAttachments(body.attachments);
        attachmentsJson = JSON.stringify(uploaded);
      } catch (err) {
        context.log.error("Lưu ảnh mới vào Blob Storage thất bại:", err.message);
        warning = "Đã cập nhật đơn, nhưng KHÔNG lưu được ảnh mới.";
      }
    }

    await regTable.updateEntity({
      partitionKey: email,
      rowKey: id,
      dataJson: JSON.stringify(mergedData),
      attachmentsJson,
      // Sửa lại xong -> đưa về chờ xử lý để đội ngũ xem lại
      status: "Đã ghi nhận - Chờ xử lý",
      rejectionReason: ""
    }, "Merge");

    context.res.status = 200;
    context.res.body = { success: true, warning };
  } catch (err) {
    context.log.error("Lỗi sửa đơn đăng ký:", err.message);
    context.res.status = 500;
    context.res.body = { success: false, message: "Đã có lỗi xảy ra, vui lòng thử lại sau." };
  }
};
