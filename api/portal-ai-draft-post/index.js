const { requireAdmin } = require("../_shared/adminAuth");
const { askGroq } = require("../_shared/groq");

// Viết nháp bài viết (tin tức/hoạt động) từ tiêu đề + các gạch đầu dòng — nhân viên biên tập lại
// giọng văn/chi tiết trước khi đăng, AI chỉ giúp dựng khung bài nhanh hơn viết từ đầu.
module.exports = async function (context, req) {
  context.res = { headers: { "Content-Type": "application/json" } };
  if (!(await requireAdmin(context, req))) return;

  const b = req.body || {};
  const title = String(b.title || "").trim().slice(0, 200);
  const excerpt = String(b.excerpt || "").trim().slice(0, 300);
  const bullets = Array.isArray(b.bullets) ? b.bullets.map(String).slice(0, 15) : [];

  if (!title || !bullets.length) {
    context.res.status = 400;
    context.res.body = { success: false, message: "Thiếu tiêu đề hoặc các ý chính." };
    return;
  }

  const lines = [];
  lines.push(`Bạn là nhân viên truyền thông của một trung tâm giáo dục phi lợi nhuận tên "Tri thức Việt" tại Việt Nam, đang viết bài đăng lên website (mục Tin Tức/Hoạt Động).`);
  lines.push(`Tiêu đề bài: "${title}"`);
  if (excerpt) lines.push(`Mô tả ngắn: ${excerpt}`);
  lines.push(`Các ý chính cần đưa vào bài (theo thứ tự):`);
  bullets.forEach(bl => lines.push(`- ${bl.slice(0, 300)}`));
  lines.push(`\nHãy viết bản nháp nội dung bài bằng tiếng Việt, định dạng Markdown đơn giản (có thể dùng ### cho tiêu đề phụ nếu bài dài), giọng văn tự nhiên, ấm áp, như một bài viết thật của trung tâm — không liệt kê lại các ý chính y nguyên mà viết thành đoạn văn mạch lạc, có mở bài và kết bài ngắn. Độ dài khoảng 250-450 từ. Chỉ trả về nội dung bài viết, không thêm tiêu đề bài (tiêu đề đã có sẵn ở nơi khác), không thêm giải thích gì khác.`);

  try {
    const body = await askGroq(lines.join("\n"), { maxOutputTokens: 1200, temperature: 0.7 });
    context.res.status = 200;
    context.res.body = { success: true, body };
  } catch (err) {
    context.log.error("Lỗi viết nháp bài viết bằng AI:", err.message);
    context.res.status = err.code === "NO_API_KEY" ? 503 : 500;
    context.res.body = { success: false, message: err.message };
  }
};
