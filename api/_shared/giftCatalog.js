// Danh mục quà tặng — điều kiện đổi quà dựa trên TỔNG học phí đã đóng (không trừ dần, chỉ là mốc mở khoá)
const GIFT_CATALOG = [
  { id: "but-may", name: "Bút máy cao cấp", cost: 5000000, icon: "fa-pen-fancy" },
  { id: "vo-o-ly", name: "Bộ vở ô ly (10 quyển)", cost: 10000000, icon: "fa-book" },
  { id: "balo", name: "Balo học sinh", cost: 20000000, icon: "fa-bag-shopping" },
  { id: "buoi-hoc-mien-phi", name: "1 buổi học miễn phí", cost: 35000000, icon: "fa-chalkboard-user" },
  { id: "bo-dung-cu", name: "Bộ dụng cụ học tập cao cấp", cost: 50000000, icon: "fa-box-open" },
  { id: "khoa-hoc-mien-phi", name: "Miễn phí học phí 1 kỳ", cost: 80000000, icon: "fa-graduation-cap" }
];

function findGift(giftId) {
  return GIFT_CATALOG.find(g => g.id === giftId);
}

module.exports = { GIFT_CATALOG, findGift };
