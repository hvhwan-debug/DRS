const { getTableClient } = require("../_shared/tableStorage");
const { requireAdmin } = require("../_shared/adminAuth");

const POSTS_TABLE = "Posts";

module.exports = async function (context, req) {
  context.res = { headers: { "Content-Type": "application/json" } };
  if (!(await requireAdmin(context, req, "news"))) return;

  try {
    const table = await getTableClient(POSTS_TABLE);
    const posts = [];
    const it = table.listEntities({ queryOptions: { filter: "PartitionKey eq 'post'" } });
    for await (const p of it) {
      posts.push({
        slug: p.rowKey,
        title: p.title || "",
        date: p.date || "",
        image: p.image || "",
        loai: p.loai || "",
        excerpt: p.excerpt || "",
        body: p.body || "",
        published: !!p.published,
        createdAt: p.createdAt || "",
        updatedAt: p.updatedAt || ""
      });
    }
    posts.sort((a, b) => new Date(b.updatedAt || b.createdAt || 0) - new Date(a.updatedAt || a.createdAt || 0));
    context.res.status = 200;
    context.res.body = { success: true, posts };
  } catch (err) {
    context.log.error("Lỗi tải danh sách bài viết (admin):", err.message);
    context.res.status = 500;
    context.res.body = { success: false, message: "Đã có lỗi xảy ra, vui lòng thử lại sau." };
  }
};
