const { getTableClient } = require("./tableStorage");

const PROFILES_TABLE = "MemberProfiles";

// Trả về họ tên đã lưu của thành viên (nếu có), hoặc null nếu chưa có/chưa điền.
async function getMemberDisplayName(email) {
  try {
    const profilesTable = await getTableClient(PROFILES_TABLE);
    const profile = await profilesTable.getEntity("profile", email.toLowerCase());
    return profile.fullName && profile.fullName.trim() ? profile.fullName.trim() : null;
  } catch (err) {
    return null; // Chưa có hồ sơ hoặc lỗi tra cứu -> dùng lời chào mặc định
  }
}

// Dòng chào mở đầu email — có tên nếu biết, không thì dùng cách xưng hô lịch sự chung.
function buildGreeting(displayName) {
  return displayName ? `Xin chào ${displayName},` : "Xin chào Quý phụ huynh,";
}

module.exports = { getMemberDisplayName, buildGreeting };
