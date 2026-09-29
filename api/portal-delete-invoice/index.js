const { logFamilyEvent, enrollFromRegistration, pointsDeficit } = require("../_shared/linkage");
const { getTableClient } = require("../_shared/tableStorage");
const { requireAdmin } = require("../_shared/adminAuth");
const { logAdminActivity } = require("../_shared/activityLog");
const { recomputeTuitionPoints } = require("../_shared/memberTier");

const INVOICES_TABLE = "Invoices";

module.exports = async function (context, req) {
  context.res = { headers: { "Content-Type": "application/json" } };

  if (!(await requireAdmin(context, req, "invoices"))) return;

  const parentEmail = String((req.body && req.body.parentEmail) || "").trim().toLowerCase();
  const id = String((req.body && req.body.id) || "").trim();
  if (!parentEmail || !id) {
    context.res.status = 400;
    context.res.body = { success: false, message: "Thiếu thông tin." };
    return;
  }

  try {
    const invoicesTable = await getTableClient(INVOICES_TABLE);
    let linkedRemoved = false;
    try {
      const invoice = await invoicesTable.getEntity(parentEmail, id);
      // Hoá đơn đã thanh toán có 1 khoản học phí đi kèm (tạo lúc duyệt). Xoá hoá đơn mà giữ khoản đó
      // sẽ để lại tiền + điểm "mồ côi" không rõ nguồn -> xoá kèm và chốt lại điểm cho khớp.
      if (invoice.status === "paid") {
        const tuitionId = invoice.linkedTuitionPaymentId || `invoice-${id}`;
        try {
          const tuitionTable = await getTableClient("TuitionPayments");
          await tuitionTable.deleteEntity(parentEmail, tuitionId);
          linkedRemoved = true;
        } catch (e) { if (e.statusCode !== 404) throw e; }
      }
      await invoicesTable.deleteEntity(parentEmail, id);
      if (linkedRemoved) {
        await recomputeTuitionPoints(parentEmail);
        const d = await pointsDeficit(parentEmail);
        await logFamilyEvent(context, parentEmail, `Hoá đơn đã thanh toán bị xoá, khoản học phí đi kèm cũng được gỡ và điểm được tính lại${d > 0 ? `. Thành viên đang thiếu ${d.toLocaleString("vi-VN")} điểm.` : "."}`);
      }
      await logAdminActivity(req, "Xoá hoá đơn", `${parentEmail} - id: ${id}${linkedRemoved ? " (kèm khoản học phí đã thanh toán)" : ""}`);
    } catch (err) {
      if (err.statusCode === 404) {
        context.res.status = 404;
        context.res.body = { success: false, message: "Không tìm thấy hoá đơn này." };
        return;
      }
      throw err;
    }

    context.res.status = 200;
    context.res.body = { success: true, warning: linkedRemoved ? "Đã xoá hoá đơn và khoản học phí đã thanh toán đi kèm; điểm tích lũy đã được tính lại." : null };
  } catch (err) {
    context.log.error("Lỗi xoá hoá đơn:", err.message);
    context.res.status = 500;
    context.res.body = { success: false, message: "Đã có lỗi xảy ra, vui lòng thử lại sau." };
  }
};
