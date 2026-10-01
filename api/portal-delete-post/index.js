const { getTableClient } = require("../_shared/tableStorage");
const { requireAdmin } = require("../_shared/adminAuth");
const { logAdminActivity } = require("../_shared/activityLog");

const POSTS_TABLE = "Posts";

module.exports = async function (context, req) {
  context.res = { headers: { "Content-Type": "application/json" } };
  if (!(await requireAdmin(context, req, "news"))) return;

  const slug = String((req.body && req.body.slug) || "").trim();
  if (!slug) {
    context.res.status = 400;
    context.res.body = { success: false, message: "Thiếu slug." };
    return;
  }

  try {
    const table = await getTableClient(POSTS_TABLE);
    try {
      await table.deleteEntity("post", slug);
    } catch (e) {
      if (e.statusCode !== 404) throw e;
    }
    await logAdminActivity(req, "Xoá bài viết", slug);
    context.res.status = 200;
    context.res.body = { success: true };
  } catch (err) {
    context.log.error("Lỗi xoá bài viết:", err.message);
    context.res.status = 500;
    context.res.body = { success: false, message: "Đã có lỗi xảy ra, vui lòng thử lại sau." };
  }
};
