const { getTableClient } = require("../_shared/tableStorage");

const TOKENS_TABLE = "PublicConfirmTokens";
const SUBS_TABLE = "NewsletterSubscribers";

function page(title, message, ok) {
  return `<!DOCTYPE html><html lang="vi"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${title} · Mạng Lưới Tri Thức Việt Nam</title>
  <style>body{margin:0;font-family:Arial,Helvetica,sans-serif;background:#f1f5f9;display:flex;align-items:center;justify-content:center;min-height:100vh;padding:24px}
  .card{max-width:440px;background:#fff;border-radius:16px;box-shadow:0 8px 28px rgba(15,23,42,0.1);padding:36px 32px;text-align:center}
  .icon{width:56px;height:56px;border-radius:50%;display:flex;align-items:center;justify-content:center;margin:0 auto 18px;font-size:26px;color:#fff;background:${ok ? "#16a34a" : "#b91c1c"}}
  h1{font-size:19px;color:#0f172a;margin:0 0 10px}
  p{font-size:14px;color:#64748b;line-height:1.6;margin:0}
  a{display:inline-block;margin-top:22px;color:#fff;background:#0284c7;text-decoration:none;font-weight:700;font-size:13px;padding:10px 22px;border-radius:8px}</style></head>
  <body><div class="card"><div class="icon">${ok ? "&#10003;" : "&#10005;"}</div><h1>${title}</h1><p>${message}</p><a href="https://wvn.vn">Về trang chủ wvn.vn</a></div></body></html>`;
}

module.exports = async function (context, req) {
  context.res = { headers: { "Content-Type": "text/html; charset=utf-8" } };
  const token = String((req.query && req.query.token) || "").trim();
  if (!token) { context.res.status = 400; context.res.body = page("Thiếu thông tin", "Đường dẫn không hợp lệ.", false); return; }

  try {
    const tokensTable = await getTableClient(TOKENS_TABLE);
    let rec;
    try { rec = await tokensTable.getEntity("token", token); }
    catch (e) {
      if (e.statusCode === 404) { context.res.status = 200; context.res.body = page("Đường dẫn đã hết hạn", "Đường dẫn huỷ đăng ký này không còn hiệu lực (có thể đã được dùng trước đó). Nếu vẫn muốn huỷ, vui lòng liên hệ đội ngũ hỗ trợ."); return; }
      throw e;
    }
    if (rec.type !== "newsletter-unsub") { context.res.status = 400; context.res.body = page("Đường dẫn không hợp lệ", "Đường dẫn này không dùng để huỷ đăng ký bản tin.", false); return; }

    const email = rec.recordId;
    const subsTable = await getTableClient(SUBS_TABLE);
    await subsTable.upsertEntity({ partitionKey: "sub", rowKey: email, status: "unsubscribed", unsubscribedAt: new Date().toISOString() }, "Merge");
    await tokensTable.deleteEntity("token", token).catch(() => {});

    context.res.status = 200;
    context.res.body = page("Đã huỷ đăng ký", `Email <strong>${email}</strong> sẽ không nhận bản tin từ Mạng Lưới Tri Thức Việt Nam nữa. Bạn có thể đăng ký lại bất cứ lúc nào trên website.`, true);
  } catch (err) {
    context.log.error("Lỗi huỷ đăng ký bản tin:", err.message);
    context.res.status = 500;
    context.res.body = page("Đã có lỗi xảy ra", "Vui lòng thử lại sau ít phút.", false);
  }
};
