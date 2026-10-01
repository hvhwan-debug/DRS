const { getTableClient } = require("./tableStorage");

// "Hộp việc hệ thống": các đầu việc tự sinh từ dữ liệu vận hành. Dùng chung cho màn Công Việc
// (portal-work-data) và chuông thông báo trên mọi màn hình làm việc (portal-alerts), để 2 nơi
// luôn hiện CÙNG một danh sách. Mỗi nhóm chỉ hiện khi tài khoản có quyền khu vực đó (can).
//
// level: "urgent" (cần xử lý ngay, có âm báo) | "action" (cần thao tác) | "info" (nhắc nhẹ, không âm báo)

async function listAll(name, filter) {
  const t = await getTableClient(name);
  const rows = [];
  for await (const e of t.listEntities(filter ? { queryOptions: { filter } } : undefined)) rows.push(e);
  return rows;
}
const todayVN = () => new Date(Date.now() + 7 * 3600e3).toISOString().slice(0, 10);

const LEVELS = { "timesheet-open": "urgent", timesheet: "action", points: "urgent", tuition: "urgent", members: "action", registrations: "action", invoices: "action", gifts: "action", leave: "action", crm: "action", birthday: "info" };
// Số ngày chờ tối đa trước khi một nhóm bị coi là "để lâu" và tự nâng thành khẩn (đỏ)
const AGE_ESCALATE = { registrations: 2, members: 1, invoices: 2, gifts: 3, tuition: 1, timesheet: 1, "timesheet-open": 1, crm: 1 };
// Ước lượng "chờ bao lâu" từ mốc sửa đổi gần nhất của các dòng dữ liệu (Timestamp do Azure Table tự ghi)
function agingDays(rows) {
  if (!rows || !rows.length) return 0;
  const oldest = rows.reduce((min, r) => {
    const t = r.timestamp ? new Date(r.timestamp).getTime() : Date.now();
    return Number.isFinite(t) && t < min ? t : min;
  }, Date.now());
  return Math.max(0, Math.floor((Date.now() - oldest) / 864e5));
}

