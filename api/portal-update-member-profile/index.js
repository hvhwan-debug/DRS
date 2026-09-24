const { getTableClient } = require("../_shared/tableStorage");
const { requireAdmin } = require("../_shared/adminAuth");

const PROFILES_TABLE = "MemberProfiles";

module.exports = async function (context, req) {
  context.res = { headers: { "Content-Type": "application/json" } };

  if (!(await requireAdmin(context, req))) return;

  const body = req.body || {};
  const email = String(body.email || "").trim().toLowerCase();
  if (!email) {
    context.res.status = 400;
    context.res.body = { success: false, message: "Thiếu email." };
    return;
  }

  const fullName = String(body.fullName || "").trim();
  const phone = String(body.phone || "").trim();
  const address = String(body.address || "").trim();
  let dob = String(body.dob || "").trim();

  if (dob) {
    const dobYear = Number(dob.slice(0, 4));
    const currentYear = new Date().getFullYear();
    if (isNaN(dobYear) || dobYear < 1920 || dobYear > currentYear) {
      dob = ""; // Bỏ qua giá trị năm sinh bất thường
    }
  }

  try {
    const profilesTable = await getTableClient(PROFILES_TABLE);
    await profilesTable.upsertEntity({
      partitionKey: "profile",
      rowKey: email,
      fullName,
      phone,
      address,
      dob,
      updatedAt: new Date().toISOString()
    }, "Merge");

    context.res.status = 200;
    context.res.body = { success: true };
  } catch (err) {
    context.log.error("Lỗi admin cập nhật hồ sơ thành viên:", err.message);
    context.res.status = 500;
    context.res.body = { success: false, message: "Đã có lỗi xảy ra, vui lòng thử lại sau." };
  }
};
