const { getTableClient } = require("./tableStorage");

// Xác thực phiên thành viên (header X-Member-Token) — trả email hoặc null, và tự đặt 401 cho context.
async function requireMember(context, req) {
  const h = req.headers || {};
  const token = String(h["x-member-token"] || h["X-Member-Token"] || "").trim();
  const deny = msg => { context.res.status = 401; context.res.body = { success: false, message: msg }; return null; };
  if (!token) return deny("Chưa đăng nhập.");
  try {
    const t = await getTableClient("AuthSessions");
    const s = await t.getEntity("session", token);
    if (new Date(s.expiresAt).getTime() < Date.now()) return deny("Phiên đăng nhập đã hết hạn.");
    return String(s.email || "").toLowerCase();
  } catch (err) {
    if (err.statusCode === 404) return deny("Phiên đăng nhập không hợp lệ.");
    throw err;
  }
}

// Mã giới thiệu ổn định cho mỗi thành viên (8 ký tự), không lộ email.
function referralCodeFor(email) {
  return require("crypto").createHash("sha1").update("wvn-ref|" + String(email || "").toLowerCase()).digest("hex").slice(0, 8);
}

// Cấu hình tài khoản nhận học phí để tạo mã VietQR. Đặt trong Azure → Cấu hình ứng dụng:
//   BANK_BIN (mã ngân hàng napas, vd 970436 Vietcombank), BANK_ACCOUNT, BANK_ACCOUNT_NAME
function bankConfig() {
  const bin = String(process.env.BANK_BIN || "").trim();
  const account = String(process.env.BANK_ACCOUNT || "").trim();
  const name = String(process.env.BANK_ACCOUNT_NAME || "").trim();
  const bankName = String(process.env.BANK_NAME || "").trim();
  return bin && account ? { bin, account, name, bankName } : null;
}

module.exports = { requireMember, referralCodeFor, bankConfig };