async function buildInbox(context, can) {
  const inbox = [];
  const today = todayVN();
  const safe = async fn => { try { await fn(); } catch (e) { context.log.error("inbox:", e.message); } };
  await Promise.all([
    can("registrations") && safe(async () => {
      const rows = (await listAll("Registrations")).filter(r => /Chờ/.test(r.status || "Chờ"));
      if (rows.length) inbox.push({ key: "registrations", count: rows.length, title: `${rows.length} đơn đăng ký chờ xử lý`, hint: "Duyệt hoặc từ chối đơn", href: "/admin#registrations", tone: "blue", agingDays: agingDays(rows) });
    }),
    can("members") && safe(async () => {
      const rows = (await listAll("Members")).filter(r => r.approvalStatus === "pending");
      if (rows.length) inbox.push({ key: "members", count: rows.length, title: `${rows.length} tài khoản thành viên chờ duyệt`, hint: "Duyệt để họ đăng nhập được", href: "/admin#members", tone: "blue", agingDays: agingDays(rows) });
    }),
    can("payroll") && safe(async () => {
      // Chấm công: yêu cầu bổ sung/sửa công + đơn xin nghỉ chờ quản lý duyệt
      const [pend, leave] = await Promise.all([
        listAll("StaffTimeEntries", "status eq 'pending'"),
        listAll("StaffLeave", "status eq 'pending'")
      ]);
      const n = pend.length + leave.length;
      if (n) inbox.push({ key: "timesheet", count: n, title: `${n} yêu cầu chấm công / xin nghỉ chờ duyệt`, hint: [pend.length ? `${pend.length} bổ sung/sửa công` : "", leave.length ? `${leave.length} đơn xin nghỉ` : ""].filter(Boolean).join(", "), href: "/admin/cham-cong#duyet", tone: "violet", agingDays: agingDays(pend.concat(leave)) });
    }),
    can("payroll") && safe(async () => {
      // Ca chưa kết thúc từ hôm trước -> nhân viên quên bấm "Kết thúc ca"
      const rows = (await listAll("StaffTimeEntries", "status eq 'open'")).filter(r => r.date && r.date < today);
      if (rows.length) inbox.push({ key: "timesheet-open", count: rows.length, title: `${rows.length} ca làm quên chấm ra`, hint: "Nhắc nhân viên nhập giờ ra, hoặc kết thúc ca hộ", href: "/admin/cham-cong#hom-nay", tone: "red", agingDays: agingDays(rows) });
    }),
    can("invoices") && safe(async () => {
      const rows = (await listAll("Invoices")).filter(r => r.status === "pending_review");
      if (rows.length) inbox.push({ key: "invoices", count: rows.length, title: `${rows.length} biên lai hoá đơn chờ xác nhận`, hint: "Duyệt để cộng tiền và điểm cho phụ huynh", href: "/admin#invoices", tone: "green", agingDays: agingDays(rows) });
    }),
    can("gifts") && safe(async () => {
      const rows = (await listAll("GiftRedemptions")).filter(r => ["pending", "shipping"].includes(r.status || "pending"));
      const pending = rows.filter(r => (r.status || "pending") === "pending").length;
      if (rows.length) inbox.push({ key: "gifts", count: rows.length, title: `${rows.length} yêu cầu đổi quà đang xử lý`, hint: pending ? `${pending} chờ duyệt, ${rows.length - pending} đang vận chuyển` : "Đang vận chuyển, nhớ đánh dấu khi đã trao", href: "/admin#gifts", tone: "gold", agingDays: agingDays(rows) });
    }),
    can("tuition") && safe(async () => {
      const rows = (await listAll("TuitionPayments")).filter(r => r.confirmationStatus === "rejected");
      if (rows.length) inbox.push({ key: "tuition", count: rows.length, title: `${rows.length} khoản học phí phụ huynh báo sai`, hint: "Kiểm tra và sửa lại để tính điểm", href: "/admin#tuition", tone: "red", agingDays: agingDays(rows) });
    }),
    can("students") && safe(async () => {
      const crm = await listAll("StudentCrm", "PartitionKey eq 'crm'");
      const due = crm.filter(p => p.nextFollowUp && p.nextFollowUp <= today && !["da-nghi", "hoan-thanh"].includes(p.stage));
      if (!due.length) return;
      const students = {};
      for (const s of await listAll("Students")) students[s.rowKey] = s.studentName;
      const names = due.slice(0, 4).map(p => students[p.rowKey]).filter(Boolean);
      const overdueDays = due.reduce((max, p) => { const d = Math.floor((Date.now() - new Date(p.nextFollowUp + "T00:00:00").getTime()) / 864e5); return d > max ? d : max; }, 0);
      inbox.push({ key: "crm", count: due.length, title: `${due.length} phụ huynh cần liên hệ hôm nay`, hint: names.join(", ") + (due.length > names.length ? "…" : ""), href: "/admin/crm#agenda", tone: "violet", agingDays: overdueDays });
    }),
    can("students") && safe(async () => {
      // Phụ huynh xin nghỉ cho con (từ trang thành viên) — hôm nay và các ngày tới
      const rows = (await listAll("LeaveRequests")).filter(r => r.date >= today && (r.status || "submitted") === "submitted");
      if (!rows.length) return;
      rows.sort((a, b) => String(a.date).localeCompare(String(b.date)));
      const names = rows.slice(0, 3).map(r => `${r.studentName} (${String(r.date).slice(8, 10)}/${String(r.date).slice(5, 7)})`);
      inbox.push({ key: "leave", count: rows.length, title: `${rows.length} đơn xin nghỉ học của phụ huynh`, hint: names.join(", ") + (rows.length > 3 ? "…" : ""), href: "/admin#attendance-leave", tone: "blue" });
    }),
    can("students") && safe(async () => {
      // Sinh nhật học sinh hôm nay — một lời chúc nhỏ rất có ý nghĩa với gia đình
      const md = today.slice(5);
      const rows = (await listAll("Students")).filter(s => s.dob && String(s.dob).slice(5, 10) === md);
      if (rows.length) inbox.push({ key: "birthday", count: rows.length, title: `${rows.length} học sinh sinh nhật hôm nay`, hint: rows.slice(0, 4).map(s => s.studentName).join(", "), href: "/admin/crm", tone: "gold" });
    }),
    can("gifts") && safe(async () => {
      // Thành viên đang THIẾU điểm (đã đổi quà nhiều hơn điểm tích luỹ + điểm admin đã cộng/trừ tay
      // — thường do học phí bị xoá/sửa giảm). Phải cộng cả "adjustment" vào, nếu không thành viên đã
      // được admin bù điểm (qua nút "Cộng/Trừ Điểm") vẫn bị báo thiếu điểm ở đây mãi.
      const { redemptionPoints } = require("./memberTier");
      const earned = {}, spent = {}, adjustment = {};
      for (const t of await listAll("TuitionPayments")) earned[t.partitionKey] = (earned[t.partitionKey] || 0) + (Number(t.pointsEarned) || 0);
      for (const r of await listAll("GiftRedemptions")) spent[r.partitionKey] = (spent[r.partitionKey] || 0) + redemptionPoints(r);
      for (const a of await listAll("PointAdjustments")) adjustment[a.partitionKey] = (adjustment[a.partitionKey] || 0) + (Number(a.delta) || 0);
      const short = Object.keys(spent).filter(e => spent[e] > (earned[e] || 0) + (adjustment[e] || 0));
      if (short.length) inbox.push({ key: "points", count: short.length, title: `${short.length} thành viên đang thiếu điểm`, hint: "Đã đổi quà nhiều hơn điểm tích luỹ, kiểm tra học phí hoặc huỷ bớt yêu cầu đổi quà", href: "/admin#gifts-deficit", tone: "red" });
    })
  ].filter(Boolean));
  const order = ["points", "timesheet-open", "members", "timesheet", "crm", "leave", "invoices", "tuition", "registrations", "birthday", "gifts"];
  inbox.sort((a, b) => order.indexOf(a.key) - order.indexOf(b.key));

  inbox.forEach(i => {
    i.level = LEVELS[i.key] || "action";
    // Để lâu quá ngưỡng của nhóm này -> tự nâng thành khẩn (đỏ), kèm số ngày chờ lâu nhất vào gợi ý
    const threshold = AGE_ESCALATE[i.key];
    if (threshold != null && i.agingDays >= threshold && i.level !== "urgent") {
      i.level = "urgent"; i.tone = "red";
      i.hint = `${i.hint ? i.hint + " · " : ""}đã chờ ${i.agingDays} ngày`;
    }
  });
  return inbox;
}

