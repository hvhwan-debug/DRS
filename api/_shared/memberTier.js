const { getTableClient } = require("./tableStorage");

const TUITION_TABLE = "TuitionPayments";
const PROFILES_TABLE = "MemberProfiles";

// Nguồn dữ liệu hạng DUY NHẤT phía server — phải khớp với getMembershipTier()/TIER_PERKS
// trong thanh-vien-index.html (giao diện). Nếu sửa mốc hạng, sửa ở CẢ HAI nơi.
//
// Thứ tự hạng (từ thấp đến cao): Thành Viên Mới -> Thân Thiết -> Bạc -> Titanium -> Vàng -> Kim Cương.
//
// earnRate: điểm tích lũy = % trực tiếp trên TỔNG học phí đã đóng, tăng dần theo hạng: 2% - 4% - 6% - 8% - 10% - 12%.
// Quy đổi ra điểm: 1 điểm = 1.000đ giá trị (vd hạng Bạc 6% trên 10.000.000đ = 600.000đ giá trị = 600 điểm).
const TIERS = [
  { name: "Thành Viên Mới", min: 0, icon: "fa-seedling", color: "#64748b", earnRate: { mode: "%", value: 2 } },
  { name: "Thân Thiết", min: 5000000, icon: "fa-heart", color: "#0284c7", earnRate: { mode: "%", value: 4 } },
  { name: "Bạc", min: 10000000, icon: "fa-medal", color: "#64748b", earnRate: { mode: "%", value: 6 } },
  { name: "Titanium", min: 20000000, icon: "fa-shield-halved", color: "#5b7c99", earnRate: { mode: "%", value: 8 } },
  { name: "Vàng", min: 40000000, icon: "fa-crown", color: "#c9a227", earnRate: { mode: "%", value: 10 } },
  { name: "Kim Cương", min: 70000000, icon: "fa-gem", color: "#0369a1", earnRate: { mode: "%", value: 12 } }
];

// Hạng "VIP" (mở khoá giao diện riêng, chữ "VIP", email premium): từ hạng Vàng trở lên.
const VIP_MIN_TOTAL = 40000000;

// Thời gian bảo lưu hạng kể từ ngày lên hạng: 12 tháng. Trong 12 tháng này, nếu tổng học phí
// tính ra hạng thấp hơn (vd. do admin sửa/xoá 1 khoản học phí), thành viên vẫn được GIỮ hạng cũ,
// không bị tụt hạng ngay. Hết 12 tháng mới tính lại đúng theo tổng học phí thực tế tại thời điểm đó.
const TIER_RETENTION_MONTHS = 12;

function getTierByTotal(totalPaid) {
  let current = TIERS[0];
  for (const t of TIERS) {
    if (totalPaid >= t.min) current = t;
  }
  return current;
}

function tierRank(name) {
  return TIERS.findIndex(t => t.name === name);
}

function isVipTotal(totalPaid) {
  return totalPaid >= VIP_MIN_TOTAL;
}

function addMonths(date, months) {
  const d = new Date(date);
  d.setMonth(d.getMonth() + months);
  return d;
}

// Tính điểm tích lũy hiện có, dựa trên TỔNG học phí đã đóng và hạng hiện tại (giống cách
// tính hạng: luỹ kế, không tính lùi theo lịch sử từng đợt tăng hạng).
function calculatePoints(totalPaid, tier) {
  const t = tier || getTierByTotal(totalPaid);
  const fraction = t.earnRate.mode === "%" ? t.earnRate.value / 100 : (t.earnRate.value * 0.001);
  return Math.round((totalPaid * fraction) / 1000);
}

function describeEarnRate(tier) {
  return tier.earnRate.mode === "%" ? `${tier.earnRate.value}%` : `${tier.earnRate.value}x`;
}

// Đọc số điểm ĐÃ DÙNG (đổi quà) của 1 email — lưu cộng dồn trong MemberProfiles.spentPoints.
async function getSpentPoints(email) {
  try {
    const profilesTable = await getTableClient(PROFILES_TABLE);
    const p = await profilesTable.getEntity("profile", email);
    return Number(p.spentPoints) || 0;
  } catch (e) {
    return 0;
  }
}

