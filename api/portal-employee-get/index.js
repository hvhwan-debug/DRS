const { getTableClient } = require("../_shared/tableStorage");
const { requireSuperAdmin } = require("../_shared/adminAuth");
const { getAttachmentSasUrl } = require("../_shared/blobStorage");

const EMPLOYEES_TABLE = "Employees";
const NOTES_TABLE = "EmployeeNotes";

module.exports = async function (context, req) {
  context.res = { headers: { "Content-Type": "application/json" } };
  if (!(await requireSuperAdmin(context, req))) return;

  const id = String((req.query && req.query.id) || "").trim();
  if (!id) {
    context.res.status = 400;
    context.res.body = { success: false, message: "Thiếu id hồ sơ." };
    return;
  }

  try {
    const table = await getTableClient(EMPLOYEES_TABLE);
    let e;
    try {
      e = await table.getEntity("employee", id);
    } catch (err) {
      if (err.statusCode === 404) {
        context.res.status = 404;
        context.res.body = { success: false, message: "Không tìm thấy hồ sơ nhân sự." };
        return;
      }
      throw err;
    }

    // Link xem tạm (15 phút) cho từng file đính kèm — không trả blobName thẳng ra ngoài.
    const fileUrl = async (blobName) => (blobName ? await getAttachmentSasUrl(blobName, 15).catch(() => null) : null);
    const [avatarUrl, cccdFrontUrl, cccdBackUrl, contractFileUrl] = await Promise.all([
      fileUrl(e.avatarBlobName), fileUrl(e.cccdFrontBlobName), fileUrl(e.cccdBackBlobName), fileUrl(e.contractFileBlobName)
    ]);

    const notesTable = await getTableClient(NOTES_TABLE);
    const notes = [];
    const it = notesTable.listEntities({ queryOptions: { filter: `PartitionKey eq '${id.replace(/'/g, "''")}'` } });
    for await (const n of it) {
      notes.push({ id: n.rowKey, note: n.note || "", type: n.type || "", author: n.author || "", at: n.at || "" });
    }
    notes.sort((a, b) => new Date(b.at) - new Date(a.at));

    context.res.status = 200;
    context.res.body = {
      success: true,
      employee: {
        id: e.rowKey,
        fullName: e.fullName || "",
        dob: e.dob || "",
        idNumber: e.idNumber || "",
        address: e.address || "",
        emergencyContactName: e.emergencyContactName || "",
        emergencyContactPhone: e.emergencyContactPhone || "",
        position: e.position || "",
        contractType: e.contractType || "",
        contractStart: e.contractStart || "",
        contractEnd: e.contractEnd || "",
        linkedAdminEmail: e.linkedAdminEmail || "",
        status: e.status || "active",
        avatarUrl, cccdFrontUrl, cccdBackUrl, contractFileUrl,
        hasAvatar: !!e.avatarBlobName, hasCccdFront: !!e.cccdFrontBlobName,
        hasCccdBack: !!e.cccdBackBlobName, hasContractFile: !!e.contractFileBlobName,
        createdAt: e.createdAt || "", updatedAt: e.updatedAt || ""
      },
      notes
    };
  } catch (err) {
    context.log.error("Lỗi tải hồ sơ nhân sự:", err.message);
    context.res.status = 500;
    context.res.body = { success: false, message: "Đã có lỗi xảy ra, vui lòng thử lại sau." };
  }
};
