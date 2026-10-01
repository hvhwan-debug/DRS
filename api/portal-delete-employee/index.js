const { getTableClient } = require("../_shared/tableStorage");
const { requireSuperAdmin } = require("../_shared/adminAuth");
const { logAdminActivity } = require("../_shared/activityLog");
const { deleteBlob } = require("../_shared/blobStorage");

const EMPLOYEES_TABLE = "Employees";
const NOTES_TABLE = "EmployeeNotes";

module.exports = async function (context, req) {
  context.res = { headers: { "Content-Type": "application/json" } };
  if (!(await requireSuperAdmin(context, req))) return;

  const id = String((req.body && req.body.id) || "").trim();
  if (!id) {
    context.res.status = 400;
    context.res.body = { success: false, message: "Thiếu id hồ sơ." };
    return;
  }

  try {
    const table = await getTableClient(EMPLOYEES_TABLE);
    let e = null;
    try { e = await table.getEntity("employee", id); } catch (err) { if (err.statusCode !== 404) throw err; }

    if (e) {
      await Promise.all(
        [e.avatarBlobName, e.cccdFrontBlobName, e.cccdBackBlobName, e.contractFileBlobName]
          .filter(Boolean).map(deleteBlob)
      );
      await table.deleteEntity("employee", id);
    }

    const notesTable = await getTableClient(NOTES_TABLE);
    const toDelete = [];
    const it = notesTable.listEntities({ queryOptions: { filter: `PartitionKey eq '${id.replace(/'/g, "''")}'` } });
    for await (const n of it) toDelete.push(n.rowKey);
    await Promise.all(toDelete.map(rk => notesTable.deleteEntity(id, rk).catch(() => {})));

    await logAdminActivity(req, "Xoá hồ sơ nhân sự", e ? e.fullName : id);
    context.res.status = 200;
    context.res.body = { success: true };
  } catch (err) {
    context.log.error("Lỗi xoá hồ sơ nhân sự:", err.message);
    context.res.status = 500;
    context.res.body = { success: false, message: "Đã có lỗi xảy ra, vui lòng thử lại sau." };
  }
};
