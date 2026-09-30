const { getTableClient } = require("../_shared/tableStorage");
const { requireAdmin, loadSessionAndAccount, accountPermissions, isSuperAdmin } = require("../_shared/adminAuth");
const P = require("../_shared/payroll");

// Màn hình CHẤM CÔNG của chính nhân viên đang đăng nhập (mọi tài khoản quản trị đang hoạt động).
// GET  ?period=YYYY-MM  -> ca đang mở, bảng công trong kỳ, lương tạm tính, nghỉ phép, phiếu lương, lịch dạy
// POST { action, ... }  -> clockIn | clockOut | fixForgotten | requestEntry | cancelRequest | requestLeave | cancelLeave | updateBank
// Giờ vào/ra khi bấm nút LUÔN lấy theo đồng hồ máy chủ (không nhận giờ từ điện thoại) để không sửa được.

const bad = (context, status, message) => { context.res.status = status; context.res.body = { success: false, message }; };

module.exports = async function (context, req) {
  context.res = { headers: { "Content-Type": "application/json", "Cache-Control": "no-store" } };
  if (!(await requireAdmin(context, req))) return;

  try {
    const { session, account } = await loadSessionAndAccount(null, req);
    const email = String(session.adminEmail || "").toLowerCase();
    if (!email) return bad(context, 403, "Phiên đăng nhập này không gắn với tài khoản nhân viên nào. Vui lòng đăng xuất và đăng nhập lại.");
    const name = (account && account.displayName) || session.displayName || email;
    const canManage = isSuperAdmin(account) || accountPermissions(account).includes("payroll");
    const entries = await getTableClient(P.T.ENTRIES);

    if (String(req.method).toUpperCase() === "GET") {
      const period = P.isPeriod(req.query && req.query.period) ? req.query.period : P.currentPeriod();
      const today = P.todayVN();
      const [profile, mineRaw, leaveRaw, adjRaw, slipRaw, periodStatus, schedules] = await Promise.all([
        P.getProfile(email),
        P.listAll(P.T.ENTRIES, `PartitionKey eq '${P.q(email)}'`),
        P.listAll(P.T.LEAVE, `PartitionKey eq '${P.q(email)}'`),
        P.listAll(P.T.ADJ, `PartitionKey eq '${period}' and email eq '${P.q(email)}'`),
        P.listAll(P.T.SLIPS, `RowKey eq '${P.q(email)}'`),
        P.getPeriodStatus(period),
        P.listAll("ClassSchedules").catch(() => [])
      ]);
      const all = mineRaw.map(P.toEntry);
      const open = all.find(e => e.status === "open") || null;
      const inPeriod = all.filter(e => P.periodOfDate(e.date) === period || e.status === "open").sort((a, b) => String(b.clockIn).localeCompare(String(a.clockIn)));
      const leaves = leaveRaw.map(P.toLeave).sort((a, b) => b.dateFrom.localeCompare(a.dateFrom));
      const periodLeaves = leaves.filter(l => P.leaveDays(l, period) > 0);
      const estimate = P.computePayslip(profile, all, periodLeaves, adjRaw.map(a => ({ id: a.rowKey, kind: a.kind, amount: a.amount, note: a.note })), period);
      const slips = slipRaw.map(P.toSlip).sort((a, b) => b.period.localeCompare(a.period));
      // Lịch dạy có tên mình (Lịch Học -> Giáo viên)
      const me = P.normName(name);
      const mySchedules = me ? schedules.filter(s => {
        const t = P.normName(s.teacherName);
        return t.length > 2 && (t.includes(me) || me.includes(t));
      }).map(s => ({
        id: s.rowKey, program: s.program || "", days: s.days || "", startTime: s.startTime || "", endTime: s.endTime || "", location: s.location || "", teacherName: s.teacherName || ""
      })) : [];
      const todayMinutes = all.filter(e => e.date === today && e.status === "ok").reduce((s, e) => s + e.minutes, 0);

      context.res.status = 200;
      context.res.body = {
        success: true,
        me: { email, name, canManage },
        now: new Date().toISOString(), today, period, periodStatus,
        profile: { ...profile, hourlyRate: profile.hourlyRate, monthlySalary: profile.monthlySalary },
        open, entries: inPeriod, todayMinutes,
        leaves: leaves.slice(0, 40), estimate,
        slips: slips.filter(s => s.status === "finalized" || s.status === "paid").slice(0, 24),
        schedules: mySchedules
      };
      return;
    }

    // ------------------------------- POST -------------------------------
    const b = req.body || {};
    const action = String(b.action || "");
    const now = new Date().toISOString();
    const today = P.todayVN();
    const ip = String((req.headers && (req.headers["x-forwarded-for"] || req.headers["x-client-ip"])) || "").split(",")[0].trim().slice(0, 60);
    const ua = String((req.headers && req.headers["user-agent"]) || "").slice(0, 200);
    const note = String(b.note || "").trim().slice(0, 300);
    const breakMinutes = Math.max(0, Math.min(600, Math.round(Number(b.breakMinutes) || 0)));
    const mine = (await P.listAll(P.T.ENTRIES, `PartitionKey eq '${P.q(email)}'`)).map(P.toEntry);
    const open = mine.find(e => e.status === "open");

    if (action === "clockIn") {
      if (open) return bad(context, 409, open.date < today ? "Bạn chưa kết thúc ca ngày " + open.date.split("-").reverse().join("/") + ". Hãy nhập giờ ra của ca đó trước." : "Bạn đang trong ca rồi.");
      if (await P.isPeriodLocked(P.periodOfDate(today))) return bad(context, 423, "Kỳ lương tháng này đã chốt, không chấm công thêm được. Vui lòng báo quản lý.");
      const id = P.newId();
      await entries.createEntity({ partitionKey: email, rowKey: id, date: today, clockIn: now, clockOut: "", breakMinutes: 0, note, source: "clock", status: "open", createdAt: now, createdBy: email, ipIn: ip, uaIn: ua });
      context.res.status = 200; context.res.body = { success: true, id, clockIn: now };
      return;
    }

    if (action === "clockOut") {
      if (!open) return bad(context, 409, "Bạn chưa vào ca.");
      if (await P.isPeriodLocked(P.periodOfDate(open.date))) return bad(context, 423, "Kỳ lương của ca này đã chốt. Vui lòng báo quản lý.");
      const mins = P.entryMinutes({ clockIn: open.clockIn, clockOut: now, breakMinutes });
      const long = mins > P.LONG_SHIFT_MINUTES;
      await entries.updateEntity({ partitionKey: email, rowKey: open.id, clockOut: now, breakMinutes, note: [open.note, note].filter(Boolean).join(" · "), status: long ? "pending" : "ok", flag: long ? "long" : "", ipOut: ip, uaOut: ua, updatedAt: now }, "Merge");
      context.res.status = 200; context.res.body = { success: true, minutes: mins, pending: long, message: long ? "Ca dài hơn 14 tiếng nên cần quản lý xác nhận trước khi tính lương." : null };
      return;
    }

    if (action === "fixForgotten") {
      // Quên bấm "Kết thúc ca" -> nhân viên tự nhập giờ ra, chờ quản lý duyệt
      const e = mine.find(x => x.id === b.id && x.status === "open");
      if (!e) return bad(context, 404, "Không tìm thấy ca đang mở.");
      if (!P.isTime(b.end)) return bad(context, 400, "Giờ ra không hợp lệ.");
      if (await P.isPeriodLocked(P.periodOfDate(e.date))) return bad(context, 423, "Kỳ lương của ca này đã chốt. Vui lòng báo quản lý.");
      const { clockOut } = P.spanFromVN(e.date, P.vnTimeOfIso(e.clockIn), b.end);
      if (new Date(clockOut).getTime() > Date.now()) return bad(context, 400, "Giờ ra không được sau thời điểm hiện tại.");
      await entries.updateEntity({ partitionKey: email, rowKey: e.id, clockOut, breakMinutes, note: [e.note, note || "Quên chấm ra, tự nhập giờ ra"].filter(Boolean).join(" · "), status: "pending", flag: "forgot", updatedAt: now }, "Merge");
      context.res.status = 200; context.res.body = { success: true };
      return;
    }

    if (action === "requestEntry") {
      // Bổ sung ca bị thiếu, hoặc xin sửa 1 ca đã có (replacesId) — chờ quản lý duyệt
      const date = String(b.date || "");
      if (!P.isDate(date) || date > today) return bad(context, 400, "Ngày làm không hợp lệ.");
      if (!P.isTime(b.start) || !P.isTime(b.end)) return bad(context, 400, "Giờ vào / giờ ra không hợp lệ.");
      if (!note) return bad(context, 400, "Vui lòng ghi lý do để quản lý duyệt nhanh hơn.");
      if (await P.isPeriodLocked(P.periodOfDate(date))) return bad(context, 423, "Kỳ lương tháng này đã chốt, không bổ sung được nữa.");
      let replacesId = "";
      if (b.replacesId) {
        const orig = mine.find(x => x.id === b.replacesId && ["ok", "rejected"].includes(x.status));
        if (!orig) return bad(context, 404, "Không tìm thấy ca cần sửa.");
        if (mine.some(x => x.replacesId === orig.id && x.status === "pending")) return bad(context, 409, "Ca này đã có yêu cầu sửa đang chờ duyệt.");
        replacesId = orig.id;
      }
      const span = P.spanFromVN(date, b.start, b.end);
      if (new Date(span.clockOut).getTime() > Date.now() + 5 * 60e3) return bad(context, 400, "Giờ ra không được sau thời điểm hiện tại.");
      if (P.entryMinutes({ ...span, breakMinutes }) <= 0) return bad(context, 400, "Thời gian nghỉ giữa ca dài hơn cả ca làm.");
      const id = P.newId();
      await entries.createEntity({ partitionKey: email, rowKey: id, date, ...span, breakMinutes, note, source: "manual", status: "pending", replacesId, flag: replacesId ? "edit" : "add", createdAt: now, createdBy: email, ipIn: ip, uaIn: ua });
      context.res.status = 200; context.res.body = { success: true, id };
      return;
    }

    if (action === "cancelRequest") {
      const e = mine.find(x => x.id === b.id && x.status === "pending" && x.source === "manual");
      if (!e) return bad(context, 404, "Chỉ huỷ được yêu cầu bổ sung/sửa công đang chờ duyệt.");
      await entries.deleteEntity(email, e.id);
      context.res.status = 200; context.res.body = { success: true };
      return;
    }

    if (action === "requestLeave") {
      const dateFrom = String(b.dateFrom || ""), dateTo = String(b.dateTo || b.dateFrom || "");
      if (!P.isDate(dateFrom) || !P.isDate(dateTo) || dateTo < dateFrom) return bad(context, 400, "Khoảng ngày nghỉ không hợp lệ.");
      if (!P.LEAVE_KINDS[b.kind]) return bad(context, 400, "Vui lòng chọn loại nghỉ.");
      const halfDay = b.halfDay === true && dateFrom === dateTo;
      const days = P.leaveDays({ dateFrom, dateTo, halfDay });
      if (!days) return bad(context, 400, "Khoảng này chỉ có Chủ nhật, không cần xin nghỉ.");
      if (days > 30) return bad(context, 400, "Mỗi lần xin nghỉ tối đa 30 ngày.");
      const reason = String(b.reason || "").trim().slice(0, 300);
      const t = await getTableClient(P.T.LEAVE);
      const id = P.newId();
      await t.createEntity({ partitionKey: email, rowKey: id, dateFrom, dateTo, halfDay, kind: b.kind, reason, status: "pending", createdAt: now });
      context.res.status = 200; context.res.body = { success: true, id };
      return;
    }

    if (action === "cancelLeave") {
      const t = await getTableClient(P.T.LEAVE);
      let l; try { l = await t.getEntity(email, String(b.id || "")); } catch (e) { return bad(context, 404, "Không tìm thấy đơn nghỉ."); }
      if ((l.status || "pending") !== "pending") return bad(context, 409, "Đơn đã được xử lý, không huỷ được. Vui lòng báo quản lý.");
      await t.deleteEntity(email, l.rowKey);
      context.res.status = 200; context.res.body = { success: true };
      return;
    }

    if (action === "updateBank") {
      const clean = (v, n) => String(v || "").trim().slice(0, n);
      const t = await getTableClient(P.T.PROFILES);
      await t.upsertEntity({
        partitionKey: "profile", rowKey: email,
        bankName: clean(b.bankName, 80), bankAccount: clean(b.bankAccount, 40).replace(/\s+/g, ""), bankHolder: clean(b.bankHolder, 80).toUpperCase(),
        phone: clean(b.phone, 20), bankUpdatedAt: now
      }, "Merge");
      context.res.status = 200; context.res.body = { success: true };
      return;
    }

    bad(context, 400, "Thao tác không hợp lệ.");
  } catch (err) {
    context.log.error("Lỗi chấm công:", err.message);
    context.res.status = 500;
    context.res.body = { success: false, message: "Đã có lỗi xảy ra, vui lòng thử lại sau." };
  }
};
