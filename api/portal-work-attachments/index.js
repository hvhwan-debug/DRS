const { logAdminActivity } = require("../_shared/activityLog");
const { getTableClient } = require("../_shared/tableStorage");
const { requireAdmin, getAdminIdentity } = require("../_shared/adminAuth");
const { uploadAttachments, getAttachmentSasUrl, deleteBlob } = require("../_shared/blobStorage");
const W = require("../_shared/work");

// Tệp đính kèm của công việc (lưu riêng tư trên Blob Storage, xem qua link tạm 60 phút)
//   GET  ?taskId=          -> danh sách kèm link xem
//   POST { taskId, files: [{ filename, type, content(base64) }] } -> tải lên (tối đa 5 tệp, mỗi tệp ≤ 8MB)
//   POST { taskId, remove: blobName } -> xoá 1 tệp
const MAX_FILES = 20, MAX_BYTES = 8 * 1024 * 1024;
module.exports = async function (context, req) {
  context.res = { headers: { "Content-Type": "application/json" } };
  if (!(await requireAdmin(context, req))) return;
  const b = req.body || {};
  const taskId = String((req.query && req.query.taskId) || b.taskId || "");
  if (!W.isId(taskId)) { context.res.status = 400; context.res.body = { success: false, message: "Thiếu mã công việc." }; return; }
  try {
    const table = await getTableClient(W.TASKS_TABLE);
    let e; try { e = await table.getEntity("task", taskId); } catch (err) { context.res.status = 404; context.res.body = { success: false, message: "Công việc không còn tồn tại." }; return; }
    let list = W.parseJson(e.attachmentsJson, []);
    const withUrls = async l => Promise.all(l.map(async a => ({ name: a.name, type: a.type, size: a.size, blob: a.blob, at: a.at, by: a.by, url: await getAttachmentSasUrl(a.blob, 60).catch(() => null) })));
    if ((req.method || "GET").toUpperCase() === "GET") { context.res.status = 200; context.res.body = { success: true, attachments: await withUrls(list) }; return; }

    const who = (await getAdminIdentity(req)) || {};
    const now = new Date().toISOString();
    let history = W.parseJson(e.historyJson, []).slice(-29);
    if (b.remove) {
      const hit = list.find(a => a.blob === b.remove);
      if (!hit) { context.res.status = 404; context.res.body = { success: false, message: "Không tìm thấy tệp." }; return; }
      list = list.filter(a => a.blob !== b.remove);
      await deleteBlob(hit.blob).catch(() => {});
      history.push({ at: now, by: who.displayName || who.email, text: `Xoá tệp "${hit.name}"` });
    } else {
      const files = Array.isArray(b.files) ? b.files.slice(0, 5) : [];
      if (!files.length) { context.res.status = 400; context.res.body = { success: false, message: "Chưa chọn tệp." }; return; }
      if (list.length + files.length > MAX_FILES) { context.res.status = 400; context.res.body = { success: false, message: `Mỗi việc chỉ đính kèm tối đa ${MAX_FILES} tệp.` }; return; }
      for (const f of files) {
        const bytes = Math.floor(String(f.content || "").length * 3 / 4);
        if (bytes > MAX_BYTES) { context.res.status = 400; context.res.body = { success: false, message: `Tệp "${f.filename}" lớn hơn 8MB.` }; return; }
        f._size = bytes;
      }
      const up = await uploadAttachments(files.map(f => ({ filename: String(f.filename || "tep").slice(0, 120), type: f.type, content: f.content })));
      up.forEach((u, i) => list.push({ name: u.filename, blob: u.blobName, type: files[i].type || "", size: files[i]._size, at: now, by: who.displayName || who.email }));
      history.push({ at: now, by: who.displayName || who.email, text: `Đính kèm ${up.length} tệp` });
    }
    await table.updateEntity({ partitionKey: "task", rowKey: taskId, attachmentsJson: JSON.stringify(list), historyJson: JSON.stringify(history), updatedAt: now }, "Merge");
    await logAdminActivity(req, "Công việc: tệp đính kèm", `việc ${taskId}: ${b.remove ? "xoá 1 tệp" : "thêm tệp"}`);
    context.res.status = 200; context.res.body = { success: true, attachments: await withUrls(list), history };
  } catch (err) {
    context.log.error("Lỗi tệp đính kèm:", err.message);
    context.res.status = 500; context.res.body = { success: false, message: "Đã có lỗi xảy ra, vui lòng thử lại sau." };
  }
};
