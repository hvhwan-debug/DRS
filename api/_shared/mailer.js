// Gửi email qua Microsoft Graph API (app-only / client credentials) thay vì SMTP — cách này
// KHÔNG bị vướng MFA/App Password vì xác thực bằng client secret của 1 "App Registration" trong
// Entra ID, không phải bằng mật khẩu của người dùng thật.
//
// Cấu hình qua Application Settings (Azure Function App):
//   GRAPH_TENANT_ID     — Directory (tenant) ID của App Registration
//   GRAPH_CLIENT_ID     — Application (client) ID của App Registration
//   GRAPH_CLIENT_SECRET — Client secret (giá trị "Value", không phải "Secret ID")
//   GRAPH_SENDER_EMAIL  — hộp thư @wvn.vn dùng để gửi (vd. hotro@wvn.vn) — App Registration cần
//                         quyền Application permission "Mail.Send" trên Microsoft Graph, đã được
//                         admin "Grant admin consent".

let cachedToken = null; // { accessToken, expiresAt } — dùng lại trong cùng 1 tiến trình còn "ấm"
async function getAccessToken() {
  const tenantId = process.env.GRAPH_TENANT_ID;
  const clientId = process.env.GRAPH_CLIENT_ID;
  const clientSecret = process.env.GRAPH_CLIENT_SECRET;
  if (!tenantId || !clientId || !clientSecret) {
    throw new Error("Thiếu GRAPH_TENANT_ID, GRAPH_CLIENT_ID hoặc GRAPH_CLIENT_SECRET trong Application settings.");
  }

  if (cachedToken && cachedToken.expiresAt > Date.now() + 60000) {
    return cachedToken.accessToken;
  }

  const res = await fetch(`https://login.microsoftonline.com/${tenantId}/oauth2/v2.0/token`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: clientId,
      client_secret: clientSecret,
      scope: "https://graph.microsoft.com/.default",
      grant_type: "client_credentials"
    })
  });
  const data = await res.json();
  if (!res.ok) {
    throw new Error(`Lấy access token thất bại: ${data.error_description || data.error || res.status}`);
  }
  cachedToken = { accessToken: data.access_token, expiresAt: Date.now() + (data.expires_in || 3600) * 1000 };
  return cachedToken.accessToken;
}

// attachments: mảng { content (base64 string), filename, type } — giữ nguyên hình dạng cũ để
// không phải sửa lại chỗ gọi; hàm này tự chuyển sang định dạng Microsoft Graph cần.
async function sendEmail({ to, from, fromName, replyTo, subject, html, attachments }) {
  const senderEmail = from || process.env.GRAPH_SENDER_EMAIL;
  if (!senderEmail) {
    throw new Error("Thiếu GRAPH_SENDER_EMAIL trong Application settings.");
  }
  const accessToken = await getAccessToken();

  const toList = (Array.isArray(to) ? to : [to]).map(addr => ({ emailAddress: { address: addr } }));

  const message = {
    subject,
    body: { contentType: "HTML", content: html },
    toRecipients: toList
  };
  if (replyTo) message.replyTo = [{ emailAddress: { address: replyTo } }];
  if (Array.isArray(attachments) && attachments.length > 0) {
    message.attachments = attachments.map(a => ({
      "@odata.type": "#microsoft.graph.fileAttachment",
      name: a.filename,
      contentType: a.type || "application/octet-stream",
      contentBytes: a.content
    }));
  }

  const res = await fetch(`https://graph.microsoft.com/v1.0/users/${encodeURIComponent(senderEmail)}/sendMail`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({ message, saveToSentItems: true })
  });

  if (!res.ok) {
    let detail = "";
    try { detail = JSON.stringify(await res.json()); } catch (e) { /* ignore */ }
    throw new Error(`Gửi email qua Microsoft Graph thất bại (${res.status}): ${detail}`);
  }
}

module.exports = { sendEmail };
