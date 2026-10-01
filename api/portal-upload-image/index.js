const { requireAdmin } = require("../_shared/adminAuth");
const { logAdminActivity } = require("../_shared/activityLog");

const GITHUB_OWNER = "hvhwan-debug";
const GITHUB_REPO = "DRS";
const GITHUB_BRANCH = "main";
const UPLOAD_FOLDER = "images/uploads";

const EXT_BY_MIME = {
  "image/png": "png",
  "image/jpeg": "jpg",
  "image/jpg": "jpg",
  "image/gif": "gif",
  "image/webp": "webp"
};

// Nhận 1 ảnh (dán hoặc kéo-thả) từ trình duyệt, đẩy thẳng vào thư mục images/uploads/ của repo
// trên GitHub — ĐÚNG kho ảnh công khai mà trang Tin Tức đang dùng (fetchUploadedImages()) — để
// không cần ai tự tay upload file lên git nữa. Cần biến môi trường GITHUB_TOKEN (Personal Access
// Token có quyền ghi nội dung repo) khai báo trong Application settings của Azure Function App.
module.exports = async function (context, req) {
  context.res = { headers: { "Content-Type": "application/json" } };
  if (!(await requireAdmin(context, req, "news"))) return;

  const dataUrl = String((req.body && req.body.imageBase64) || "");
  const match = dataUrl.match(/^data:(image\/[a-zA-Z0-9.+-]+);base64,(.+)$/);
  if (!match) {
    context.res.status = 400;
    context.res.body = { success: false, message: "Ảnh không hợp lệ (không đọc được dữ liệu ảnh)." };
    return;
  }
  const mime = match[1].toLowerCase();
  const base64Content = match[2];
  const ext = EXT_BY_MIME[mime];
  if (!ext) {
    context.res.status = 400;
    context.res.body = { success: false, message: "Chỉ hỗ trợ ảnh PNG, JPG, GIF hoặc WEBP." };
    return;
  }
  // Giới hạn ~8MB base64 (tương đương ~6MB ảnh gốc) để tránh file quá nặng cho trang web.
  if (base64Content.length > 8 * 1024 * 1024) {
    context.res.status = 400;
    context.res.body = { success: false, message: "Ảnh quá nặng (tối đa khoảng 6MB), vui lòng nén bớt trước khi dán." };
    return;
  }

  const token = process.env.GITHUB_TOKEN;
  if (!token) {
    context.res.status = 500;
    context.res.body = { success: false, message: "Chưa cấu hình GITHUB_TOKEN trong Application settings của máy chủ — liên hệ kỹ thuật để thêm." };
    return;
  }

  const filename = `paste-${Date.now()}-${Math.random().toString(36).slice(2, 8)}.${ext}`;
  const repoPath = `${UPLOAD_FOLDER}/${filename}`;

  try {
    const ghRes = await fetch(
      `https://api.github.com/repos/${GITHUB_OWNER}/${GITHUB_REPO}/contents/${repoPath}`,
      {
        method: "PUT",
        headers: {
          "Authorization": `token ${token}`,
          "Accept": "application/vnd.github+json",
          "Content-Type": "application/json",
          "User-Agent": "wvn-admin-upload"
        },
        body: JSON.stringify({
          message: `Thêm ảnh qua trang quản trị: ${filename}`,
          content: base64Content,
          branch: GITHUB_BRANCH
        })
      }
    );

    if (!ghRes.ok) {
      const errText = await ghRes.text().catch(() => "");
      context.log.error("Lỗi upload ảnh lên GitHub:", ghRes.status, errText);
      context.res.status = 502;
      context.res.body = { success: false, message: "Tải ảnh lên kho ảnh hệ thống thất bại, vui lòng thử lại." };
      return;
    }

    await logAdminActivity(req, "Tải ảnh lên kho ảnh", repoPath);
    context.res.status = 200;
    context.res.body = { success: true, path: repoPath };
  } catch (err) {
    context.log.error("Lỗi upload ảnh:", err.message);
    context.res.status = 500;
    context.res.body = { success: false, message: "Đã có lỗi xảy ra, vui lòng thử lại sau." };
  }
};
