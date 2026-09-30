const { getTableClient } = require("../_shared/tableStorage");
const { requireAdmin } = require("../_shared/adminAuth");
const { redemptionPoints } = require("../_shared/memberTier");

// Thành viên đang THIẾU điểm: tổng điểm đã đổi quà (yêu cầu chưa huỷ) lớn hơn tổng điểm tích luỹ từ học phí.
// Thường xảy ra khi một khoản học phí bị xoá / sửa giảm sau khi phụ huynh đã đổi quà.
module.exports = async function (context, req) {
  context.res = { headers: { "Content-Type": "application/json" } };
  if (!(await requireAdmin(context, req))) return;
  try {
    const earned = {}, spent = {}, pending = {};
    for await (const t of (await getTableClient("TuitionPayments")).listEntities()) earned[t.partitionKey] = (earned[t.partitionKey] || 0) + (Number(t.pointsEarned) || 0);
    for await (const r of (await getTableClient("GiftRedemptions")).listEntities()) {
      const p = redemptionPoints(r); spent[r.partitionKey] = (spent[r.partitionKey] || 0) + p;
      if (p > 0 && ["pending", "shipping"].includes(r.status)) (pending[r.partitionKey] = pending[r.partitionKey] || []).push({ id: r.rowKey, giftName: r.giftName || "", points: p, status: r.status });
    }
    const names = {};
    try { for await (const p of (await getTableClient("MemberProfiles")).listEntities({ queryOptions: { select: ["rowKey", "fullName"] } })) names[String(p.rowKey).toLowerCase()] = p.fullName || ""; } catch (e) {}
    const list = Object.keys(spent).filter(e => spent[e] > (earned[e] || 0)).map(e => ({
      email: e, name: names[e] || "", earned: earned[e] || 0, spent: spent[e], deficit: spent[e] - (earned[e] || 0), openRedemptions: pending[e] || []
    })).sort((a, b) => b.deficit - a.deficit);
    context.res.status = 200; context.res.body = { success: true, deficits: list };
  } catch (err) {
    context.log.error("Lỗi tra điểm thiếu:", err.message);
    context.res.status = 500; context.res.body = { success: false, message: "Đã có lỗi xảy ra." };
  }
};
