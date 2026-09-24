const { getTableClient } = require("../_shared/tableStorage");
const { requireAdmin } = require("../_shared/adminAuth");

const MEMBERS_TABLE = "Members";

module.exports = async function (context, req) {
  context.res = { headers: { "Content-Type": "application/json" } };

  if (!(await requireAdmin(context, req))) return;

  try {
    const membersTable = await getTableClient(MEMBERS_TABLE);
    const members = [];
    for await (const entity of membersTable.listEntities()) {
      members.push({
        email: entity.rowKey,
        isBlocked: !!entity.isBlocked,
        createdAt: entity.createdAt || entity.updatedAt || null,
        updatedAt: entity.updatedAt || null
      });
    }
    members.sort((a, b) => new Date(b.updatedAt || 0) - new Date(a.updatedAt || 0));

    context.res.status = 200;
    context.res.body = { success: true, members };
  } catch (err) {
    context.log.error("Lỗi lấy danh sách thành viên:", err.message);
    context.res.status = 500;
    context.res.body = { success: false, message: "Đã có lỗi xảy ra, vui lòng thử lại sau." };
  }
};
