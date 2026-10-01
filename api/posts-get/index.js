const { getTableClient } = require("../_shared/tableStorage");

const POSTS_TABLE = "Posts";

// Nội dung đầy đủ của 1 bài viết ĐÃ ĐĂNG, viết từ trang quản trị — chi-tiet.html gọi endpoint
// này khi không tìm thấy file content/posts/<slug>.md tĩnh tương ứng.
module.exports = async function (context, req) {
  context.res = { headers: { "Content-Type": "application/json" } };
  const slug = String((req.query && req.query.slug) || "").trim();
  if (!slug) {
    context.res.status = 400;
    context.res.body = { success: false, message: "Thiếu slug." };
    return;
  }
  try {
    const table = await getTableClient(POSTS_TABLE);
    const p = await table.getEntity("post", slug);
    if (!p.published) {
      context.res.status = 404;
      context.res.body = { success: false, message: "Bài viết chưa được đăng." };
      return;
    }
    context.res.status = 200;
    context.res.body = {
      success: true,
      title: p.title || "",
      date: p.date || "",
      image: p.image || "",
      loai: p.loai || "",
      excerpt: p.excerpt || "",
      body: p.body || ""
    };
  } catch (err) {
    if (err.statusCode === 404) {
      context.res.status = 404;
      context.res.body = { success: false, message: "Không tìm thấy bài viết." };
      return;
    }
    context.log.error("Lỗi tải bài viết:", err.message);
    context.res.status = 500;
    context.res.body = { success: false, message: "Đã có lỗi xảy ra." };
  }
};