// Việc được tạo bằng nút "Giao việc" từ một nhóm trong Hộp việc hệ thống (link.type = link.id = key
// của nhóm). Khi nhóm đó KHÔNG CÒN đầu việc nào (đã duyệt hết đơn, đã điểm danh, đã xác nhận biên
// lai…) thì việc được giao cũng tự chuyển sang "Xong" — không bắt nhân viên đóng tay lần nữa.
// Chỉ đóng khi người đang xem CÓ quyền khu vực đó (nếu không, nhóm vắng mặt chỉ vì bị ẩn chứ chưa xong).
// Không tự đóng: việc lặp lại, và nhóm "sinh nhật" (tự mất khi qua ngày chứ không phải đã làm).
const KEY_PERM = { registrations: "registrations", members: "members", invoices: "invoices", gifts: "gifts", points: "gifts", tuition: "tuition", crm: "students", leave: "students", timesheet: "payroll", "timesheet-open": "payroll" };

async function autoCloseLinkedTasks(context, inbox, can) {
  const alive = new Set(inbox.map(i => i.key));
  const closed = {};
  try {
    const t = await getTableClient("WorkTasks");
    const now = new Date().toISOString();
    for (const e of await listAll("WorkTasks", "PartitionKey eq 'task'")) {
      if (e.status === "done" || e.recurrence) continue;
      let link = null; try { link = JSON.parse(e.linkJson || "null"); } catch (err) { link = null; }
      if (!link || !KEY_PERM[link.type] || link.id !== link.type) continue;
      if (!can(KEY_PERM[link.type]) || alive.has(link.type)) continue;
      if (e.createdAt && Date.now() - new Date(e.createdAt).getTime() < 60e3) continue; // vừa tạo, tránh đóng nhầm do dữ liệu chưa kịp cập nhật
      let history = []; try { history = JSON.parse(e.historyJson || "[]"); } catch (err) { history = []; }
      history.push({ at: now, by: "Hệ thống", text: "Tự hoàn thành: các đầu việc liên quan đã được xử lý xong" });
      await t.updateEntity({ partitionKey: "task", rowKey: e.rowKey, status: "done", completedAt: now, updatedAt: now, historyJson: JSON.stringify(history) }, "Merge");
      closed[e.rowKey] = { status: "done", completedAt: now, history };
    }
  } catch (err) { if (context && context.log) context.log.warn("Không tự đóng được việc liên kết:", err.message); }
  return closed;
}

module.exports = { buildInbox, autoCloseLinkedTasks, listAll, todayVN };
