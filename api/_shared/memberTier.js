const { getTableClient } = require("./tableStorage");

const TUITION_TABLE = "TuitionPayments";

// Nguồn dữ liệu hạng DUY NHẤT phía server — phải khớp với getMembershipTier()/TIER_PERKS
// trong thanh-vien-index.html (giao diện). Nếu sửa mốc hạng, sửa ở CẢ HAI nơi.
//
// earnRate quy định tốc độ tích điểm của mỗi hạng, quy đổi về "hệ số giá trị" (fraction of
// số tiền học phí), rồi 1 điểm = 1.000đ giá trị:
//   - mode 'x'   : hạng tính theo bội số điểm — 1x tương ứng hệ số 0.1% (0.001) giá trị/số tiền
//   - mode '%'   : hạng tính theo % hoàn điểm trực tiếp trên số tiền
// Theo yêu cầu: Thành viên 1x, Bạc 2x, Titanium 3x, Vàng 5%, Bạch Kim 10%.
// Thân Thiết và Kim Cương không được nêu cụ thể — tạm suy ra hợp lý (xem ghi chú cuối file).
const TIERS = [
  { name: "Thành Viên Mới", min: 0, icon: "fa-seedling", color: "#64748b", earnRate: { mode: "x", value: 1 } },
  { name: "Thân Thiết", min: 5000000, icon: "fa-heart", color: "#0284c7", earnRate: { mode: "x", value: 1 } },
  { name: "Bạc", min: 10000000, icon: "fa-medal", color: "#64748b", earnRate: { mode: "x", value: 2 } },
  { name: "Vàng", min: 15000000, icon: "fa-crown", color: "#c9a227", earnRate: { mode: "%", value: 5 } },
  { name: "Bạch Kim", min: 30000000, icon: "fa-award", color: "#94a3b8", earnRate: { mode: "%", value: 10 } },
  { name: "Titanium", min: 45000000, icon: "fa-shield-halved", color: "#5b7c99", earnRate: { mode: "x", value: 3 } },
  { name: "Kim Cương", min: 70000000, icon: "fa-gem", color: "#0369a1", earnRate: { mode: "%", value: 12 } }
];

// Hạng "VIP" (mở khoá giao diện riêng + hiển thị chữ VIP): từ hạng Vàng trở lên.
const VIP_MIN_TOTAL = 15000000;

function getTierByTotal(totalPaid) {
  let current = TIERS[0];
  for (const t of TIERS) {
    if (totalPaid >= t.min) current = t;
  }
  return current;
}

function isVipTotal(totalPaid) {
  return totalPaid >= VIP_MIN_TOTAL;
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

// Tiện ích cho những nơi cần biết ngay hạng + điểm của 1 email (email hạng màu, popup đổi hạng...)
async function getTierInfoForEmail(email) {
  const totalPaid = await getTotalTuitionPaid(email);
  const tier = getTierByTotal(totalPaid);
  return {
    totalPaid,
    tier,
    isVip: isVipTotal(totalPaid),
    points: calculatePoints(totalPaid, tier)
  };
}

module.exports = {
  TIERS,
  VIP_MIN_TOTAL,
  getTierByTotal,
  isVipTotal,
  calculatePoints,
  describeEarnRate,
  getTotalTuitionPaid,
  getTierInfoForEmail
};

// GHI CHÚ GIẢ ĐỊNH (vui lòng xác nhận lại nếu cần đổi):
// - "Thân Thiết" (giữa Thành Viên Mới và Bạc): giữ 1x như Thành Viên Mới, vì đề bài chỉ nêu "Thành viên: 1x".
// - "Kim Cương" (trên Bạch Kim): đặt 12% (cao hơn Bạch Kim 10%) vì đây là hạng cao nhất.
// - Titanium (3x) nằm TRÊN Vàng (5%) và Bạch Kim (10%) về mốc chi tiêu, nhưng lại có tỉ lệ quy đổi
//   điểm thấp hơn theo đúng số bạn cung cấp. Mình giữ nguyên đúng như yêu cầu, nhưng nếu đây là
//   nhầm lẫn thứ tự, chỉ cần sửa "earnRate" của Titanium trong mảng TIERS ở trên (ví dụ đổi thành
//   { mode: "%", value: 15 } để luôn tăng dần theo hạng).
