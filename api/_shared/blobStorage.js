const { BlobServiceClient, BlobSASPermissions } = require("@azure/storage-blob");

const CONTAINER_NAME = "form-attachments";
let containerClientCache = null;

async function getContainerClient() {
  if (containerClientCache) return containerClientCache;

  const connectionString = process.env.AZURE_STORAGE_CONNECTION_STRING;
  if (!connectionString) {
    throw new Error("Thiếu AZURE_STORAGE_CONNECTION_STRING trong Application settings.");
  }

  const blobServiceClient = BlobServiceClient.fromConnectionString(connectionString);
  const containerClient = blobServiceClient.getContainerClient(CONTAINER_NAME);
  // Container KHÔNG public — chỉ xem được qua link tạm có chữ ký (SAS), để bảo vệ tài liệu cá nhân nhạy cảm.
  await containerClient.createIfNotExists();

  containerClientCache = containerClient;
  return containerClient;
}

// Tải danh sách file đính kèm (base64) lên Blob Storage, trả về danh sách { filename, blobName }.
// Chỉ lưu blobName (không phải URL công khai) — link xem thật sự được tạo riêng, có hạn dùng, khi cần.
async function uploadAttachments(attachments) {
  if (!Array.isArray(attachments) || attachments.length === 0) return [];

  const containerClient = await getContainerClient();
  const uploaded = [];

  for (const att of attachments) {
    if (!att || !att.content || !att.filename) continue;
    const safeName = att.filename.replace(/[^a-zA-Z0-9._-]/g, "_");
    const blobName = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}-${safeName}`;
    const blockBlobClient = containerClient.getBlockBlobClient(blobName);
    const buffer = Buffer.from(att.content, "base64");
    await blockBlobClient.uploadData(buffer, {
      blobHTTPHeaders: { blobContentType: att.type || "application/octet-stream" }
    });
    uploaded.push({ filename: att.filename, blobName });
  }

  return uploaded;
}

// Tạo link xem tạm thời (có hạn, mặc định 15 phút) cho 1 file đã lưu — chỉ gọi khi
// đã xác minh đúng chủ sở hữu (qua phiên đăng nhập), không để lộ blobName ra ngoài công khai.
async function getAttachmentSasUrl(blobName, expiryMinutes = 15) {
  const containerClient = await getContainerClient();
  const blockBlobClient = containerClient.getBlockBlobClient(blobName);
  const expiresOn = new Date(Date.now() + expiryMinutes * 60 * 1000);
  return blockBlobClient.generateSasUrl({
    permissions: BlobSASPermissions.parse("r"),
    expiresOn
  });
}

// Tải 1 ảnh minh hoạ quà tặng (base64) lên Blob Storage, trả về blobName để lưu vào GiftCatalog.
async function uploadGiftImage(image) {
  if (!image || !image.content) return null;
  const containerClient = await getContainerClient();
  const safeName = (image.filename || "gift.jpg").replace(/[^a-zA-Z0-9._-]/g, "_");
  const blobName = `gift-catalog/${Date.now()}-${Math.random().toString(36).slice(2, 8)}-${safeName}`;
  const blockBlobClient = containerClient.getBlockBlobClient(blobName);
  const buffer = Buffer.from(image.content, "base64");
  await blockBlobClient.uploadData(buffer, {
    blobHTTPHeaders: { blobContentType: image.type || "image/jpeg" }
  });
  return blobName;
}

// Xoá 1 blob đã lưu (best-effort — dùng khi thay ảnh mới hoặc xoá mục quà tặng).
async function deleteBlob(blobName) {
  if (!blobName) return;
  try {
    const containerClient = await getContainerClient();
    await containerClient.getBlockBlobClient(blobName).deleteIfExists();
  } catch (err) {
    // best-effort — không chặn luồng chính nếu xoá thất bại
  }
}

module.exports = { uploadAttachments, getAttachmentSasUrl, uploadGiftImage, deleteBlob };
