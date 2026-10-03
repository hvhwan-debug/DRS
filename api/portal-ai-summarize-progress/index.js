const { requireMember } = require("../_shared/memberSession");
const { askGroq } = require("../_shared/groq");

// Tóm tắt tiến bộ học tập của 1 học sinh bằng AI, dành cho PHỤ HUYNH xem trong Trang Thành Viên —
// gộp các điểm/nhận xét rời rạc của giáo viên thành 1 đoạn văn dễ đọc, ấm áp, đúng trọng tâm.
// Chỉ nhận dữ liệu điểm mà chính phụ huynh đang xem trên trang của họ (không truy vấn lại dữ liệu
// người khác), nên chỉ cần xác thực đã đăng nhập (requireMember) là đủ.
module.exports = async function (context, req) {
  context.res = { headers: { "Content-Type": "application/json" } };
  if (!(await requireMember(context, req))) return;

  const b = req.body || {};
  const studentName = String(b.studentName || "").trim().slice(0, 100);
  const program = String(b.program || "").trim().slice(0, 100);
  const entries = Array.isArray(b.entries) ? b.entries.slice(0, 40) : [];

  if (!studentName) {
    context.res.status = 400;
    context.res.body = { success: false, message: "Thiếu tên học sinh." };
    return;
  }
  if (!entries.length) {
    context.res.status = 200;
    context.res.body = { success: true, summary: "Chưa có đủ điểm/nhận xét để tóm tắt." };
    return;
  }

  const lines = [];
  lines.push(`Bạn là trợ lý của một trung tâm giáo dục phi lợi nhuận tên "Tri thức Việt" tại Việt Nam, đang viết trực tiếp cho PHỤ HUYNH đọc trên trang thành viên — không phải cho nhân viên nội bộ.`);
  lines.push(`Dưới đây là lịch sử điểm/nhận xét của con "${studentName}"${program ? ` (chương trình: ${program})` : ""}, xếp theo thời gian từ cũ đến mới:`);
  entries.forEach(e => {
    const date = String(e.date || "").slice(0, 10);
    const type = String(e.type || "Buổi học").slice(0, 40);
    const score = (e.score === null || e.score === undefined || e.score === "") ? "chưa chấm điểm" : `${e.score}/10`;
    const comment = String(e.comment || "").trim().slice(0, 300);
    lines.push(`- ${date} (${type}, điểm: ${score})${comment ? `: ${comment}` : ""}`);
  });
  lines.push(`\nHãy viết một đoạn tóm tắt ngắn gọn (3-5 câu, tiếng Việt), giọng văn ấm áp, tích cực nhưng trung thực — không tâng bốc quá đà, không giấu nếu điểm có xu hướng giảm. Nêu rõ: xu hướng chung (tiến bộ/ổn định/cần lưu ý), 1 điểm mạnh cụ thể, và 1 điều phụ huynh có thể đồng hành cùng con nếu cần. Chỉ trả về đoạn văn, không thêm tiêu đề hay giải thích gì khác.`);

  try {
    const summary = await askGroq(lines.join("\n"), { maxOutputTokens: 350 });
    context.res.status = 200;
    context.res.body = { success: true, summary };
  } catch (err) {
    context.log.error("Lỗi tóm tắt tiến bộ bằng AI (phụ huynh):", err.message);
    context.res.status = err.code === "NO_API_KEY" ? 503 : 500;
    context.res.body = { success: false, message: err.message };
  }
};
