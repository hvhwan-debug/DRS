// Gọi Google Gemini API — dùng chung cho mọi tính năng AI trong hệ thống (CRM, Hồ Sơ Nhân Sự,
// Công Việc...). Cần biến môi trường GEMINI_API_KEY (thêm ở Azure Portal → Static Web App →
// Configuration), lấy miễn phí tại aistudio.google.com/apikey.
const MODEL = "gemini-2.0-flash";

async function askGemini(prompt, { maxOutputTokens = 800, temperature = 0.6 } = {}) {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    const err = new Error("Chưa cấu hình GEMINI_API_KEY trên máy chủ. Vào Azure Portal → Configuration để thêm.");
    err.code = "NO_API_KEY";
    throw err;
  }

  const url = `https://generativelanguage.googleapis.com/v1beta/models/${MODEL}:generateContent?key=${apiKey}`;
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      contents: [{ parts: [{ text: prompt }] }],
      generationConfig: { maxOutputTokens, temperature }
    })
  });

  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const msg = (data && data.error && data.error.message) || `Gemini API lỗi (HTTP ${res.status})`;
    const err = new Error(msg);
    err.code = "GEMINI_ERROR";
    throw err;
  }

  const text = data &&
    data.candidates && data.candidates[0] &&
    data.candidates[0].content && data.candidates[0].content.parts &&
    data.candidates[0].content.parts[0] && data.candidates[0].content.parts[0].text;

  if (!text) {
    const err = new Error("Gemini không trả về nội dung (có thể do bộ lọc an toàn chặn).");
    err.code = "EMPTY_RESPONSE";
    throw err;
  }
  return text.trim();
}

module.exports = { askGemini };
