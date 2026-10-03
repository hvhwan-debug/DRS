const { requireSuperAdmin } = require("../_shared/adminAuth");
const { askGemini } = require("../_shared/gemini");

// Tóm tắt nhanh lịch sử công tác/ghi chú đánh giá của 1 nhân sự bằng AI — chỉ Quản Trị Viên Chính
// được dùng, đúng với mức bảo mật của toàn bộ mục Hồ Sơ Nhân Sự.
module.exports = async function (context, req) {
  context.res = { headers: { "Content-Type": "application/json" } };
  if (!(await requireSuperAdmin(context, req))) return;

  const b = req.body || {};
  const fullName = String(b.fullName || "").trim().slice(0, 100);
  const position = String(b.position || "").trim().slice(0, 100);
  const notes = Array.isArray(b.notes) ? b.notes.slice(0, 50) : [];

  if (!fullName) {
    context.res.status = 400;
    context.res.body = { success: false, message: "Thiếu tên nhân sự." };
    return;
  }
  if (!notes.length) {
    context.res.status = 200;
    context.res.body = { success: true, summary: "Chưa có ghi chú nào để tóm tắt." };
    return;
  }

  const lines = [];
  lines.push(`Bạn đang hỗ trợ quản lý nhân sự của một trung tâm giáo dục phi lợi nhuận tên "Tri thức Việt" tại Việt Nam.`);
  lines.push(`Dưới đây là lịch sử công tác/ghi chú đánh giá của nhân sự "${fullName}"${position ? ` (vị trí: ${position})` : ""}, xếp theo thời gian:`);
  notes.forEach(n => lines.push(`- ${String(n.at || "").slice(0, 10)}: ${String(n.note || "").slice(0, 400)}`));
  lines.push(`\nHãy viết một đoạn tóm tắt ngắn gọn (4-6 câu, tiếng Việt) về quá trình làm việc của nhân sự này: điểm nổi bật, xu hướng tiến bộ hay cần lưu ý, và nhận xét tổng quan. Chỉ trả về đoạn tóm tắt, không thêm tiêu đề hay giải thích gì khác.`);

  try {
    const summary = await askGemini(lines.join("\n"), { maxOutputTokens: 400 });
    context.res.status = 200;
    context.res.body = { success: true, summary };
  } catch (err) {
    context.log.error("Lỗi tóm tắt nhân sự bằng AI:", err.message);
    context.res.status = err.code === "NO_API_KEY" ? 503 : 500;
    context.res.body = { success: false, message: err.message };
  }
};