// Cộng/trừ vào số điểm đã dùng (delta âm = hoàn điểm khi huỷ đổi quà). Không cho âm tổng đã dùng.
// Dùng ETag (optimistic concurrency) + thử lại: nếu thành viên bấm đổi quà nhiều lần liên tiếp/nhanh
// (hoặc mở 2 tab), 2 request có thể cùng đọc "đã dùng" trước khi request kia ghi xong, dẫn đến
// GHI ĐÈ và làm mất 1 lần trừ điểm — đây là nguyên nhân đã gây ra tình trạng "đổi quà nhưng
// không trừ điểm" trước đây. Việc chỉ ghi lại nếu ETag còn khớp (và thử lại khi không khớp) đảm
// bảo không lần trừ/hoàn điểm nào bị mất do 2 yêu cầu chạy song song.
async function adjustSpentPoints(email, delta) {
  const profilesTable = await getTableClient(PROFILES_TABLE);
  const maxAttempts = 8;
  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    let entity = null;
    try {
      entity = await profilesTable.getEntity("profile", email);
    } catch (e) {
      if (e.statusCode !== 404) throw e;
    }
    const current = Number(entity && entity.spentPoints) || 0;
    const next = Math.max(0, current + delta);
    try {
      if (entity) {
        await profilesTable.updateEntity(
          { partitionKey: "profile", rowKey: email, spentPoints: next },
          "Merge",
          { etag: entity.etag }
        );
      } else {
        // Chưa có hồ sơ -> tạo mới; nếu 2 request cùng tạo lần đầu, request thua sẽ nhận lỗi 409 -> thử lại ở vòng sau
        await profilesTable.createEntity({ partitionKey: "profile", rowKey: email, spentPoints: next });
      }
      return next;
    } catch (err) {
      // 412 = ETag không còn khớp (bị ghi đè bởi request khác), 409 = vừa được tạo bởi request khác -> đọc lại và thử lại
      if (err.statusCode === 412 || err.statusCode === 409) {
        await new Promise(r => setTimeout(r, 60 + Math.random() * 120));
        continue;
      }
      throw err;
    }
  }
  throw new Error("Không thể cập nhật điểm tích lũy do có quá nhiều yêu cầu cùng lúc, vui lòng thử lại.");
}

// Điểm tích lũy KHẢ DỤNG để đổi quà = điểm đã tích lũy (tính từ tổng học phí) - điểm đã dùng.
// Đây là nguồn điểm DUY NHẤT dùng để đổi quà — quà tặng đổi bằng ĐIỂM, không phải mốc học phí,
// và có thể đổi nhiều lần miễn đủ điểm (không giới hạn "mỗi hạng chỉ đổi 1 lần").
async function getPointsBalance(email) {
  const totalPaid = await getTotalTuitionPaid(email);
  const tier = getTierByTotal(totalPaid);
  const earned = calculatePoints(totalPaid, tier);
  const spent = await getSpentPoints(email);
  const available = Math.max(0, earned - spent);
  return { earned, spent, available, tier, totalPaid };
}

// Tổng học phí đã đóng của 1 email — dùng chung cho tính hạng/điểm ở nhiều API.
async function getTotalTuitionPaid(email) {
  const tuitionTable = await getTableClient(TUITION_TABLE);
  let totalPaid = 0;
  const iterator = tuitionTable.listEntities({
    queryOptions: { filter: `PartitionKey eq '${email.replace(/'/g, "''")}'` }
  });
  for await (const entity of iterator) {
    totalPaid += Number(entity.amount) || 0;
  }
  return totalPaid;
}

