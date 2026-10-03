const { requireAdmin } = require("../_shared/adminAuth");
const { askGroq } = require("../_shared/groq");

// Gợi ý trả lời cho 1 tin nhắn từ form Liên Hệ trên website — nhân viên xem/chỉnh sửa trong modal
// rồi tự copy gửi qua email của mình (khu vực này chưa có chức năng gửi email tích hợp).
module.exports = async function (context, req) {
  context.res = { headers: { "Content-Type": "application/json" } };
  if (!(await requireAdmin(context, req))) return;

  const b = req.body || {};
  const name = String(b.name || "").trim().slice(0, 100);
  const subject = String(b.subject || "").trim().slice(0, 150);
  const message = String(b.message || "").trim().slice(0, 1000);

  if (!message) {
    context.res.status = 400;
    context.res.body = { success: false, message: "Thiếu nội dung tin nhắn." };
    return;
  }

  const lines = [];
  lines.push(`Bạn là nhân viên của một trung tâm giáo dục phi lợi nhuận tên "Tri thức Việt" tại Việt Nam, đang trả lời tin nhắn từ form Liên Hệ trên website.`);
  lines.push(`Người gửi: ${name || "một người quan tâm"}${subject ? `, tiêu đề: "${subject}"` : ""}.`);
  lines.push(`Nội dung tin nhắn của họ:\n"""\n${message}\n"""`);
  lines.push(`Hãy viết 1 câu trả lời bằng tiếng Việt, ngắn gọn (3-6 câu), lịch sự, nhiệt tình, trả lời đúng trọng tâm câu hỏi. Nếu tin nhắn thiếu thông tin để trả lời cụ thể (vd hỏi học phí nhưng không nói chương trình nào), hãy trả lời chung chung và hỏi lại thông tin cần thiết. Chỉ trả về nội dung trả lời, không thêm tiêu đề hay giải thích gì khác.`);

  try {
    const body = await askGroq(lines.join("\n"), { maxOutputTokens: 400 });
    context.res.status = 200;
    context.res.body = { success: true, body };
  } catch (err) {
    context.log.error("Lỗi gợi ý trả lời liên hệ bằng AI:", err.message);
    context.res.status = err.code === "NO_API_KEY" ? 503 : 500;
    context.res.body = { success: false, message: err.message };
  }
};
