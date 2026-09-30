// =====================================================================================
// Chấm công & tính lương nhân viên — phần lõi DÙNG CHUNG cho:
//   staff-me        (màn hình của chính nhân viên: chấm công, xem công, xin nghỉ, phiếu lương)
//   portal-payroll  (quản lý: duyệt, sửa công, hồ sơ lương, chốt lương)
//   workInbox / portal-alerts (chuông thông báo & "Việc từ hệ thống")
//
// Nhân viên = tài khoản quản trị (bảng AdminAccounts) đang hoạt động. Ai đăng nhập được khu quản trị
// đều tự chấm công được; chỉ người có quyền "payroll" (hoặc Quản trị viên chính) mới quản lý.
//
// BẢNG DỮ LIỆU
//   StaffPayProfiles  pk "profile", rk email      Hồ sơ lương: theo giờ / theo tháng, mức lương, phụ cấp, TK ngân hàng
//   StaffTimeEntries  pk email,     rk id         1 ca làm: clockIn/clockOut (ISO), nghỉ giữa ca, trạng thái
//   StaffLeave        pk email,     rk id         Xin nghỉ: từ ngày - đến ngày, loại, trạng thái
//   PayAdjustments    pk "YYYY-MM", rk id         Thưởng / khấu trừ / tạm ứng trong kỳ
//   Payslips          pk "YYYY-MM", rk email      Phiếu lương đã CHỐT (ảnh chụp số liệu tại lúc chốt)
//   PayPeriods        pk "period",  rk "YYYY-MM"  Trạng thái kỳ: open | finalized | paid
//
// TRẠNG THÁI 1 CA (StaffTimeEntries.status)
//   open      đang trong ca (đã vào, chưa ra) — chưa tính lương
//   ok        hợp lệ, được tính lương (chấm bằng nút, hoặc quản lý nhập/duyệt)
//   pending   chờ quản lý duyệt (nhân viên tự bổ sung/sửa, quên chấm ra, ca dài bất thường) — CHƯA tính
//   rejected  quản lý từ chối — không tính, giữ lại để xem lịch sử
//   replaced  bản cũ đã được thay bằng bản sửa đã duyệt — không tính
// =====================================================================================
const { getTableClient } = require("./tableStorage");

const T = {
  PROFILES: "StaffPayProfiles",
  ENTRIES: "StaffTimeEntries",
  LEAVE: "StaffLeave",
  ADJ: "PayAdjustments",
  SLIPS: "Payslips",
  PERIODS: "PayPeriods",
  ACCOUNTS: "AdminAccounts"
};

const LONG_SHIFT_MINUTES = 14 * 60;      // ca dài hơn 14 tiếng -> cần quản lý duyệt
const TAX_THRESHOLD = 2000000;          // khấu trừ 10% cho mỗi lần chi trả từ 2 triệu (lao động thời vụ / không HĐ >= 3 tháng)
const TAX_RATE = 0.1;
const LEAVE_KINDS = { phep: "Nghỉ phép (có lương)", "khong-luong": "Nghỉ không lương", om: "Nghỉ ốm", khac: "Việc riêng khác" };
const ADJ_KINDS = { bonus: "Thưởng", deduction: "Khấu trừ", advance: "Tạm ứng" };

// ---------- Thời gian (giờ Việt Nam, UTC+7) ----------
const vnNow = () => new Date(Date.now() + 7 * 3600e3);
const todayVN = () => vnNow().toISOString().slice(0, 10);
const periodOfDate = d => String(d || "").slice(0, 7);
const currentPeriod = () => todayVN().slice(0, 7);
const vnDateOfIso = iso => new Date(new Date(iso).getTime() + 7 * 3600e3).toISOString().slice(0, 10);
const vnTimeOfIso = iso => new Date(new Date(iso).getTime() + 7 * 3600e3).toISOString().slice(11, 16);
const isDate = s => /^\d{4}-\d{2}-\d{2}$/.test(String(s || ""));
const isTime = s => /^([01]\d|2[0-3]):[0-5]\d$/.test(String(s || ""));
const isPeriod = s => /^\d{4}-(0[1-9]|1[0-2])$/.test(String(s || ""));
// "2026-09-30" + "08:15" (giờ VN) -> ISO UTC
const isoFromVN = (date, hm) => new Date(`${date}T${hm}:00+07:00`).toISOString();

