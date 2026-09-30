const { getTableClient } = require("./tableStorage");
const crypto = require("crypto");

const SUBS_TABLE = "PushSubscriptions";
let webpush = null;

// Khởi tạo web-push kèm khoá VAPID (chỉ 1 lần, dùng lại). Ném lỗi rõ ràng nếu chưa cấu hình khoá
// trên Azure (Application settings: VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY) — lỗi này được bắt và bỏ
// qua ở sendPush (best-effort), không làm hỏng thao tác chính (giao việc, nhắc tên...).
function getWebPush() {
  if (webpush) return webpush;
  const lib = require("web-push");
  const pub = process.env.VAPID_PUBLIC_KEY, priv = process.env.VAPID_PRIVATE_KEY;
  if (!pub || !priv) throw new Error("Thiếu VAPID_PUBLIC_KEY / VAPID_PRIVATE_KEY trong Application settings.");
  lib.setVapidDetails(process.env.VAPID_SUBJECT || "mailto:hotro@wvn.vn", pub, priv);
  webpush = lib;
  return webpush;
}

// RowKey ổn định từ endpoint (endpoint có thể chứa ký tự Azure Table không cho phép trong RowKey),
// đồng thời giúp upsert không tạo trùng khi cùng 1 thiết bị đăng ký lại.
const keyOf = endpoint => crypto.createHash("sha1").update(endpoint).digest("hex");

async function saveSubscription(email, sub) {
  const table = await getTableClient(SUBS_TABLE);
  await table.upsertEntity({
    partitionKey: String(email).toLowerCase(), rowKey: keyOf(sub.endpoint),
    endpoint: sub.endpoint, p256dh: sub.keys && sub.keys.p256dh, auth: sub.keys && sub.keys.auth,
    createdAt: new Date().toISOString()
  }, "Replace");
}
async function removeSubscription(email, endpoint) {
  const table = await getTableClient(SUBS_TABLE);
  await table.deleteEntity(String(email).toLowerCase(), keyOf(endpoint)).catch(() => {});
}

// Gửi push cho MỌI thiết bị đã đăng ký của 1 email. Best-effort: thiếu khoá VAPID, chưa có thiết bị
// nào đăng ký, hay lỗi gửi từng thiết bị đều không ném lỗi ra ngoài (không chặn luồng chính gọi nó).
// Thiết bị đã gỡ cài đặt / hết hạn đăng ký (endpoint trả 404/410) sẽ tự bị xoá khỏi bảng.
async function sendPush(context, email, payload) {
  try {
    const wp = getWebPush();
    const table = await getTableClient(SUBS_TABLE);
    const subs = [];
    const filter = `PartitionKey eq '${String(email).toLowerCase().replace(/'/g, "''")}'`;
    for await (const s of table.listEntities({ queryOptions: { filter } })) subs.push(s);
    for (const s of subs) {
      try {
        await wp.sendNotification({ endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } }, JSON.stringify(payload));
      } catch (err) {
        if (err.statusCode === 404 || err.statusCode === 410) await table.deleteEntity(s.partitionKey, s.rowKey).catch(() => {});
        else if (context && context.log) context.log.warn("Gửi thông báo đẩy thất bại:", err.message);
      }
    }
  } catch (e) { if (context && context.log) context.log.warn("Thông báo đẩy không khả dụng:", e.message); }
}

module.exports = { sendPush, saveSubscription, removeSubscription, SUBS_TABLE };
