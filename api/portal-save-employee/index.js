const { getTableClient } = require("../_shared/tableStorage");
const { requireSuperAdmin, getAdminIdentity } = require("../_shared/adminAuth");
const { logAdminActivity } = require("../_shared/activityLog");

const EMPLOYEES_TABLE = "Employees";
const NOTES_TABLE = "EmployeeNotes";

function genId() {
  return `emp-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const STATUS_LABEL = { active: "Đang làm việc", inactive: "Đã nghỉ việc" };
const dmy = d => (d ? String(d).slice(0, 10).split("-").reverse().join("/") : "(trống)");

// Những thay đổi quan trọng được tự ghi vào "Lịch sử công tác" để về sau tra cứu được ai đổi gì, khi nào.
const TRACKED = [
  ["position", "Vị trí", v => v || "(trống)"],
  ["contractType", "Loại hợp đồng", v => v || "(chưa có)"],
  ["contractStart", "Bắt đầu HĐ", dmy],
  ["contractEnd", "Kết thúc HĐ", dmy],
  ["status", "Trạng thái", v => STATUS_LABEL[v] || v],
  ["linkedAdminEmail", "Tài khoản chấm công", v => v || "(không liên kết)"]
];

function bad(context, status, message) {
  context.res.status = status;
  context.res.body = { success: false, message };
}

// Tạo mới (không có id) hoặc cập nhật hồ sơ nhân sự.
//  - partial: true  => chỉ cập nhật các trường được gửi lên (dùng cho thao tác nhanh như đánh dấu nghỉ việc),
//    tránh việc gửi thiếu trường làm xoá trắng dữ liệu khác.
//  - Kiểm tra logic: ngày kết thúc không trước ngày bắt đầu; HĐ không xác định thời hạn thì không có ngày kết thúc;
//    một tài khoản chấm công chỉ liên kết với MỘT hồ sơ.
module.exports = async function (context, req) {
  context.res = { headers: { "Content-Type": "application/json" } };
  if (!(await requireSuperAdmin(context, req))) return;

  const body = req.body || {};
  const isNew = !body.id;
  const partial = body.partial === true && !isNew;
  const has = k => Object.prototype.hasOwnProperty.call(body, k);
  const str = k => String(body[k] == null ? "" : body[k]).trim();

  if ((!partial || has("fullName")) && !str("fullName")) return bad(context, 400, "Thiếu họ tên nhân sự.");

  const id = str("id") || genId();
  const fields = {};
  const set = (k, v) => { if (!partial || has(k)) fields[k] = v; };
  set("fullName", str("fullName"));
  set("dob", str("dob").slice(0, 10));
  set("idNumber", str("idNumber"));
  set("address", str("address"));
  set("emergencyContactName", str("emergencyContactName"));
  set("emergencyContactPhone", str("emergencyContactPhone"));
  set("position", str("position"));
  set("contractType", str("contractType"));
  set("contractStart", str("contractStart").slice(0, 10));
  set("contractEnd", str("contractEnd").slice(0, 10));
  set("linkedAdminEmail", str("linkedAdminEmail").toLowerCase());
  set("status", str("status") === "inactive" ? "inactive" : "active");

  for (const k of ["dob", "contractStart", "contractEnd"]) {
    if (fields[k] && !DATE_RE.test(fields[k])) return bad(context, 400, "Ngày không hợp lệ, vui lòng chọn lại.");
  }
  if (fields.linkedAdminEmail && !EMAIL_RE.test(fields.linkedAdminEmail)) return bad(context, 400, "Email tài khoản liên kết không hợp lệ.");

  try {
    const table = await getTableClient(EMPLOYEES_TABLE);
    const now = new Date().toISOString();
    let existing = null;
    if (!isNew) {
      try { existing = await table.getEntity("employee", id); } catch (e) { if (e.statusCode !== 404) throw e; }
      if (partial && !existing) return bad(context, 404, "Hồ sơ này không còn tồn tại.");
    }
    const eff = k => (k in fields ? fields[k] : (existing && existing[k]) || "");

    if (eff("contractType") === "Không xác định thời hạn") fields.contractEnd = "";
    const start = eff("contractStart").slice(0, 10), end = eff("contractEnd").slice(0, 10);
    if (start && end && end < start) return bad(context, 400, "Ngày kết thúc hợp đồng phải sau ngày bắt đầu.");

    if (fields.linkedAdminEmail && (!existing || fields.linkedAdminEmail !== String(existing.linkedAdminEmail || "").toLowerCase())) {
      const q = fields.linkedAdminEmail.replace(/'/g, "''");
      for await (const o of table.listEntities({ queryOptions: { filter: `PartitionKey eq 'employee' and linkedAdminEmail eq '${q}'` } })) {
        if (o.rowKey !== id) return bad(context, 409, `Tài khoản này đã được liên kết với hồ sơ "${o.fullName || o.rowKey}". Mỗi tài khoản chỉ gắn với một nhân sự.`);
      }
    }

    const createdAt = (existing && existing.createdAt) || now;
    await table.upsertEntity({
      partitionKey: "employee", rowKey: id, ...fields, createdAt, updatedAt: now, updatedBy: "admin"
    }, "Merge");

    // Tự ghi lịch sử công tác khi có thay đổi quan trọng (hoặc khi tạo mới)
    const identity = await getAdminIdentity(req);
    let noteText = "";
    if (isNew) noteText = "Tạo hồ sơ nhân sự";
    else if (existing) {
      const diffs = TRACKED.filter(([k]) => k in fields && String(existing[k] || "") !== String(fields[k] || ""))
        .map(([k, label, f]) => `${label}: ${f(existing[k] || "")} → ${f(fields[k])}`);
      if (diffs.length) noteText = "Cập nhật — " + diffs.join("; ");
    }
    if (noteText) {
      const notesTable = await getTableClient(NOTES_TABLE);
      await notesTable.createEntity({
        partitionKey: id, rowKey: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
        note: noteText, type: "system", author: identity ? identity.displayName : "", at: now
      });
    }

    await logAdminActivity(req, isNew ? "Tạo hồ sơ nhân sự" : "Sửa hồ sơ nhân sự", `${eff("fullName")} (${id})`);

    context.res.status = 200;
    context.res.body = { success: true, id, message: isNew ? "Đã tạo hồ sơ nhân sự." : "Đã lưu thay đổi." };
  } catch (err) {
    context.log.error("Lỗi lưu hồ sơ nhân sự:", err.message);
    bad(context, 500, "Đã có lỗi xảy ra, vui lòng thử lại sau.");
  }
};
