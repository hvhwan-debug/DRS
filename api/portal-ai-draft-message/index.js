const { requireAdmin } = require("../_shared/adminAuth");
const { askGemini } = require("../_shared/gemini");
const { logAdminActivity } = require("../_shared/activityLog");

// Soạn tin nhắn/email gợi ý cho phụ huynh bằng AI, dựa trên thông tin học sinh + lịch sử chăm sóc
// mà giao diện CRM gửi lên (không truy vấn lại dữ liệu — giữ API đơn giản, nhanh, dễ tái sử dụng).
module.exports = async function (context, req) {
  context.res = { headers: { "Content-Type": "application/json" } };
  if (!(await requireAdmin(context, req))) return;

  const b = req.body || {};
  const mode = b.mode === "email" ? "email" : "sms";
  const studentName = String(b.studentName || "").trim().slice(0, 100);
  const parentName = String(b.parentName || "").trim().slice(0, 100);
  const program = String(b.program || "").trim().slice(0, 100);
  const goal = String(b.goal || "").trim().slice(0, 300);
  const flags = Array.isArray(b.flags) ? b.flags.map(String).slice(0, 10) : [];
  const recent = Array.isArray(b.recentInteractions) ? b.recentInteractions.slice(0, 5) : [];

  if (!studentName) {
    context.res.status = 400;
    context.res.body = { success: false, message: "Thiếu tên học sinh." };
    return;
  }

  const lines = [];
  lines.push(`Bạn là nhân viên chăm sóc phụ huynh của một trung tâm giáo dục phi lợi nhuận tên "Tri thức Việt" tại Việt Nam.`);
  lines.push(`Hãy soạn ${mode === "email" ? "một email" : "một tin nhắn SMS/Zalo ngắn gọn"} gửi cho phụ huynh, bằng tiếng Việt, giọng văn ấm áp, lịch sự, chuyên nghiệp nhưng gần gũi — không máy móc, không rập khuôn.`);
  lines.push(`\nThông tin:`);
  lines.push(`- Học sinh: ${studentName}`);
  if (parentName) lines.push(`- Phụ huynh: ${parentName}`);
  if (program) lines.push(`- Chương trình học: ${program}`);
  if (flags.length) lines.push(`- Lưu ý hiện tại: ${flags.join(", ")}`);
  if (recent.length) {
    lines.push(`- Lịch sử trao đổi gần đây:`);
    recent.forEach(r => lines.push(`  + ${String(r.date || "").slice(0, 20)}: ${String(r.summary || "").slice(0, 200)}`));
  }
  if (goal) lines.push(`- Mục đích tin nhắn lần này: ${goal}`);
  lines.push(`\nYêu cầu: ${mode === "email" ? "Trả lời ĐÚNG định dạng JSON: {\"subject\": \"...\", \"body\": \"...\"} — không thêm chữ nào khác ngoài JSON. Email khoảng 80-150 từ." : "Chỉ trả về nội dung tin nhắn (không có tiêu đề, không giải thích gì thêm), tối đa 300 ký tự, không dùng markdown."}`);

  try {
    const raw = await askGemini(lines.join("\n"), { maxOutputTokens: 500 });
    let result;
    if (mode === "email") {
      const cleaned = raw.replace(/```json|```/g, "").trim();
      try { result = JSON.parse(cleaned); } catch (e) { result = { subject: `Thông tin về ${studentName}`, body: cleaned }; }
    } else {
      result = { body: raw.replace(/```/g, "").trim() };
    }
    await logAdminActivity(req, "CRM: soạn tin nhắn bằng AI", `${studentName} (${mode})`);
    context.res.status = 200;
    context.res.body = { success: true, ...result };
  } catch (err) {
    context.log.error("Lỗi soạn tin nhắn AI:", err.message);
    context.res.status = err.code === "NO_API_KEY" ? 503 : 500;
    context.res.body = { success: false, message: err.message };
  }
};
