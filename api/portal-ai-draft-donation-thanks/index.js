const { requireAdmin } = require("../_shared/adminAuth");
const { askGroq } = require("../_shared/groq");

// Soạn thư cảm ơn nhà hảo tâm bằng AI — nhân viên xem lại trong modal và tự copy gửi qua email
// hoặc Zalo của mình (khu vực Quyên Góp chưa có chức năng gửi email tích hợp).
module.exports = async function (context, req) {
  context.res = { headers: { "Content-Type": "application/json" } };
  if (!(await requireAdmin(context, req))) return;

  const b = req.body || {};
  const donorName = String(b.donorName || "").trim().slice(0, 100);
  const donationType = b.donationType === "item" ? "item" : "cash";
  const amount = Number(b.amount) || 0;
  const itemDescription = String(b.itemDescription || "").trim().slice(0, 300);
  const note = String(b.note || "").trim().slice(0, 300);

  if (!donorName) {
    context.res.status = 400;
    context.res.body = { success: false, message: "Thiếu tên nhà hảo tâm." };
    return;
  }

  const contributionDesc = donationType === "item"
    ? (itemDescription || "hiện vật")
    : `${amount.toLocaleString("vi-VN")} đồng`;

  const lines = [];
  lines.push(`Bạn là nhân viên của một trung tâm giáo dục phi lợi nhuận tên "Tri thức Việt" tại Việt Nam, đang viết thư cảm ơn một nhà hảo tâm.`);
  lines.push(`Thông tin đóng góp: nhà hảo tâm "${donorName}", đóng góp ${donationType === "item" ? "hiện vật" : "tiền mặt"}: ${contributionDesc}.`);
  if (note) lines.push(`Ghi chú thêm: ${note}`);
  lines.push(`Hãy viết 1 email cảm ơn bằng tiếng Việt, giọng văn chân thành, ấm áp, chuyên nghiệp nhưng không sáo rỗng — nêu cụ thể đóng góp này sẽ giúp ích gì cho học sinh/hoạt động của trung tâm, và mời nhà hảo tâm tiếp tục đồng hành.`);
  lines.push(`Trả lời ĐÚNG định dạng JSON, không thêm chữ nào khác: {"subject": "...", "body": "..."}. Email khoảng 100-180 từ.`);

  try {
    const raw = await askGroq(lines.join("\n"), { maxOutputTokens: 500 });
    const cleaned = raw.replace(/```json|```/g, "").trim();
    let result;
    try { result = JSON.parse(cleaned); } catch (e) { result = { subject: `Lời cảm ơn gửi ${donorName}`, body: cleaned }; }
    context.res.status = 200;
    context.res.body = { success: true, subject: String(result.subject || "").slice(0, 200), body: String(result.body || "").slice(0, 3000) };
  } catch (err) {
    context.log.error("Lỗi soạn thư cảm ơn bằng AI:", err.message);
    context.res.status = err.code === "NO_API_KEY" ? 503 : 500;
    context.res.body = { success: false, message: err.message };
  }
};
