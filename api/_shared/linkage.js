// ============================================================================================
// LIÊN KẾT NGHIỆP VỤ giữa Trang chủ → Thành viên → Quản trị → Email → CRM → Công Việc.
// Mọi sự kiện quan trọng của một gia đình (đơn đăng ký, học phí, hoá đơn, điểm, đổi quà, xin nghỉ)
// được ghi thêm vào LỊCH SỬ CHĂM SÓC CRM của từng con, để nhân viên chăm sóc luôn thấy toàn cảnh.
// Tất cả hàm ở đây "best-effort": lỗi phụ không bao giờ làm hỏng thao tác chính.
// ============================================================================================
const { getTableClient } = require("./tableStorage");
const { norm, childKey } = require("./parentDirectory");
const { CRM_TABLE, CRM_PARTITION, INTERACTIONS_TABLE, leadIdFor } = require("./crm");

const q = s => String(s || "").replace(/'/g, "''");
const PROGRAM_BY_FORM = { luyen_chu_phu_huynh: "Luyện Chữ Đẹp", tien_tieu_hoc: "Tiền Tiểu Học" };

async function studentsOf(email) {
  const out = [];
  try {
    const t = await getTableClient("Students");
    for await (const s of t.listEntities({ queryOptions: { filter: `PartitionKey eq '${q(String(email).toLowerCase())}'` } })) out.push(s);
  } catch (e) {}
  return out;
}

// Ghi 1 dòng vào lịch sử chăm sóc CRM. studentName (nếu có) -> chỉ ghi cho đúng con đó; không có -> mọi con.
async function logFamilyEvent(context, email, content, opts) {
  try {
    const o = opts || {};
    let kids = await studentsOf(email);
    if (o.studentName) {
      const n = norm(o.studentName);
      const hit = kids.filter(k => norm(k.studentName) === n);
      kids = hit.length ? hit : kids;
    }
    const ids = kids.map(k => k.rowKey);
    if (!ids.length && o.studentName) ids.push(leadIdFor(childKey(email, o.studentName))); // khách tiềm năng
    if (!ids.length) return;
    const t = await getTableClient(INTERACTIONS_TABLE);
    const now = new Date().toISOString();
    for (const id of ids) {
      await t.createEntity({ partitionKey: id, rowKey: `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`, type: o.type || "khac",
        content: String(content).slice(0, 500), outcome: "", happenedAt: now, createdBy: o.by || "Hệ thống", createdAt: now, auto: true });
    }
  } catch (e) { if (context && context.log) context.log.warn("CRM: không ghi được sự kiện gia đình:", e.message); }
}

// Đơn đăng ký chương trình học được DUYỆT -> tự tạo học sinh (nếu chưa có) và chuyển CRM sang "Đang học",
// giữ nguyên hồ sơ & lịch sử chăm sóc khi còn là khách tiềm năng.
async function enrollFromRegistration(context, reg, byName) {
  const program = PROGRAM_BY_FORM[reg.formType];
  if (!program) return null;
  let data = {}; try { data = JSON.parse(reg.dataJson || "{}"); } catch (e) {}
  const childName = String(data.ten_tre || data.hoc_sinh || "").trim();
  const email = String(data.email_phu_huynh || data.email || reg.partitionKey || "").trim().toLowerCase();
  if (!childName || !email) return null;
  const students = await getTableClient("Students");
  const existing = (await studentsOf(email)).find(s => norm(s.studentName) === norm(childName));
  let id, created = false;
  if (existing) {
    id = existing.rowKey;
    let progs = []; try { progs = JSON.parse(existing.programsJson || "[]"); } catch (e) {}
    if (!progs.includes(program)) { progs.push(program); await students.updateEntity({ partitionKey: email, rowKey: id, programsJson: JSON.stringify(progs), program: existing.program || program }, "Merge"); }
  } else {
    id = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    await students.createEntity({ partitionKey: email, rowKey: id, studentName: childName, dob: String(data.ngay_sinh_tre || ""), program, programsJson: JSON.stringify([program]),
      note: "Tự tạo khi duyệt đơn đăng ký", enrolledAt: new Date().toISOString() });
    created = true;
  }
  // CRM: nối hồ sơ tiềm năng (nếu có) và chuyển giai đoạn "Đang học"
  try {
    const crm = await getTableClient(CRM_TABLE);
    let prof = null; try { prof = await crm.getEntity(CRM_PARTITION, id); } catch (e) {}
    if (!prof) { try { prof = await crm.getEntity(CRM_PARTITION, leadIdFor(childKey(email, childName))); } catch (e) {} }
    let hist = []; try { hist = JSON.parse((prof && prof.stageHistoryJson) || "[]"); } catch (e) {}
    const now = new Date().toISOString();
    const from = (prof && prof.stage) || "tiem-nang";
    if (from !== "dang-hoc") hist.push({ from, to: "dang-hoc", at: now, by: byName || "Hệ thống", reason: "Đơn đăng ký được duyệt" });
    const copy = prof ? Object.fromEntries(Object.entries(prof).filter(([k]) => !["partitionKey", "rowKey", "etag", "timestamp", "odata.etag"].includes(k))) : {};
    await crm.upsertEntity({ ...copy, partitionKey: CRM_PARTITION, rowKey: id, stage: "dang-hoc", source: copy.source || "Website",
      stageHistoryJson: JSON.stringify(hist.slice(-60)), stageChangedAt: now, stageReason: "", updatedAt: now, updatedBy: byName || "Hệ thống" }, "Replace");
    // chuyển lịch sử chăm sóc của khách tiềm năng sang học sinh chính thức
    const leadId = leadIdFor(childKey(email, childName));
    const it = await getTableClient(INTERACTIONS_TABLE);
    for await (const r of it.listEntities({ queryOptions: { filter: `PartitionKey eq '${q(leadId)}'` } })) {
      const { partitionKey, rowKey, etag, timestamp, ...rest } = r;
      await it.upsertEntity({ ...rest, partitionKey: id, rowKey }, "Replace");
      await it.deleteEntity(leadId, rowKey);
    }
  } catch (e) { if (context && context.log) context.log.warn("CRM: không chuyển được hồ sơ tiềm năng:", e.message); }
  return { id, created, childName, program, email };
}

// Điểm thiếu (đã dùng nhiều hơn đã tích) của một thành viên — dùng để chặn trao quà & báo Công Việc
async function pointsDeficit(email) {
  try {
    const { getPointsBalance } = require("./memberTier");
    const b = await getPointsBalance(email);
    return Math.max(0, b.spent - b.earned);
  } catch (e) { return 0; }
}

module.exports = { logFamilyEvent, enrollFromRegistration, pointsDeficit, PROGRAM_BY_FORM, studentsOf };
