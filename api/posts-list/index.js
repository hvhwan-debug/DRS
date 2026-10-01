const { getTableClient } = require("../_shared/tableStorage");

const POSTS_TABLE = "Posts";

// Danh sách bài viết ĐÃ ĐĂNG (published=true), viết từ trang quản trị (khác với các bài viết
// tĩnh cũ nằm trong content/posts-index.json — trang Tin Tức sẽ gộp cả hai nguồn).
module.exports = async function (context, req) {
  context.res = { headers: { "Content-Type": "application/json" } };
  try {
    const table = await getTableClient(POSTS_TABLE);
    const posts = [];
    const it = table.listEntities({ queryOptions: { filter: "PartitionKey eq 'post'" } });
    for await (const p of it) {
      if (!p.published) continue;
      posts.push({
        slug: p.rowKey,
        title: p.title || "",
        date: p.date || "",
        image: p.image || "",
        loai: p.loai || "",
        excerpt: p.excerpt || ""
      });
    }
    context.res.status = 200;
    context.res.body = posts;
  } catch (err) {
    context.log.error("Lỗi tải danh sách bài viết:", err.message);
    context.res.status = 200;
    context.res.body = []; // lỗi -> trả mảng rỗng, không chặn trang Tin Tức hiển thị bài tĩnh
  }
};
