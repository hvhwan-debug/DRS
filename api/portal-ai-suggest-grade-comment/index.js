const { requireAdmin } = require("../_shared/adminAuth");
const { askGroq } = require("../_shared/groq");

// Gợi ý 1 câu nhận xét của giáo viên dựa trên điểm vừa nhập — giúp giáo viên không phải tự nghĩ
// cách viết nhận xét cho từng học sinh mỗi buổi học, chỉ cần xem lại và chỉnh sửa trước khi lưu.
module.exports = async function (context, req) {
  context.res = { headers: { "Content-Type": "application/json" } };
  if (!(await requireAdmin(context, req))) return;

  const b = req.body || {};
  const studentName = String(b.studentName || "").trim().slice(0, 100);
  const program = String(b.program || "").trim().slice(0, 100);
  const assessmentType = String(b.assessmentType || "Buổi học").trim().slice(0, 40);
  const score = (b.score === null || b.score === undefined || b.score === "") ? null : Number(b.score);

  if (!studentName) {
    context.res.status = 400;
    context.res.body = { success: false, message: "Thiếu tên học sinh." };
    return;
  }

  const scoreDesc = score === null || Number.isNaN(score) ? "chưa có điểm số cụ thể" : `${score}/10`;
  const tone = score === null || Number.isNaN(score) ? "trung lập, quan sát chung"
    : score >= 8.5 ? "khen ngợi cụ thể, nêu rõ điểm mạnh"
    : score >= 6.5 ? "động viên, ghi nhận tiến bộ, gợi ý 1 điều có thể cải thiện thêm"
    : "nhẹ nhàng, không chê trách, tập trung vào điều con cần luyện thêm và cách trung tâm sẽ hỗ trợ";

  const prompt = [
    `Bạn là giáo viên của một trung tâm giáo dục phi lợi nhuận tên "Tri thức Việt" tại Việt Nam.`,
    `Hãy viết 1 câu nhận xét ngắn (15-30 từ, tiếng Việt) cho học sinh "${studentName}"${program ? ` (chương trình: ${program})` : ""} sau buổi "${assessmentType}", điểm: ${scoreDesc}.`,
    `Giọng văn: ${tone}. Nhận xét cụ thể, như giáo viên thật viết tay, không sáo rỗng, không lặp lại tên học sinh nhiều lần.`,
    `Chỉ trả về đúng 1 câu nhận xét, không thêm dấu ngoặc kép, không giải thích gì khác.`
  ].join("\n");

  try {
    const comment = await askGroq(prompt, { maxOutputTokens: 100, temperature: 0.7 });
    context.res.status = 200;
    context.res.body = { success: true, comment: comment.replace(/^["']|["']$/g, "").trim() };
  } catch (err) {
    context.log.error("Lỗi gợi ý nhận xét điểm bằng AI:", err.message);
    context.res.status = err.code === "NO_API_KEY" ? 503 : 500;
    context.res.body = { success: false, message: err.message };
  }
};
