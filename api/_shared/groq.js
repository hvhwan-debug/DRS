// Gọi Groq API (https://console.groq.com) — dùng chung cho mọi tính năng AI trong hệ thống (CRM,
// Hồ Sơ Nhân Sự, Công Việc...). Groq có gói miễn phí vĩnh viễn, không cần thẻ thanh toán.
// Cần biến môi trường GROQ_API_KEY (thêm ở Azure Portal → Static Web App → Configuration),
// lấy miễn phí tại console.groq.com/keys.
//
// Model mặc định. Có thể đổi mà không cần sửa code: thêm biến GROQ_MODEL trong Azure Portal →
// Configuration (ví dụ "llama-3.1-8b-instant" để nhanh hơn, hoặc model mới hơn khi Groq cập nhật).
const DEFAULT_MODEL = "llama-3.3-70b-versatile";

async function askGroq(prompt, { maxOutputTokens = 800, temperature = 0.6 } = {}) {
  const apiKey = process.env.GROQ_API_KEY;
  if (!apiKey) {
    const err = new Error("Chưa cấu hình GROQ_API_KEY trên máy chủ. Vào Azure Portal → Configuration để thêm.");
    err.code = "NO_API_KEY";
    throw err;
  }

  const MODEL = process.env.GROQ_MODEL || DEFAULT_MODEL;
  const url = "https://api.groq.com/openai/v1/chat/completions";
  const res = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Authorization": `Bearer ${apiKey}`
    },
    body: JSON.stringify({
      model: MODEL,
      messages: [{ role: "user", content: prompt }],
      max_tokens: maxOutputTokens,
      temperature
    })
  });

  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const msg = (data && data.error && data.error.message) || `Groq API lỗi (HTTP ${res.status})`;
    const err = new Error(msg);
    err.code = "GROQ_ERROR";
    throw err;
  }

  const text = data &&
    data.choices && data.choices[0] &&
    data.choices[0].message && data.choices[0].message.content;

  if (!text) {
    const err = new Error("Groq không trả về nội dung (có thể do bộ lọc an toàn chặn).");
    err.code = "EMPTY_RESPONSE";
    throw err;
  }
  return text.trim();
}

module.exports = { askGroq };
