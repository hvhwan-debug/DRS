const { getTableClient } = require("../_shared/tableStorage");
const { requireAdmin } = require("../_shared/adminAuth");
const { logAdminActivity } = require("../_shared/activityLog");
const { slugify } = require("../_shared/slugify");

const POSTS_TABLE = "Posts";

// Tạo mới hoặc cập nhật 1 bài viết. Nếu người viết đổi tiêu đề dẫn tới đổi slug (hoặc gửi
// originalSlug khác slug hiện tại), coi là ĐỔI TÊN: xoá bản ghi cũ (theo originalSlug) và tạo
// bản ghi mới (theo slug mới) — vì slug là rowKey trong Azure Table, không sửa trực tiếp được.
module.exports = async function (context, req) {
  context.res = { headers: { "Content-Type": "application/json" } };
  if (!(await requireAdmin(context, req, "news"))) return;

  const body = req.body || {};
  const title = String(body.title || "").trim();
  const originalSlug = String(body.originalSlug || "").trim();
  let slug = slugify(body.slug || title);
  const date = String(body.date || "").trim();
  const image = String(body.image || "").trim();
  const loai = String(body.loai || "tin-tuc").trim();
  const excerpt = String(body.excerpt || "").trim();
  const articleBody = String(body.body || "");
  const published = !!body.published;

  if (!title) {
    context.res.status = 400;
    context.res.body = { success: false, message: "Thiếu tiêu đề bài viết." };
    return;
  }
  if (!slug) {
    context.res.status = 400;
    context.res.body = { success: false, message: "Không tạo được đường dẫn (slug) từ tiêu đề, vui lòng đặt tiêu đề khác hoặc tự nhập slug." };
    return;
  }
  if (!date) {
    context.res.status = 400;
    context.res.body = { success: false, message: "Thiếu ngày đăng." };
    return;
  }

  try {
    const table = await getTableClient(POSTS_TABLE);
    const isRename = originalSlug && originalSlug !== slug;
    const isNew = !originalSlug;

    if (isNew || isRename) {
      try {
        await table.getEntity("post", slug);
        context.res.status = 400;
        context.res.body = { success: false, message: `Đường dẫn "${slug}" đã được dùng cho bài viết khác, vui lòng đổi tiêu đề hoặc tự nhập slug khác.` };
        return;
      } catch (e) {
        if (e.statusCode !== 404) throw e;
      }
    }

    const now = new Date().toISOString();
    let createdAt = now;
    if (!isNew) {
      try {
        const existing = await table.getEntity("post", isRename ? originalSlug : slug);
        createdAt = existing.createdAt || now;
      } catch (e) { /* không tìm thấy bản gốc -> coi như tạo mới */ }
    }

    await table.upsertEntity({
      partitionKey: "post", rowKey: slug, title, date, image, loai, excerpt, body: articleBody,
      published, createdAt, updatedAt: now
    }, "Replace");

    if (isRename) {
      try { await table.deleteEntity("post", originalSlug); } catch (e) { /* best-effort */ }
    }

    await logAdminActivity(req, isNew ? "Viết bài mới" : "Sửa bài viết", `${title} (${slug})${published ? " - đã đăng" : " - bản nháp"}`);

    context.res.status = 200;
    context.res.body = { success: true, slug, message: isNew ? "Đã tạo bài viết." : "Đã lưu thay đổi." };
  } catch (err) {
    context.log.error("Lỗi lưu bài viết:", err.message);
    context.res.status = 500;
    context.res.body = { success: false, message: "Đã có lỗi xảy ra, vui lòng thử lại sau." };
  }
};
