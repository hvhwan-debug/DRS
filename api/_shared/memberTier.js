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

// Điểm tích lũy của MỖI khoản học phí được "chốt" ngay tại thời điểm đóng, theo đúng hạng tại thời
// điểm đó (tính lũy kế theo thứ tự thời gian) — rồi lưu vào field pointsEarned trên chính bản ghi
// TuitionPayments đó. Đây là cách làm ĐÚNG: điểm đã có không được phép "co lại" mỗi khi hạng hiện
// tại thay đổi sau này (vd. do sửa/xoá 1 khoản khác khiến hạng tụt) — nếu không, thành viên đã thật
// sự đóng tiền và đã dùng điểm đổi quà sẽ bỗng dưng bị âm/về 0 điểm dù không hề mất tiền đã đóng.
// Gọi lại hàm này mỗi khi có khoản học phí được THÊM/SỬA/XOÁ, để chốt lại đúng theo đúng thứ tự
// thời gian còn lại (một thay đổi có thể làm dịch chuyển mốc hạng của các khoản đóng SAU nó).
async function recomputeTuitionPoints(email) {
  const tuitionTable = await getTableClient(TUITION_TABLE);
  const entities = [];
  const iterator = tuitionTable.listEntities({
    queryOptions: { filter: `PartitionKey eq '${email.replace(/'/g, "''")}'` }
  });
  for await (const e of iterator) entities.push(e);
  entities.sort((a, b) => new Date(a.paidAt) - new Date(b.paidAt));

  let runningTotal = 0;
  let totalPoints = 0;
  for (const e of entities) {
    const amount = Number(e.amount) || 0;
    runningTotal += amount;
    const tierAtThatTime = getTierByTotal(runningTotal);
    const pts = calculatePoints(amount, tierAtThatTime);
    totalPoints += pts;
    if (Number(e.pointsEarned) !== pts) {
      try {
        await tuitionTable.updateEntity({ partitionKey: e.partitionKey, rowKey: e.rowKey, pointsEarned: pts }, "Merge");
      } catch (err) { /* best-effort — 1 bản ghi lỗi không chặn các bản ghi còn lại */ }
    }
  }
  return totalPoints;
}

// Tổng điểm đã tích lũy = tổng field pointsEarned đã chốt sẵn trên từng khoản học phí (xem
// recomputeTuitionPoints ở trên) — KHÔNG tính lại theo "tổng học phí × hạng hiện tại", vì cách đó
// khiến điểm của các khoản cũ bị tính lại sai mỗi khi hạng hiện tại thay đổi.
async function getEarnedPointsSum(email) {
  const tuitionTable = await getTableClient(TUITION_TABLE);
  let sum = 0;
  const iterator = tuitionTable.listEntities({
    queryOptions: { filter: `PartitionKey eq '${email.replace(/'/g, "''")}'` }
  });
  for await (const e of iterator) sum += Number(e.pointsEarned) || 0;
  return sum;
}

// Điểm tích lũy KHẢ DỤNG để đổi quà = điểm đã tích lũy (tính từ tổng học phí) - điểm đã dùng.
// Đây là nguồn điểm DUY NHẤT dùng để đổi quà — quà tặng đổi bằng ĐIỂM, không phải mốc học phí,
// và có thể đổi nhiều lần miễn đủ điểm (không giới hạn "mỗi hạng chỉ đổi 1 lần").
async function getPointsBalance(email) {
  const totalPaid = await getTotalTuitionPaid(email);
  const tier = getTierByTotal(totalPaid);
  const earned = await getEarnedPointsSum(email);
  const spent = await getSpentPoints(email);
  const available = Math.max(0, earned - spent);
  return { earned, spent, available, tier, totalPaid };
}

// Tổng học phí đã đóng TRỌN ĐỜI của 1 email — chỉ dùng cho báo cáo tài chính (Tổng Quan, Công Nợ...),
// KHÔNG dùng để tính hạng nữa (xem getTotalTuitionPaidRolling12Months bên dưới).
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

// HẠNG THÀNH VIÊN tính theo chu kỳ TRƯỢT 12 THÁNG GẦN NHẤT (rolling window) dựa trên chi phí/chi
// tiêu thực tế trong giai đoạn đó — KHÔNG dùng tổng học phí trọn đời + cơ chế khoá/bảo lưu thủ công
// như trước. Một khoản học phí chỉ còn tính vào hạng trong đúng 12 tháng kể từ ngày đóng; quá 12
// tháng, khoản đó tự "hết hạn" khỏi phép tính hạng — đúng tinh thần "đạt và duy trì trong 12 tháng
// rồi tự reset" mà không cần lưu trạng thái khoá riêng (nên không thể bị kẹt/sai lệch như trước).
// LƯU Ý: Điểm tích lũy để ĐỔI QUÀ (getPointsBalance/getEarnedPointsSum) là một khoản HOÀN TOÀN
// RIÊNG, cộng dồn trọn đời theo từng khoản đã chốt — việc lên/xuống hạng hay việc đổi quà không
// làm ảnh hưởng lẫn nhau.
async function getTotalTuitionPaidRolling12Months(email) {
  const tuitionTable = await getTableClient(TUITION_TABLE);
  const cutoff = addMonths(new Date(), -TIER_RETENTION_MONTHS);
  let total = 0;
  const iterator = tuitionTable.listEntities({
    queryOptions: { filter: `PartitionKey eq '${email.replace(/'/g, "''")}'` }
  });
  for await (const entity of iterator) {
    const paidAt = entity.paidAt ? new Date(entity.paidAt) : null;
    if (paidAt && paidAt >= cutoff) total += Number(entity.amount) || 0;
  }
  return total;
}

