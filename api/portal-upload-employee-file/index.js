const { getTableClient } = require("../_shared/tableStorage");
const { requireSuperAdmin } = require("../_shared/adminAuth");
const { logAdminActivity } = require("../_shared/activityLog");
const { uploadEmployeeFile, deleteBlob, getAttachmentSasUrl } = require("../_shared/blobStorage");

const EMPLOYEES_TABLE = "Employees";

const KIND_TO_FIELD = {
  avatar: "avatarBlobName",
  cccdFront: "cccdFrontBlobName",
  cccdBack: "cccdBackBlobName",
  contractFile: "contractFileBlobName"
};
const KIND_LABEL = {
  avatar: "ảnh đại diện", cccdFront: "CCCD mặt trước", cccdBack: "CCCD mặt sau", contractFile: "file hợp đồng"
};

module.exports = async function (context, req) {
  context.res = { headers: { "Content-Type": "application/json" } };
  if (!(await requireSuperAdmin(context, req))) return;

  const body = req.body || {};
  const id = String(body.id || "").trim();
  const kind = String(body.kind || "").trim();
  const field = KIND_TO_FIELD[kind];
  if (!id || !field) {
    context.res.status = 400;
    context.res.body = { success: false, message: "Thiếu id hồ sơ hoặc loại file không hợp lệ." };
    return;
  }

  const dataUrl = String(body.fileBase64 || "");
  const match = dataUrl.match(/^data:([a-zA-Z0-9.+/-]+);base64,(.+)$/);
  if (!match) {
    context.res.status = 400;
    context.res.body = { success: false, message: "File không hợp lệ." };
    return;
  }
  const mime = match[1];
  const base64Content = match[2];
  if (base64Content.length > 12 * 1024 * 1024) {
    context.res.status = 400;
    context.res.body = { success: false, message: "File quá nặng (tối đa khoảng 9MB)." };
    return;
  }
  const extByMime = {
    "image/png": "png", "image/jpeg": "jpg", "image/jpg": "jpg", "image/webp": "webp",
    "application/pdf": "pdf"
  };
  const ext = extByMime[mime] || (body.filename || "").split(".").pop() || "bin";

  try {
    const table = await getTableClient(EMPLOYEES_TABLE);
    let e;
    try {
      e = await table.getEntity("employee", id);
    } catch (err) {
      if (err.statusCode === 404) {
        context.res.status = 404;
        context.res.body = { success: false, message: "Không tìm thấy hồ sơ nhân sự — vui lòng lưu thông tin cơ bản trước." };
        return;
      }
      throw err;
    }

    const oldBlobName = e[field];
    const newBlobName = await uploadEmployeeFile(id, kind, { content: base64Content, type: mime, filename: `${kind}.${ext}` });
    await table.updateEntity({ partitionKey: "employee", rowKey: id, [field]: newBlobName, updatedAt: new Date().toISOString() }, "Merge");
    if (oldBlobName) await deleteBlob(oldBlobName);

    const url = await getAttachmentSasUrl(newBlobName, 15);
    await logAdminActivity(req, "Tải file hồ sơ nhân sự", `${e.fullName} — ${KIND_LABEL[kind]}`);

    context.res.status = 200;
    context.res.body = { success: true, url };
  } catch (err) {
    context.log.error("Lỗi tải file hồ sơ nhân sự:", err.message);
    context.res.status = 500;
    context.res.body = { success: false, message: "Đã có lỗi xảy ra, vui lòng thử lại sau." };
  }
};