// Từ ngày + giờ vào/ra (giờ VN) -> { clockIn, clockOut } ISO; giờ ra <= giờ vào nghĩa là ca qua đêm
function spanFromVN(date, start, end) {
  const clockIn = isoFromVN(date, start);
  let out = new Date(isoFromVN(date, end));
  if (out.getTime() <= new Date(clockIn).getTime()) out = new Date(out.getTime() + 864e5);
  return { clockIn, clockOut: out.toISOString() };
}

function entryMinutes(e) {
  if (!e || !e.clockIn || !e.clockOut) return 0;
  const raw = Math.round((new Date(e.clockOut).getTime() - new Date(e.clockIn).getTime()) / 60000);
  return Math.max(0, raw - (Number(e.breakMinutes) || 0));
}

const newId = () => `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
const money = n => Math.round(Number(n) || 0);
const normName = s => String(s || "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/đ/gi, "d").toLowerCase().replace(/\s+/g, " ").trim();

async function listAll(name, filter) {
  const t = await getTableClient(name);
  const rows = [];
  for await (const e of t.listEntities(filter ? { queryOptions: { filter } } : undefined)) rows.push(e);
  return rows;
}
const q = s => String(s).replace(/'/g, "''");

// ---------- Nhân viên & hồ sơ lương ----------
async function listStaff() {
  const rows = await listAll(T.ACCOUNTS, "PartitionKey eq 'admin'");
  return rows.filter(a => a.isActive !== false)
    .map(a => ({ email: String(a.rowKey).toLowerCase(), name: a.displayName || a.rowKey, role: a.role === "super" ? "super" : "staff" }))
    .sort((a, b) => a.name.localeCompare(b.name, "vi"));
}

function toProfile(e, email) {
  e = e || {};
  return {
    email: String(email || e.rowKey || "").toLowerCase(),
    payType: e.payType === "monthly" ? "monthly" : "hourly",
    hourlyRate: money(e.hourlyRate),
    monthlySalary: money(e.monthlySalary),
    standardDays: Number(e.standardDays) > 0 ? Number(e.standardDays) : 26,
    allowance: money(e.allowance),
    withholdTax: e.withholdTax === true,
    position: e.position || "",
    phone: e.phone || "",
    bankName: e.bankName || "",
    bankAccount: e.bankAccount || "",
    bankHolder: e.bankHolder || "",
    inPayroll: e.inPayroll !== false,
    configured: !!e.managedAt, // quản lý đã thiết lập mức lương
    updatedAt: e.updatedAt || null,
    updatedBy: e.updatedBy || ""
  };
}

async function getProfile(email) {
  const t = await getTableClient(T.PROFILES);
  try { return toProfile(await t.getEntity("profile", email), email); }
  catch (err) { if (err.statusCode === 404) return toProfile(null, email); throw err; }
}

function toEntry(e) {
  return {
    id: e.rowKey,
    email: String(e.partitionKey || "").toLowerCase(),
    date: e.date || "",
    clockIn: e.clockIn || "",
    clockOut: e.clockOut || "",
    breakMinutes: Number(e.breakMinutes) || 0,
    minutes: entryMinutes(e),
    note: e.note || "",
    source: e.source || "clock",
    status: e.status || "ok",
    replacesId: e.replacesId || "",
    flag: e.flag || "",
    reviewNote: e.reviewNote || "",
    reviewedBy: e.reviewedBy || "",
    reviewedAt: e.reviewedAt || null,
    createdAt: e.createdAt || null,
    createdBy: e.createdBy || ""
  };
}

function toLeave(e) {
  return {
    id: e.rowKey,
    email: String(e.partitionKey || "").toLowerCase(),
    dateFrom: e.dateFrom || "",
    dateTo: e.dateTo || e.dateFrom || "",
    halfDay: e.halfDay === true,
    kind: LEAVE_KINDS[e.kind] ? e.kind : "khac",
    kindLabel: LEAVE_KINDS[e.kind] || LEAVE_KINDS.khac,
    reason: e.reason || "",
    days: leaveDays(e),
    status: e.status || "pending",
    reviewNote: e.reviewNote || "",
    reviewedBy: e.reviewedBy || "",
    reviewedAt: e.reviewedAt || null,
    createdAt: e.createdAt || null
  };
}

// Số ngày nghỉ (không tính Chủ nhật); nửa ngày = 0,5. periodFilter: chỉ đếm các ngày thuộc kỳ đó.
function leaveDays(l, periodFilter) {
  const from = l.dateFrom, to = l.dateTo || l.dateFrom;
  if (!isDate(from) || !isDate(to) || to < from) return 0;
  if (l.halfDay === true && from === to) return (!periodFilter || periodOfDate(from) === periodFilter) && new Date(from + "T00:00:00Z").getUTCDay() !== 0 ? 0.5 : 0;
  let n = 0;
  for (let d = new Date(from + "T00:00:00Z"); d.toISOString().slice(0, 10) <= to; d = new Date(d.getTime() + 864e5)) {
    const ds = d.toISOString().slice(0, 10);
    if (periodFilter && periodOfDate(ds) !== periodFilter) continue;
    if (d.getUTCDay() !== 0) n++;
  }
  return n;
}

// ---------- Kỳ lương ----------
async function getPeriodStatus(period) {
  const t = await getTableClient(T.PERIODS);
  try { const e = await t.getEntity("period", period); return { period, status: e.status || "open", finalizedAt: e.finalizedAt || null, finalizedBy: e.finalizedBy || "", paidAt: e.paidAt || null }; }
  catch (err) { if (err.statusCode === 404) return { period, status: "open" }; throw err; }
}
async function isPeriodLocked(period) {
  return (await getPeriodStatus(period)).status !== "open";
}

// ---------- Tính lương 1 người trong 1 kỳ ----------
// entries: toEntry[] của người đó (mọi trạng thái), leaves: toLeave[], adjustments: [{kind, amount, note}]
function computePayslip(profile, entries, leaves, adjustments, period) {
  const counted = entries.filter(e => e.status === "ok" && periodOfDate(e.date) === period);
  const minutes = counted.reduce((s, e) => s + e.minutes, 0);
  const hours = minutes / 60;
  const days = new Set(counted.map(e => e.date)).size;
  const approvedLeaves = leaves.filter(l => l.status === "approved");
  const unpaidLeaveDays = approvedLeaves.filter(l => l.kind === "khong-luong").reduce((s, l) => s + leaveDays(l, period), 0);
  const paidLeaveDays = approvedLeaves.filter(l => l.kind !== "khong-luong").reduce((s, l) => s + leaveDays(l, period), 0);

  let base = 0, leaveDeduction = 0;
  if (profile.payType === "monthly") {
    leaveDeduction = money(profile.monthlySalary / profile.standardDays * unpaidLeaveDays);
    base = Math.max(0, profile.monthlySalary - leaveDeduction);
  } else {
    base = money(hours * profile.hourlyRate);
  }
  const sum = k => adjustments.filter(a => a.kind === k).reduce((s, a) => s + money(a.amount), 0);
  const bonus = sum("bonus"), deduction = sum("deduction"), advance = sum("advance");
  const allowance = profile.allowance || 0;
  const gross = base + allowance + bonus;
  const tax = profile.withholdTax && gross >= TAX_THRESHOLD ? money(gross * TAX_RATE) : 0;
  const net = gross - tax - deduction - advance;

  return {
    period, email: profile.email,
    payType: profile.payType, hourlyRate: profile.hourlyRate, monthlySalary: profile.monthlySalary, standardDays: profile.standardDays,
    minutes, hours: Math.round(hours * 100) / 100, workDays: days, shifts: counted.length,
    paidLeaveDays, unpaidLeaveDays, leaveDeduction,
    base, allowance, bonus, deduction, advance, gross, tax, net,
    adjustments: adjustments.map(a => ({ id: a.id, kind: a.kind, kindLabel: ADJ_KINDS[a.kind] || a.kind, amount: money(a.amount), note: a.note || "" })),
    pendingCount: entries.filter(e => e.status === "pending" && periodOfDate(e.date) === period).length,
    openCount: entries.filter(e => e.status === "open").length
  };
}

function toSlip(e) {
  let data = {};
  try { data = JSON.parse(e.dataJson || "{}"); } catch (err) { data = {}; }
  return { ...data, period: e.partitionKey, email: e.rowKey, name: e.name || data.name || "", status: e.status || "finalized", finalizedAt: e.finalizedAt || null, finalizedBy: e.finalizedBy || "", paidAt: e.paidAt || null };
}

// Khoảng rowKey/filter cho các ca thuộc 1 kỳ (dựa trên trường date)
const periodFilter = period => `date ge '${period}-01' and date le '${period}-31'`;

module.exports = {
  T, LEAVE_KINDS, ADJ_KINDS, LONG_SHIFT_MINUTES, TAX_THRESHOLD, TAX_RATE,
  todayVN, currentPeriod, periodOfDate, vnDateOfIso, vnTimeOfIso, isDate, isTime, isPeriod, isoFromVN, spanFromVN,
  entryMinutes, newId, money, normName, listAll, q,
  listStaff, toProfile, getProfile, toEntry, toLeave, leaveDays,
  getPeriodStatus, isPeriodLocked, computePayslip, toSlip, periodFilter
};
