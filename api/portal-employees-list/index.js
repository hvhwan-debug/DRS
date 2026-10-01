const { getTableClient } = require("../_shared/tableStorage");
const { requireSuperAdmin } = require("../_shared/adminAuth");

const EMPLOYEES_TABLE = "Employees";

module.exports = async function (context, req) {
  context.res = { headers: { "Content-Type": "application/json" } };
  if (!(await requireSuperAdmin(context, req))) return;

  try {
    const table = await getTableClient(EMPLOYEES_TABLE);
    const employees = [];
    const it = table.listEntities({ queryOptions: { filter: "PartitionKey eq 'employee'" } });
    for await (const e of it) {
      employees.push({
        id: e.rowKey,
        fullName: e.fullName || "",
        position: e.position || "",
        contractType: e.contractType || "",
        contractStart: e.contractStart || "",
        contractEnd: e.contractEnd || "",
        status: e.status || "active",
        hasAvatar: !!e.avatarBlobName,
        updatedAt: e.updatedAt || e.createdAt || ""
      });
    }
    employees.sort((a, b) => (a.fullName || "").localeCompare(b.fullName || "", "vi"));
    context.res.status = 200;
    context.res.body = { success: true, employees };
  } catch (err) {
    context.log.error("Lỗi tải danh sách hồ sơ nhân sự:", err.message);
    context.res.status = 500;
    context.res.body = { success: false, message: "Đã có lỗi xảy ra, vui lòng thử lại sau." };
  }
};
