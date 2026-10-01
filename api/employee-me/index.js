const { getTableClient } = require("../_shared/tableStorage");
const { requireAdmin, loadSessionAndAccount } = require("../_shared/adminAuth");
const { getAttachmentSasUrl, uploadEmployeeFile, deleteBlob } = require("../_shared/blobStorage");
const { logAdminActivity } = require("../_shared/activityLog");

const EMPLOYEES_TABLE = "Employees";
const NOTES_TABLE = "EmployeeNotes";

const SELF_FILE_KINDS = {
  avatar: "avatarBlobName",
  cccdFront: "cccdFrontBlobName",
  cccdBack: "cccdBackBlobName"
  // LƯU Ý: contractFile CỐ Ý không có ở đây — hợp đồng do HR/Quản Trị Viên Chính phát hành và tải
  // lên, nhân viên không tự thay được file này.
};

function genId() {
  return `emp-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

async function findByLinkedEmail(table, email) {
  const it = table.listEntities({ queryOptions: { filter: `PartitionKey eq 'employee' and linkedAdminEmail eq '${email.replace(/'/g, "''")}'` } });
  for await (const e of it) return e; // 1 nhân viên chỉ nên liên kết với đúng 1 hồ sơ
  return null;
}

async function toSelfView(e) {
  if (!e) return null;
  const fileUrl = async (blobName) => (blobName ? await getAttachmentSasUrl(blobName, 15).catch(() => null) : null);
  const [avatarUrl, cccdFrontUrl, cccdBackUrl] = await Promise.all([
    fileUrl(e.avatarBlobName), fileUrl(e.cccdFrontBlobName), fileUrl(e.cccdBackBlobName)
  ]);
  return {
    id: e.rowKey,
    fullName: e.fullName || "",
    dob: e.dob || "",
    idNumber: e.idNumber || "",
    address: e.address || "",
    emergencyContactName: e.emergencyContactName || "",
    emergencyContactPhone: e.emergencyContactPhone || "",
    // Các mục dưới đây do HR/quản lý thiết lập — chỉ hiển thị, không sửa được ở đây.
    position: e.position || "",
    contractType: e.contractType || "",
    contractStart: e.contractStart || "",
    contractEnd: e.contractEnd || "",
    status: e.status || "active",
    hasContractFile: !!e.contractFileBlobName,
    avatarUrl, cccdFrontUrl, cccdBackUrl,
    updatedBy: e.updatedBy || "", updatedAt: e.updatedAt || ""
  };
}

module.exports = async function (context, req) {
  context.res = { headers: { "Content-Type": "application/json" } };
  if (!(await requireAdmin(context, req))) return;

  const { session } = await loadSessionAndAccount(null, req);
  const email = String(session.adminEmail || "").toLowerCase();
  if (!email) {
    context.res.status = 403;
    context.res.body = { success: false, message: "Phiên đăng nhập này không gắn với tài khoản nào." };
    return;
  }

  const table = await getTableClient(EMPLOYEES_TABLE);

  if (String(req.method).toUpperCase() === "GET") {
    try {
      const e = await findByLinkedEmail(table, email);
      context.res.status = 200;
      context.res.body = { success: true, employee: await toSelfView(e) };
    } catch (err) {
      context.log.error("Lỗi tải hồ sơ cá nhân:", err.message);
      context.res.status = 500;
      context.res.body = { success: false, message: "Đã có lỗi xảy ra, vui lòng thử lại sau." };
    }
    return;
  }

  // POST — action: save | uploadFile
  const action = (req.body && req.body.action) || "";
  try {
    if (action === "save") {
      let e = await findByLinkedEmail(table, email);
      const id = e ? e.rowKey : genId();
      const fullName = String((req.body && req.body.fullName) || (e && e.fullName) || "").trim();
      if (!fullName) {
        context.res.status = 400;
        context.res.body = { success: false, message: "Vui lòng nhập họ và tên." };
        return;
      }
      const now = new Date().toISOString();
      const fields = {
        fullName,
        dob: String((req.body && req.body.dob) || "").trim(),
        idNumber: String((req.body && req.body.idNumber) || "").trim(),
        address: String((req.body && req.body.address) || "").trim(),
        emergencyContactName: String((req.body && req.body.emergencyContactName) || "").trim(),
        emergencyContactPhone: String((req.body && req.body.emergencyContactPhone) || "").trim()
      };
      await table.upsertEntity({
        partitionKey: "employee", rowKey: id, ...fields,
        linkedAdminEmail: email, updatedBy: "employee", updatedAt: now,
        createdAt: (e && e.createdAt) || now
      }, "Merge");

      if (!e) {
        const notesTable = await getTableClient(NOTES_TABLE);
        await notesTable.createEntity({
          partitionKey: id, rowKey: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
          note: "Nhân viên tự tạo hồ sơ", type: "system", author: fullName, at: now
        });
      }

      await logAdminActivity(req, "Nhân viên tự cập nhật hồ sơ", fullName);
      context.res.status = 200;
      context.res.body = { success: true, employee: await toSelfView(await table.getEntity("employee", id)) };
      return;
    }

    if (action === "uploadFile") {
      const kind = String((req.body && req.body.kind) || "");
      const field = SELF_FILE_KINDS[kind];
      if (!field) {
        context.res.status = 400;
        context.res.body = { success: false, message: "Loại file không hợp lệ." };
        return;
      }
      const e = await findByLinkedEmail(table, email);
      if (!e) {
        context.res.status = 400;
        context.res.body = { success: false, message: "Vui lòng lưu thông tin cơ bản trước khi tải ảnh/giấy tờ." };
        return;
      }
      const dataUrl = String((req.body && req.body.fileBase64) || "");
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
      const extByMime = { "image/png": "png", "image/jpeg": "jpg", "image/jpg": "jpg", "image/webp": "webp" };
      const ext = extByMime[mime];
      if (!ext) {
        context.res.status = 400;
        context.res.body = { success: false, message: "Chỉ hỗ trợ ảnh PNG, JPG hoặc WEBP." };
        return;
      }

      const oldBlobName = e[field];
      const newBlobName = await uploadEmployeeFile(e.rowKey, kind, { content: base64Content, type: mime, filename: `${kind}.${ext}` });
      await table.updateEntity({ partitionKey: "employee", rowKey: e.rowKey, [field]: newBlobName, updatedBy: "employee", updatedAt: new Date().toISOString() }, "Merge");
      if (oldBlobName) await deleteBlob(oldBlobName);

      const url = await getAttachmentSasUrl(newBlobName, 15);
      await logAdminActivity(req, "Nhân viên tự tải ảnh/giấy tờ", `${e.fullName} — ${kind}`);
      context.res.status = 200;
      context.res.body = { success: true, url };
      return;
    }

    context.res.status = 400;
    context.res.body = { success: false, message: "Thao tác không hợp lệ." };
  } catch (err) {
    context.log.error("Lỗi cập nhật hồ sơ cá nhân:", err.message);
    context.res.status = 500;
    context.res.body = { success: false, message: "Đã có lỗi xảy ra, vui lòng thử lại sau." };
  }
};
