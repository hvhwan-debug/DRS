const { getTableClient } = require("../_shared/tableStorage");
const { requireAdmin } = require("../_shared/adminAuth");
const { logAdminActivity } = require("../_shared/activityLog");

const TABLE = "NewsletterSubscribers";

module.exports = async function (context, req) {
  context.res = { headers: { "Content-Type": "application/json" } };
  if (!(await requireAdmin(context, req, "registrations"))) return;

  const b = req.body || {};
  const email = String(b.email || "").trim().toLowerCase();
  const subscribe = b.subscribe === true;
  if (!email) { context.res.status = 400; context.res.body = { success: false, message: "Thiếu email." }; return; }

  try {
    const table = await getTableClient(TABLE);
    const now = new Date().toISOString();
    await table.upsertEntity({
      partitionKey: "sub", rowKey: email,
      status: subscribe ? "subscribed" : "unsubscribed",
      unsubscribedAt: subscribe ? "" : now
    }, "Merge");
    await logAdminActivity(req, subscribe ? "Bản tin: đăng ký lại" : "Bản tin: huỷ đăng ký (thủ công)", email);
    context.res.status = 200;
    context.res.body = { success: true };
  } catch (err) {
    context.log.error("Lỗi cập nhật đăng ký bản tin:", err.message);
    context.res.status = 500;
    context.res.body = { success: false, message: "Đã có lỗi xảy ra, vui lòng thử lại sau." };
  }
};