// Áp dụng logic bảo lưu hạng 12 tháng, THUẦN TÍNH TOÁN (không đọc/ghi bảng) — cho input là hồ sơ
// đã đọc sẵn (profile.tierLockedName / tierLockedAt, có thể chưa có) + hạng tính từ tổng học phí.
// Trả về { tier, isUpgrade, needsLockUpdate, newLockedName, newLockedAtIso }.
function resolveEffectiveTier(rawTier, lockedName, lockedAtIso) {
  const rawIdx = tierRank(rawTier.name);
  const lockedIdx = lockedName ? tierRank(lockedName) : -1;
  const lockedAt = lockedAtIso ? new Date(lockedAtIso) : null;
  const now = new Date();
  const lockExpired = !lockedAt || now >= addMonths(lockedAt, TIER_RETENTION_MONTHS);

  if (lockedIdx === -1) {
    // Chưa từng có mốc khoá -> khoá ngay theo hạng hiện tại, không có gì để "lên/xuống" so sánh.
    return { tier: rawTier, isUpgrade: false, needsLockUpdate: true, newLockedName: rawTier.name, newLockedAtIso: now.toISOString() };
  }
  if (rawIdx > lockedIdx) {
    // Lên hạng thật -> khoá lại theo hạng mới, đồng hồ 12 tháng chạy lại từ đầu.
    return { tier: rawTier, isUpgrade: true, needsLockUpdate: true, newLockedName: rawTier.name, newLockedAtIso: now.toISOString() };
  }
  if (rawIdx < lockedIdx) {
    if (!lockExpired) {
      // Còn trong 12 tháng bảo lưu -> giữ nguyên hạng đã khoá, KHÔNG tụt hạng.
      return { tier: TIERS[lockedIdx], isUpgrade: false, needsLockUpdate: false, newLockedName: lockedName, newLockedAtIso: lockedAtIso };
    }
    // Hết hạn bảo lưu -> tụt hạng thật theo đúng tổng học phí hiện tại, khoá lại mốc mới.
    return { tier: rawTier, isUpgrade: false, needsLockUpdate: true, newLockedName: rawTier.name, newLockedAtIso: now.toISOString() };
  }
  // Bằng nhau -> không đổi gì.
  return { tier: rawTier, isUpgrade: false, needsLockUpdate: false, newLockedName: lockedName, newLockedAtIso: lockedAtIso };
}

// Đọc hồ sơ (tierLockedName/tierLockedAt) + tổng học phí, áp dụng bảo lưu hạng, GHI LẠI mốc khoá
// nếu cần. Dùng ở member-data — nơi hạng hiển thị cho thành viên cần chính xác và có ghi bảng.
async function getEffectiveTierForMember(email, totalPaid) {
  const rawTier = getTierByTotal(totalPaid);
  const profilesTable = await getTableClient(PROFILES_TABLE);
  let lockedName = null, lockedAtIso = null;
  try {
    const p = await profilesTable.getEntity("profile", email);
    lockedName = p.tierLockedName || null;
    lockedAtIso = p.tierLockedAt || null;
  } catch (e) { /* chưa có hồ sơ hoặc chưa có mốc khoá -> coi như chưa có */ }

  const result = resolveEffectiveTier(rawTier, lockedName, lockedAtIso);
  if (result.needsLockUpdate) {
    try {
      await profilesTable.upsertEntity({
        partitionKey: "profile", rowKey: email,
        tierLockedName: result.newLockedName, tierLockedAt: result.newLockedAtIso
      }, "Merge");
    } catch (e) { /* best-effort, không chặn phản hồi chính */ }
  }
  return result; // { tier, isUpgrade, ... }
}

// Tiện ích CHỈ ĐỌC cho những nơi cần biết ngay hạng + điểm của 1 email (email hạng màu...) —
// không ghi lại mốc khoá, tránh tạo hồ sơ rác cho các email không phải thành viên thật sự.
async function getTierInfoForEmail(email) {
  const totalPaid = await getTotalTuitionPaid(email);
  const rawTier = getTierByTotal(totalPaid);
  let lockedName = null, lockedAtIso = null;
  try {
    const profilesTable = await getTableClient(PROFILES_TABLE);
    const p = await profilesTable.getEntity("profile", email);
    lockedName = p.tierLockedName || null;
    lockedAtIso = p.tierLockedAt || null;
  } catch (e) { /* không có hồ sơ -> dùng thẳng hạng tính từ tổng học phí */ }
  const { tier } = resolveEffectiveTier(rawTier, lockedName, lockedAtIso);
  return {
    totalPaid,
    tier,
    isVip: tierRank(tier.name) >= tierRank("Vàng"),
    points: calculatePoints(totalPaid, tier)
  };
}

module.exports = {
  TIERS,
  VIP_MIN_TOTAL,
  TIER_RETENTION_MONTHS,
  getTierByTotal,
  tierRank,
  isVipTotal,
  calculatePoints,
  describeEarnRate,
  getTotalTuitionPaid,
  getTierInfoForEmail,
  getEffectiveTierForMember,
  resolveEffectiveTier,
  getSpentPoints,
  adjustSpentPoints,
  getPointsBalance
};
