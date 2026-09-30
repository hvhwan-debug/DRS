const { getTableClient } = require("../_shared/tableStorage");
const { requireAdmin } = require("../_shared/adminAuth");

const TABLE = "NewsletterSubscribers";

// Người đăng ký nhận bản tin — tách hẳn khỏi Registrations vì đây không phải đơn cần duyệt, chỉ
// là danh sách email để gửi tin (dùng chung với Gửi Email Hàng Loạt). Dùng chung quyền
// "registrations" như tin nhắn Liên Hệ.
module.exports = async function (context, req) {
  context.res = { headers: { "Content-Type": "application/json" } };
  if (!(await requireAdmin(context, req, "registrations"))) return;

  try {
    const table = await getTableClient(TABLE);
    const subscribers = [];
    for await (const e of table.listEntities({ queryOptions: { filter: "PartitionKey eq 'sub'" } })) {
      subscribers.push({
        email: e.rowKey, name: e.name || "", status: e.status || "subscribed",
        subscribedAt: e.subscribedAt || null, unsubscribedAt: e.unsubscribedAt || ""
      });
    }
    subscribers.sort((a, b) => new Date(b.subscribedAt) - new Date(a.subscribedAt));
    const active = subscribers.filter(s => s.status === "subscribed").length;
    context.res.status = 200;
    context.res.body = { success: true, subscribers, active, total: subscribers.length };
  } catch (err) {
    context.log.error("Lỗi lấy danh sách bản tin:", err.message);
    context.res.status = 500;
    context.res.body = { success: false, message: "Đã có lỗi xảy ra, vui lòng thử lại sau." };
  }
};