// GIỮ LẠI để tương thích ngược — không còn được gọi trong luồng hạng chính nữa (xem
// getEffectiveTierForMember/getTierInfoForEmail bên dưới, giờ dùng chu kỳ trượt 12 tháng).
function resolveEffectiveTier(rawTier, lockedName, lockedAtIso) {
  const rawIdx = tierRank(rawTier.name);
  const lockedIdx = lockedName ? tierRank(lockedName) : -1;
  const lockedAt = lockedAtIso ? new Date(lockedAtIso) : null;
  const now = new Date();
  const lockExpired = !lockedAt || now >= addMonths(lockedAt, TIER_RETENTION_MONTHS);

  if (lockedIdx === -1) {
    return { tier: rawTier, isUpgrade: false, needsLockUpdate: true, newLockedName: rawTier.name, newLockedAtIso: now.toISOString() };
  }
  if (rawIdx > lockedIdx) {
    return { tier: rawTier, isUpgrade: true, needsLockUpdate: true, newLockedName: rawTier.name, newLockedAtIso: now.toISOString() };
  }
  if (rawIdx < lockedIdx) {
    if (!lockExpired) {
      return { tier: TIERS[lockedIdx], isUpgrade: false, needsLockUpdate: false, newLockedName: lockedName, newLockedAtIso: lockedAtIso };
    }
    return { tier: rawTier, isUpgrade: false, needsLockUpdate: true, newLockedName: rawTier.name, newLockedAtIso: now.toISOString() };
  }
  return { tier: rawTier, isUpgrade: false, needsLockUpdate: false, newLockedName: lockedName, newLockedAtIso: lockedAtIso };
}

// Hạng hiệu lực của 1 thành viên — tính SỐNG theo tổng học phí trong 12 THÁNG GẦN NHẤT, đúng ngay
// lập tức mỗi lần gọi, không cần đọc/ghi mốc khoá nào cả (đã bỏ hẳn cơ chế khoá thủ công cũ).
// Dùng ở member-data — nơi hạng hiển thị cho thành viên cần chính xác.
async function getEffectiveTierForMember(email) {
  const totalPaid12mo = await getTotalTuitionPaidRolling12Months(email);
  const tier = getTierByTotal(totalPaid12mo);
  return { tier, totalPaid12mo };
}

// Tiện ích CHỈ ĐỌC cho những nơi cần biết ngay hạng của 1 email (email hạng màu...) — cũng tính
// theo chu kỳ trượt 12 tháng, đồng bộ tuyệt đối với hạng hiển thị cho thành viên ở member-data.
async function getTierInfoForEmail(email) {
  const totalPaid12mo = await getTotalTuitionPaidRolling12Months(email);
  const tier = getTierByTotal(totalPaid12mo);
  const points = await getEarnedPointsSum(email);
  return {
    totalPaid: totalPaid12mo,
    tier,
    isVip: tierRank(tier.name) >= tierRank("Vàng"),
    points
  };
}

// Đã bỏ cơ chế khoá hạng thủ công (xem ghi chú ở getEffectiveTierForMember/getTierInfoForEmail) —
// giữ hàm này lại dưới dạng NO-OP để không phải sửa các API đang gọi nó (portal-edit-tuition,
// portal-delete-tuition, portal-recalculate-tier, portal-recalculate-all-tiers); các trường
// tierLockedName/tierLockedAt cũ (nếu còn sót từ trước) không còn được đọc ở đâu nữa nên vô hại.
async function resetTierLock(email) {
  try {
    const profilesTable = await getTableClient(PROFILES_TABLE);
    await profilesTable.upsertEntity({ partitionKey: "profile", rowKey: email, tierLockedName: "", tierLockedAt: "" }, "Merge");
  } catch (e) { /* best-effort — không chặn phản hồi chính của API gọi hàm này */ }
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
  getTotalTuitionPaidRolling12Months,
  getTierInfoForEmail,
  getEffectiveTierForMember,
  resolveEffectiveTier,
  resetTierLock,
  getSpentPoints,
  adjustSpentPoints,
  getPointsBalance,
  recomputeTuitionPoints,
  getEarnedPointsSum
};
