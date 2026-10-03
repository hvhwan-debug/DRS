const { requireAdmin } = require("../_shared/adminAuth");
const { askGroq } = require("../_shared/groq");

// Gợi ý mô tả công việc + danh sách việc nhỏ (checklist) từ tiêu đề việc — giúp nhân viên gõ nhanh
// 1 dòng tiêu đề rồi để AI phác thảo chi tiết, sau đó tự chỉnh sửa lại cho đúng ý.
module.exports = async function (context, req) {
  context.res = { headers: { "Content-Type": "application/json" } };
  if (!(await requireAdmin(context, req))) return;

  const b = req.body || {};
  const title = String(b.title || "").trim().slice(0, 200);
  const projectName = String(b.projectName || "").trim().slice(0, 100);

  if (!title) {
    context.res.status = 400;
    context.res.body = { success: false, message: "Thiếu tiêu đề việc." };
    return;
  }

  const prompt = [
    `Bạn đang hỗ trợ nhân viên một trung tâm giáo dục phi lợi nhuận tên "Tri thức Việt" tại Việt Nam lên kế hoạch công việc.`,
    `Tên việc: "${title}"${projectName ? ` (thuộc dự án "${projectName}")` : ""}`,
    `Hãy viết:`,
    `1. Một đoạn mô tả ngắn (2-4 câu, tiếng Việt) giải thích rõ việc này cần làm gì, vì sao quan trọng.`,
    `2. Danh sách 3-5 việc nhỏ cụ thể (checklist) để hoàn thành việc này.`,
    `Trả lời ĐÚNG định dạng JSON, không thêm chữ nào khác: {"description": "...", "checklist": ["...", "..."]}`
  ].join("\n");

  try {
    const raw = await askGroq(prompt, { maxOutputTokens: 500 });
    const cleaned = raw.replace(/```json|```/g, "").trim();
    let result;
    try { result = JSON.parse(cleaned); } catch (e) { result = { description: cleaned, checklist: [] }; }
    result.checklist = Array.isArray(result.checklist) ? result.checklist.map(String).slice(0, 8) : [];
    context.res.status = 200;
    context.res.body = { success: true, description: String(result.description || "").slice(0, 2000), checklist: result.checklist };
  } catch (err) {
    context.log.error("Lỗi gợi ý việc bằng AI:", err.message);
    context.res.status = err.code === "NO_API_KEY" ? 503 : 500;
    context.res.body = { success: false, message: err.message };
  }
};
