const { getTableClient } = require("../_shared/tableStorage");
const { requireAdmin, getAdminIdentity } = require("../_shared/adminAuth");
const { logAdminActivity } = require("../_shared/activityLog");
const { sendTrackedEmail } = require("../_shared/sendTrackedEmail");
const P = require("../_shared/payroll");

// QUẢN LÝ chấm công & tính lương (quyền "payroll" hoặc Quản trị viên chính).
// GET  ?period=YYYY-MM -> nhân viên + hồ sơ lương, bảng công, đơn nghỉ, thưởng/phạt, bảng lương, ai đang trong ca
// POST { action, ... } -> saveProfile | reviewEntry | saveEntry | closeOpen | deleteEntry | reviewLeave
//                         addAdjustment | deleteAdjustment | finalize | reopen | markPaid

const bad = (context, status, message, extra) => { context.res.status = status; context.res.body = { success: false, message, ...(extra || {}) }; };
const fmtMoney = n => Number(n || 0).toLocaleString("vi-VN") + "đ";
const periodLabel = p => `tháng ${Number(p.slice(5, 7))}/${p.slice(0, 4)}`;
const esc = v => String(v == null ? "" : v).replace(/[&<>"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));

async function loadPeriod(period) {
  const [staff, profilesRaw, entriesRaw, openRaw, pendingRaw, leaveRaw, adjRaw, slipsRaw, periodStatus] = await Promise.all([
    P.listStaff(),
    P.listAll(P.T.PROFILES, "PartitionKey eq 'profile'"),
    P.listAll(P.T.ENTRIES, P.periodFilter(period)),
    P.listAll(P.T.ENTRIES, "status eq 'open'"),
    P.listAll(P.T.ENTRIES, "status eq 'pending'"),
    P.listAll(P.T.LEAVE),
    P.listAll(P.T.ADJ, `PartitionKey eq '${period}'`),
    P.listAll(P.T.SLIPS, `PartitionKey eq '${period}'`),
    P.getPeriodStatus(period)
  ]);
  const profiles = {};
  for (const r of profilesRaw) profiles[String(r.rowKey).toLowerCase()] = P.toProfile(r, r.rowKey);
  // Gộp: ca trong kỳ + ca đang mở + ca chờ duyệt (ở mọi kỳ), không trùng
  const byId = new Map();
  for (const e of [...entriesRaw, ...openRaw, ...pendingRaw]) byId.set(e.partitionKey + "|" + e.rowKey, P.toEntry(e));
  // Bản gốc của các yêu cầu "xin sửa" (có thể nằm ở kỳ khác) để màn Chờ duyệt so sánh cũ / mới
  const t = await getTableClient(P.T.ENTRIES);
  for (const e of [...byId.values()]) {
    if (e.status !== "pending" || !e.replacesId || byId.has(e.email + "|" + e.replacesId)) continue;
    try { byId.set(e.email + "|" + e.replacesId, P.toEntry(await t.getEntity(e.email, e.replacesId))); } catch (err) { /* bản gốc đã bị xoá */ }
  }
  const entries = [...byId.values()].sort((a, b) => String(b.clockIn).localeCompare(String(a.clockIn)));
  const leaves = leaveRaw.map(P.toLeave).sort((a, b) => b.dateFrom.localeCompare(a.dateFrom));
  const adjustments = adjRaw.map(a => ({ id: a.rowKey, email: String(a.email || "").toLowerCase(), kind: a.kind, kindLabel: P.ADJ_KINDS[a.kind] || a.kind, amount: P.money(a.amount), note: a.note || "", createdBy: a.createdBy || "", createdAt: a.createdAt || null }));
  const slips = {};
  for (const s of slipsRaw) slips[String(s.rowKey).toLowerCase()] = P.toSlip(s);

  // Nhân viên đã nghỉ việc (tài khoản bị xoá/vô hiệu) nhưng còn công trong kỳ -> vẫn hiện để trả lương
  const known = new Set(staff.map(s => s.email));
  for (const e of entries) if (!known.has(e.email)) { known.add(e.email); staff.push({ email: e.email, name: e.email, role: "staff", inactive: true }); }

  const nameOf = {}; staff.forEach(s => { nameOf[s.email] = s.name; });
  const payroll = staff.map(s => {
    const prof = profiles[s.email] || P.toProfile(null, s.email);
    if (slips[s.email]) return { ...slips[s.email], name: s.name, locked: true, profileConfigured: prof.configured, inPayroll: prof.inPayroll };
    const mine = entries.filter(e => e.email === s.email);
    const ls = leaves.filter(l => l.email === s.email && P.leaveDays(l, period) > 0);
    const calc = P.computePayslip(prof, mine, ls, adjustments.filter(a => a.email === s.email), period);
    return { ...calc, name: s.name, status: "draft", locked: false, profileConfigured: prof.configured, inPayroll: prof.inPayroll };
  });

  return { staff: staff.map(s => ({ ...s, profile: profiles[s.email] || P.toProfile(null, s.email) })), entries, leaves, adjustments, payroll, periodStatus, nameOf };
}

module.exports = async function (context, req) {
  context.res = { headers: { "Content-Type": "application/json", "Cache-Control": "no-store" } };
  if (!(await requireAdmin(context, req, "payroll"))) return;

  try {
    const me = (await getAdminIdentity(req)) || { displayName: "Quản lý", email: "" };
    const now = new Date().toISOString();

    if (String(req.method).toUpperCase() === "GET") {
      const period = P.isPeriod(req.query && req.query.period) ? req.query.period : P.currentPeriod();
      const data = await loadPeriod(period);
      delete data.nameOf;
      context.res.status = 200;
      context.res.body = { success: true, period, today: P.todayVN(), now, ...data };
      return;
    }

    const b = req.body || {};
    const action = String(b.action || "");
    const email = String(b.email || "").trim().toLowerCase();
    const entriesT = await getTableClient(P.T.ENTRIES);
    const lockedMsg = "Kỳ lương này đã chốt. Mở lại kỳ lương trước khi sửa.";
    const log = (what, details) => logAdminActivity(req, what, details);

    const getEntry = async () => {
      try { return P.toEntry(await entriesT.getEntity(email, String(b.id || ""))); }
      catch (e) { if (e.statusCode === 404) return null; throw e; }
    };

    // ---------- Hồ sơ lương ----------
    if (action === "saveProfile") {
      if (!email) return bad(context, 400, "Thiếu email nhân viên.");
      const n = (v, max) => Math.max(0, Math.min(max, Math.round(Number(v) || 0)));
      const clean = (v, len) => String(v || "").trim().slice(0, len);
      const payType = b.payType === "monthly" ? "monthly" : "hourly";
      if (payType === "hourly" && !(Number(b.hourlyRate) > 0)) return bad(context, 400, "Vui lòng nhập lương theo giờ.");
      if (payType === "monthly" && !(Number(b.monthlySalary) > 0)) return bad(context, 400, "Vui lòng nhập lương tháng.");
      const t = await getTableClient(P.T.PROFILES);
      const row = {
        partitionKey: "profile", rowKey: email, payType,
        hourlyRate: n(b.hourlyRate, 10000000), monthlySalary: n(b.monthlySalary, 1000000000),
        standardDays: Math.max(1, Math.min(31, Number(b.standardDays) || 26)), allowance: n(b.allowance, 1000000000),
        withholdTax: b.withholdTax === true, position: clean(b.position, 80), inPayroll: b.inPayroll !== false,
        managedAt: now, updatedAt: now, updatedBy: me.displayName
      };
      if (b.bankName !== undefined) Object.assign(row, { bankName: clean(b.bankName, 80), bankAccount: clean(b.bankAccount, 40).replace(/\s+/g, ""), bankHolder: clean(b.bankHolder, 80).toUpperCase(), phone: clean(b.phone, 20) });
      await t.upsertEntity(row, "Merge");
      await log("Cập nhật hồ sơ lương", `${email} - ${payType === "hourly" ? fmtMoney(row.hourlyRate) + "/giờ" : fmtMoney(row.monthlySalary) + "/tháng"}`);
      context.res.status = 200; context.res.body = { success: true };
      return;
    }

    // ---------- Duyệt yêu cầu chấm công ----------
    if (action === "reviewEntry") {
      const e = await getEntry();
      if (!e || e.status !== "pending") return bad(context, 404, "Yêu cầu này không còn chờ duyệt (có thể người khác đã xử lý).");
      if (await P.isPeriodLocked(P.periodOfDate(e.date))) return bad(context, 423, lockedMsg);
      const approve = b.decision === "approve";
      const reviewNote = String(b.reviewNote || "").trim().slice(0, 300);
      if (approve && e.replacesId) {
        await entriesT.updateEntity({ partitionKey: email, rowKey: e.replacesId, status: "replaced", replacedBy: e.id, updatedAt: now }, "Merge").catch(() => {});
      }
      await entriesT.updateEntity({ partitionKey: email, rowKey: e.id, status: approve ? "ok" : "rejected", reviewNote, reviewedBy: me.displayName, reviewedAt: now, updatedAt: now }, "Merge");
      await log(approve ? "Duyệt chấm công" : "Từ chối chấm công", `${email} - ${e.date}${reviewNote ? " - " + reviewNote : ""}`);
      context.res.status = 200; context.res.body = { success: true };
      return;
    }

    // ---------- Quản lý nhập / sửa ca trực tiếp (được tính ngay) ----------
    if (action === "saveEntry") {
      if (!email) return bad(context, 400, "Chọn nhân viên.");
      const date = String(b.date || "");
      if (!P.isDate(date) || !P.isTime(b.start) || !P.isTime(b.end)) return bad(context, 400, "Ngày / giờ vào / giờ ra không hợp lệ.");
      if (await P.isPeriodLocked(P.periodOfDate(date))) return bad(context, 423, lockedMsg);
      const breakMinutes = Math.max(0, Math.min(600, Math.round(Number(b.breakMinutes) || 0)));
      const span = P.spanFromVN(date, b.start, b.end);
      if (P.entryMinutes({ ...span, breakMinutes }) <= 0) return bad(context, 400, "Thời gian nghỉ giữa ca dài hơn cả ca làm.");
      const note = String(b.note || "").trim().slice(0, 300);
      if (b.id) {
        const e = await getEntry();
        if (!e) return bad(context, 404, "Không tìm thấy ca này.");
        if (await P.isPeriodLocked(P.periodOfDate(e.date))) return bad(context, 423, lockedMsg);
        await entriesT.updateEntity({ partitionKey: email, rowKey: e.id, date, ...span, breakMinutes, note, status: "ok", flag: e.flag, editedBy: me.displayName, editedAt: now, updatedAt: now, reviewedBy: me.displayName, reviewedAt: now }, "Merge");
        await log("Sửa ca làm", `${email} - ${date} ${b.start}-${b.end}`);
      } else {
        await entriesT.createEntity({ partitionKey: email, rowKey: P.newId(), date, ...span, breakMinutes, note, source: "manager", status: "ok", createdAt: now, createdBy: me.email || me.displayName, reviewedBy: me.displayName, reviewedAt: now });
        await log("Thêm ca làm", `${email} - ${date} ${b.start}-${b.end}`);
      }
      context.res.status = 200; context.res.body = { success: true };
      return;
    }

    if (action === "closeOpen") {
      const e = await getEntry();
      if (!e || e.status !== "open") return bad(context, 404, "Ca này không còn đang mở.");
      if (!P.isTime(b.end)) return bad(context, 400, "Giờ ra không hợp lệ.");
      if (await P.isPeriodLocked(P.periodOfDate(e.date))) return bad(context, 423, lockedMsg);
      const { clockOut } = P.spanFromVN(e.date, P.vnTimeOfIso(e.clockIn), b.end);
      if (new Date(clockOut).getTime() > Date.now()) return bad(context, 400, "Giờ ra không được sau thời điểm hiện tại.");
      await entriesT.updateEntity({ partitionKey: email, rowKey: e.id, clockOut, breakMinutes: Math.max(0, Math.round(Number(b.breakMinutes) || 0)), status: "ok", flag: "closed-by-manager", reviewedBy: me.displayName, reviewedAt: now, updatedAt: now }, "Merge");
      await log("Kết thúc ca hộ nhân viên", `${email} - ${e.date} ra ${b.end}`);
      context.res.status = 200; context.res.body = { success: true };
      return;
    }

    if (action === "deleteEntry") {
      const e = await getEntry();
      if (!e) return bad(context, 404, "Không tìm thấy ca này.");
      if (await P.isPeriodLocked(P.periodOfDate(e.date))) return bad(context, 423, lockedMsg);
      await entriesT.deleteEntity(email, e.id);
      await log("Xoá ca làm", `${email} - ${e.date}`);
      context.res.status = 200; context.res.body = { success: true };
      return;
    }

    // ---------- Đơn xin nghỉ ----------
    if (action === "reviewLeave") {
      const t = await getTableClient(P.T.LEAVE);
      let l; try { l = P.toLeave(await t.getEntity(email, String(b.id || ""))); } catch (e) { return bad(context, 404, "Không tìm thấy đơn nghỉ."); }
      if (l.status !== "pending") return bad(context, 409, "Đơn này đã được xử lý.");
      const approve = b.decision === "approve";
      const reviewNote = String(b.reviewNote || "").trim().slice(0, 300);
      await t.updateEntity({ partitionKey: email, rowKey: l.id, status: approve ? "approved" : "rejected", reviewNote, reviewedBy: me.displayName, reviewedAt: now }, "Merge");
      await log(approve ? "Duyệt đơn nghỉ" : "Từ chối đơn nghỉ", `${email} - ${l.dateFrom}${l.dateTo !== l.dateFrom ? " → " + l.dateTo : ""}`);
      const range = l.dateFrom === l.dateTo ? l.dateFrom.split("-").reverse().join("/") + (l.halfDay ? " (nửa ngày)" : "") : `${l.dateFrom.split("-").reverse().join("/")} – ${l.dateTo.split("-").reverse().join("/")}`;
      await sendTrackedEmail(context, {
        to: email, subject: approve ? `Đơn nghỉ ${range} đã được duyệt` : `Đơn nghỉ ${range} chưa được duyệt`,
        type: "other", eyebrow: "Chấm Công", title: approve ? "Đơn nghỉ đã được duyệt" : "Đơn nghỉ chưa được duyệt",
        bodyHtml: `<p style="margin:0 0 12px;">${esc(l.kindLabel)} · <strong>${esc(range)}</strong> (${l.days} ngày)</p>
          ${reviewNote ? `<p style="margin:0 0 12px;"><strong>Ghi chú của quản lý:</strong> ${esc(reviewNote)}</p>` : ""}
          <p style="margin:0;">Người duyệt: ${esc(me.displayName)}</p>`,
        ctas: [{ label: "Mở Chấm Công", href: "https://wvn.vn/admin/cham-cong", style: "primary" }]
      });
      context.res.status = 200; context.res.body = { success: true };
      return;
    }

    // ---------- Thưởng / khấu trừ / tạm ứng ----------
    if (action === "addAdjustment" || action === "deleteAdjustment") {
      const period = String(b.period || "");
      if (!P.isPeriod(period)) return bad(context, 400, "Kỳ lương không hợp lệ.");
      if (await P.isPeriodLocked(period)) return bad(context, 423, lockedMsg);
      const t = await getTableClient(P.T.ADJ);
      if (action === "deleteAdjustment") {
        await t.deleteEntity(period, String(b.id || "")).catch(() => {});
        await log("Xoá khoản điều chỉnh lương", `${period} - ${b.id}`);
      } else {
        if (!email || !P.ADJ_KINDS[b.kind]) return bad(context, 400, "Chọn nhân viên và loại khoản.");
        const amount = Math.round(Number(b.amount) || 0);
        if (amount <= 0) return bad(context, 400, "Số tiền phải lớn hơn 0.");
        const note = String(b.note || "").trim().slice(0, 200);
        if (!note) return bad(context, 400, "Vui lòng ghi nội dung (sẽ hiện trên phiếu lương).");
        await t.createEntity({ partitionKey: period, rowKey: P.newId(), email, kind: b.kind, amount, note, createdBy: me.displayName, createdAt: now });
        await log(`Thêm ${P.ADJ_KINDS[b.kind].toLowerCase()}`, `${email} - ${period} - ${fmtMoney(amount)} - ${note}`);
      }
      context.res.status = 200; context.res.body = { success: true };
      return;
    }

    // ---------- Chốt / mở lại / đã trả lương ----------
    if (action === "finalize") {
      const period = String(b.period || "");
      if (!P.isPeriod(period)) return bad(context, 400, "Kỳ lương không hợp lệ.");
      if (period > P.currentPeriod()) return bad(context, 400, "Chưa tới kỳ lương này.");
      if (await P.isPeriodLocked(period)) return bad(context, 409, "Kỳ lương này đã được chốt.");
      const data = await loadPeriod(period);
      const pending = data.entries.filter(e => e.status === "pending" && P.periodOfDate(e.date) === period).length;
      const open = data.entries.filter(e => e.status === "open" && P.periodOfDate(e.date) === period).length;
      if ((pending || open) && b.force !== true) {
        return bad(context, 409, `Còn ${pending} yêu cầu chấm công chờ duyệt và ${open} ca chưa kết thúc trong kỳ. Các ca này sẽ KHÔNG được tính nếu chốt bây giờ.`, { needsForce: true, pending, open });
      }
      const rows = data.payroll.filter(r => r.inPayroll !== false && (r.profileConfigured || r.minutes > 0 || r.adjustments.length));
      const t = await getTableClient(P.T.SLIPS);
      for (const r of rows) {
        const snap = { ...r }; delete snap.locked; delete snap.status; delete snap.profileConfigured; delete snap.inPayroll;
        await t.upsertEntity({ partitionKey: period, rowKey: r.email, name: r.name, status: "finalized", finalizedAt: now, finalizedBy: me.displayName, dataJson: JSON.stringify(snap) }, "Replace");
      }
      await (await getTableClient(P.T.PERIODS)).upsertEntity({ partitionKey: "period", rowKey: period, status: "finalized", finalizedAt: now, finalizedBy: me.displayName }, "Merge");
      await log("Chốt bảng lương", `${periodLabel(period)} - ${rows.length} người - tổng ${fmtMoney(rows.reduce((s, r) => s + r.net, 0))}`);

      // Gửi phiếu lương cho từng người (best-effort)
      let sent = 0;
      const line = (k, v, strong) => `<tr><td style="padding:6px 0;color:#64748b;font-family:Arial,Helvetica,sans-serif;">${k}</td><td style="padding:6px 0;text-align:right;font-family:Arial,Helvetica,sans-serif;${strong ? "font-weight:800;font-size:15px;" : "font-weight:600;"}">${v}</td></tr>`;
      for (const r of rows) {
        if (!/@/.test(r.email)) continue;
        const work = r.payType === "hourly" ? `${r.hours.toLocaleString("vi-VN")} giờ × ${fmtMoney(r.hourlyRate)}` : `Lương tháng${r.unpaidLeaveDays ? ` (trừ ${r.unpaidLeaveDays} ngày nghỉ không lương)` : ""}`;
        const res = await sendTrackedEmail(context, {
          to: r.email, subject: `Phiếu lương ${periodLabel(period)}`, type: "other", eyebrow: "Phiếu Lương", title: `Phiếu lương ${periodLabel(period)}`,
          bodyHtml: `<p style="margin:0 0 14px;">Chào ${esc(r.name)}, phiếu lương ${periodLabel(period)} của bạn đã được chốt:</p>
            <table style="width:100%;border-collapse:collapse;font-size:13px;margin-bottom:14px;">
              ${line("Công", `${r.shifts} ca · ${r.workDays} ngày · ${r.hours.toLocaleString("vi-VN")} giờ`)}
              ${line(esc(work), fmtMoney(r.base))}
              ${r.allowance ? line("Phụ cấp", fmtMoney(r.allowance)) : ""}${r.bonus ? line("Thưởng", fmtMoney(r.bonus)) : ""}
              ${r.tax ? line("Khấu trừ thuế TNCN 10%", "−" + fmtMoney(r.tax)) : ""}${r.deduction ? line("Khấu trừ", "−" + fmtMoney(r.deduction)) : ""}${r.advance ? line("Đã tạm ứng", "−" + fmtMoney(r.advance)) : ""}
              ${line("Thực nhận", fmtMoney(r.net), true)}
            </table>
            <p style="font-size:13px;color:#64748b;margin:0;">Xem chi tiết từng ca trong mục Chấm Công → Phiếu lương. Nếu có sai sót, vui lòng phản hồi quản lý sớm.</p>`,
          ctas: [{ label: "Xem Phiếu Lương", href: "https://wvn.vn/admin/cham-cong#phieu-luong", style: "primary" }]
        });
        if (res && res.success) sent++;
      }
      context.res.status = 200; context.res.body = { success: true, count: rows.length, sent };
      return;
    }

    if (action === "reopen") {
      const period = String(b.period || "");
      if (!P.isPeriod(period)) return bad(context, 400, "Kỳ lương không hợp lệ.");
      const st = await P.getPeriodStatus(period);
      if (st.status === "open") return bad(context, 409, "Kỳ lương này đang mở.");
      const t = await getTableClient(P.T.SLIPS);
      for (const s of await P.listAll(P.T.SLIPS, `PartitionKey eq '${period}'`)) await t.deleteEntity(period, s.rowKey).catch(() => {});
      await (await getTableClient(P.T.PERIODS)).upsertEntity({ partitionKey: "period", rowKey: period, status: "open", reopenedAt: now, reopenedBy: me.displayName }, "Merge");
      await log("Mở lại bảng lương", periodLabel(period));
      context.res.status = 200; context.res.body = { success: true };
      return;
    }

    if (action === "markPaid") {
      const period = String(b.period || "");
      if (!P.isPeriod(period)) return bad(context, 400, "Kỳ lương không hợp lệ.");
      const t = await getTableClient(P.T.SLIPS);
      const slips = await P.listAll(P.T.SLIPS, `PartitionKey eq '${period}'`);
      if (!slips.length) return bad(context, 409, "Kỳ lương này chưa chốt.");
      const targets = slips.filter(s => (!email || String(s.rowKey).toLowerCase() === email) && s.status !== "paid");
      for (const s of targets) {
        await t.updateEntity({ partitionKey: period, rowKey: s.rowKey, status: "paid", paidAt: now, paidBy: me.displayName }, "Merge");
        const slip = P.toSlip(s);
        await sendTrackedEmail(context, {
          to: s.rowKey, subject: `Đã chuyển lương ${periodLabel(period)}`, type: "other", eyebrow: "Phiếu Lương", title: "Lương đã được chuyển",
          bodyHtml: `<p style="margin:0 0 12px;">Chào ${esc(slip.name)}, lương ${periodLabel(period)} của bạn (<strong>${fmtMoney(slip.net)}</strong>) đã được chuyển.</p><p style="margin:0;font-size:13px;color:#64748b;">Vui lòng kiểm tra tài khoản và phản hồi nếu chưa nhận được.</p>`
        });
      }
      const remaining = slips.filter(s => s.status !== "paid" && !targets.includes(s)).length;
      if (!remaining) await (await getTableClient(P.T.PERIODS)).upsertEntity({ partitionKey: "period", rowKey: period, status: "paid", paidAt: now }, "Merge");
      await log("Đánh dấu đã trả lương", `${periodLabel(period)}${email ? " - " + email : " - tất cả"} (${targets.length} người)`);
      context.res.status = 200; context.res.body = { success: true, count: targets.length };
      return;
    }

    bad(context, 400, "Thao tác không hợp lệ.");
  } catch (err) {
    context.log.error("Lỗi quản lý chấm công:", err.message);
    context.res.status = 500;
    context.res.body = { success: false, message: "Đã có lỗi xảy ra, vui lòng thử lại sau." };
  }
};
