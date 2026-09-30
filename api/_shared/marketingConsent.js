// ============================================================================================
// ĐỒNG Ý NHẬN EMAIL QUẢNG CÁO (bản tin, khuyến mãi, tin tức gửi hàng loạt)
//   - Email QUẢNG CÁO (type thuộc MARKETING_TYPES): KHÔNG gửi cho người đã huỷ nhận, và luôn kèm link huỷ.
//   - Email THÔNG BÁO (học phí, hoá đơn, đổi quà, lịch học, CRM, bảo mật, thông báo quan trọng…): luôn gửi.
// Một người bị coi là đã huỷ nhận nếu: đã bấm link huỷ trong email (NewsletterSubscribers = unsubscribed)
// HOẶC đã tắt "Tin tức, sự kiện & chương trình mới" trong trang thành viên (MemberProfiles.prefsJson.news = false).
// Hai nơi luôn được đồng bộ bởi setMarketingConsent().
// ============================================================================================
const { getTableClient } = require("./tableStorage");

const MARKETING_TYPES = new Set(["bulk", "newsletter", "promo", "marketing"]);
const SUBS_TABLE = "NewsletterSubscribers";
const isMarketing = type => MARKETING_TYPES.has(String(type || "").toLowerCase());

async function isMarketingOptedOut(email) {
  const e = String(email || "").trim().toLowerCase(); if (!e) return false;
  try { const s = await (await getTableClient(SUBS_TABLE)).getEntity("sub", e); if (s.status === "unsubscribed") return true; } catch (err) {}
  try { const p = await (await getTableClient("MemberProfiles")).getEntity("profile", e); if (JSON.parse(p.prefsJson || "{}").news === false) return true; } catch (err) {}
  return false;
}

// Bật/tắt nhận email quảng cáo ở CẢ HAI nơi, để trang thành viên, tab Bản Tin và link huỷ luôn khớp nhau.
async function setMarketingConsent(email, allow, source) {
  const e = String(email || "").trim().toLowerCase(); if (!e) return;
  const now = new Date().toISOString();
  try {
    const t = await getTableClient(SUBS_TABLE);
    let exists = false; try { await t.getEntity("sub", e); exists = true; } catch (err) {}
    if (exists || allow === false) await t.upsertEntity({ partitionKey: "sub", rowKey: e, status: allow ? "subscribed" : "unsubscribed", unsubscribedAt: allow ? "" : now, consentSource: source || "" }, "Merge");
  } catch (err) {}
  try {
    const pt = await getTableClient("MemberProfiles");
    let p = null; try { p = await pt.getEntity("profile", e); } catch (err) {}
    if (p) { let prefs = {}; try { prefs = JSON.parse(p.prefsJson || "{}"); } catch (err) {} prefs.news = !!allow; await pt.upsertEntity({ partitionKey: "profile", rowKey: e, prefsJson: JSON.stringify(prefs), prefsUpdatedAt: now }, "Merge"); }
  } catch (err) {}
}

async function unsubscribeUrlFor(email) {
  const { createConfirmToken } = require("./confirmToken");
  const token = await createConfirmToken("newsletter-unsub", "sub", String(email).toLowerCase());
  return `https://wvn.vn/api/public-newsletter-unsubscribe?token=${token}`;
}

module.exports = { MARKETING_TYPES, isMarketing, isMarketingOptedOut, setMarketingConsent, unsubscribeUrlFor };
