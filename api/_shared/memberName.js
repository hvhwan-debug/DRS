const { getTableClient } = require("./tableStorage");

const PROFILES_TABLE = "MemberProfiles";

// Giới tính dùng để XƯNG HÔ trong email: "male" -> anh, "female" -> chị, "" -> chưa rõ (chào trung tính).
function normalizeGender(v) {
  const s = String(v == null ? "" : v).trim().toLowerCase().normalize("NFC");
  if (["male", "nam", "m", "anh"].includes(s)) return "male";
  if (["female", "nữ", "nu", "f", "chị", "chi"].includes(s)) return "female";
  return "";
}
function salutationFor(gender) {
  const g = normalizeGender(gender);
  return g === "male" ? "anh" : g === "female" ? "chị" : "";
}

// Đọc hồ sơ 1 lần rồi nhớ tạm vài giây — các API thường gọi tên rồi giới tính liền nhau.
const cache = new Map();
async function getProfileBasics(email) {
  const key = String(email || "").toLowerCase();
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < 15000) return hit.v;
  let v = { name: null, gender: "" };
  try {
    const profilesTable = await getTableClient(PROFILES_TABLE);
    const profile = await profilesTable.getEntity("profile", key);
    v = { name: profile.fullName && profile.fullName.trim() ? profile.fullName.trim() : null, gender: normalizeGender(profile.gender) };
  } catch (err) { /* chưa có hồ sơ hoặc lỗi tra cứu -> lời chào mặc định */ }
  cache.set(key, { at: Date.now(), v });
  if (cache.size > 500) cache.delete(cache.keys().next().value);
  return v;
}

// Trả về họ tên đã lưu của thành viên (nếu có), hoặc null nếu chưa có/chưa điền.
async function getMemberDisplayName(email) {
  return (await getProfileBasics(email)).name;
}
// Giới tính đã lưu ("male" | "female" | "") để xưng hô anh/chị
async function getMemberGender(email) {
  return (await getProfileBasics(email)).gender;
}

// Dòng chào mở đầu email — xưng "anh"/"chị" nếu biết giới tính, có tên nếu biết tên,
// không thì dùng cách xưng hô lịch sự chung.
function buildGreeting(displayName, gender) {
  const s = salutationFor(gender);
  if (displayName && s) return `Xin chào ${s} ${displayName},`;
  if (displayName) return `Xin chào ${displayName},`;
  if (s) return `Xin chào ${s},`;
  return "Xin chào Quý phụ huynh,";
}

module.exports = { getMemberDisplayName, getMemberGender, buildGreeting, normalizeGender, salutationFor };
