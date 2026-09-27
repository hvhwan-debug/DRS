const { getTableClient } = require("../_shared/tableStorage");
const { requireAdmin, loadSessionAndAccount, accountPermissions, isSuperAdmin } = require("../_shared/adminAuth");
const { CRM_TABLE, INTERACTIONS_TABLE, CRM_PARTITION, DEFAULT_STAGE } = require("../_shared/crm");

// Trả toàn bộ dữ liệu cho màn hình CRM trong 1 lần gọi: học sinh + hồ sơ chăm sóc + lịch sử
// chăm sóc, kèm TÓM TẮT điểm / học phí / điểm danh. Phần tóm tắt chỉ trả khi tài khoản có đúng
// quyền của khu vực đó, để CRM không trở thành "cửa sau" xem dữ liệu chưa được cấp quyền.

function keyOf(email, name) {
  return `${String(email || "").trim().toLowerCase()}|${String(name || "").trim().toLowerCase()}`;
}

async function listAll(tableName) {
  const table = await getTableClient(tableName);
  const rows = [];
  for await (const entity of table.listEntities()) rows.push(entity);
  return rows;
}

module.exports = async function (context, req) {
  context.res = { headers: { "Content-Type": "application/json" } };

  if (!(await requireAdmin(context, req, "students"))) return;

  try {
    const { account } = await loadSessionAndAccount(null, req);
    const superAdmin = isSuperAdmin(account);
    const perms = accountPermissions(account);
    const can = key => superAdmin || perms.includes(key);

    const [studentRows, crmRows, interactionRows] = await Promise.all([
      listAll("Students"), listAll(CRM_TABLE), listAll(INTERACTIONS_TABLE)
    ]);

    const profiles = {};
    for (const p of crmRows) {
      if (p.partitionKey !== CRM_PARTITION) continue;
      let tags = [];
      try { tags = JSON.parse(p.tagsJson || "[]"); } catch (e) { tags = []; }
      profiles[p.rowKey] = {
        stage: p.stage || DEFAULT_STAGE,
        priority: p.priority || "thuong",
        gradeLevel: p.gradeLevel || "",
        school: p.school || "",
        address: p.address || "",
        guardianName: p.guardianName || "",
        guardianPhone: p.guardianPhone || "",
        guardianRelation: p.guardianRelation || "",
        source: p.source || "",
        tags,
        nextFollowUp: p.nextFollowUp || "",
        followUpNote: p.followUpNote || "",
        caretaker: p.caretaker || "",
        updatedAt: p.updatedAt || null,
        updatedBy: p.updatedBy || ""
      };
    }

    const interactions = {};
    for (const it of interactionRows) {
      (interactions[it.partitionKey] = interactions[it.partitionKey] || []).push({
        id: it.rowKey,
        type: it.type || "khac",
        content: it.content || "",
        outcome: it.outcome || "",
        happenedAt: it.happenedAt || it.createdAt,
        createdBy: it.createdBy || "",
        createdAt: it.createdAt
      });
    }
    Object.values(interactions).forEach(list => list.sort((a, b) => new Date(b.happenedAt) - new Date(a.happenedAt)));

    // ---- Tóm tắt theo quyền ----
    const gradeSummary = {};
    if (can("grades")) {
      for (const g of await listAll("Grades")) {
        const k = keyOf(g.partitionKey, g.studentName);
        const s = gradeSummary[k] || (gradeSummary[k] = { count: 0, scored: 0, total: 0, last: null });
        s.count++;
        const score = Number(g.score);
        if (g.score !== undefined && g.score !== null && g.score !== "" && !isNaN(score)) { s.scored++; s.total += score; }
        if (!s.last || new Date(g.recordedAt) > new Date(s.last.recordedAt)) {
          s.last = { term: g.term || "", score: g.score != null ? g.score : null, comment: g.comment || "", recordedAt: g.recordedAt };
        }
      }
    }

    const tuitionSummary = {};
    if (can("tuition")) {
      for (const t of await listAll("TuitionPayments")) {
        const k = keyOf(t.partitionKey, t.studentName);
        const s = tuitionSummary[k] || (tuitionSummary[k] = { paid: 0, count: 0, pending: 0, lastPeriod: "", lastPaidAt: null });
        s.count++;
        s.paid += Number(t.amount) || 0;
        if ((t.confirmationStatus || "pending") === "pending") s.pending++;
        const at = t.paidAt || t.recordedAt;
        if (!s.lastPaidAt || new Date(at) > new Date(s.lastPaidAt)) { s.lastPaidAt = at; s.lastPeriod = t.period || ""; }
      }
    }

    const attendanceSummary = {};
    if (can("attendance")) {
      const since = Date.now() - 30 * 24 * 60 * 60 * 1000;
      for (const a of await listAll("Attendance")) {
        if (!a.studentId) continue;
        const s = attendanceSummary[a.studentId] || (attendanceSummary[a.studentId] = { present: 0, absent: 0, late: 0, absent30: 0, lastDate: "" });
        const st = a.status || "present";
        if (s[st] !== undefined) s[st]++;
        if (st === "absent" && new Date(a.date).getTime() >= since) s.absent30++;
        if (!s.lastDate || a.date > s.lastDate) s.lastDate = a.date;
      }
    }

    const students = studentRows.map(e => {
      let programs = [];
      try { programs = JSON.parse(e.programsJson || "[]"); } catch (err) { programs = []; }
      if (!Array.isArray(programs) || !programs.length) programs = e.program ? [e.program] : [];
      const k = keyOf(e.partitionKey, e.studentName);
      return {
        id: e.rowKey,
        parentEmail: e.partitionKey,
        studentName: e.studentName || "",
        dob: e.dob || "",
        programs,
        note: e.note || "",
        enrolledAt: e.enrolledAt || null,
        profile: profiles[e.rowKey] || null,
        interactions: interactions[e.rowKey] || [],
        grades: can("grades") ? (gradeSummary[k] || null) : undefined,
        tuition: can("tuition") ? (tuitionSummary[k] || null) : undefined,
        attendance: can("attendance") ? (attendanceSummary[e.rowKey] || null) : undefined
      };
    }).sort((a, b) => a.studentName.localeCompare(b.studentName, "vi"));

    context.res.status = 200;
    context.res.body = {
      success: true,
      students,
      access: { grades: can("grades"), tuition: can("tuition"), attendance: can("attendance") }
    };
  } catch (err) {
    context.log.error("Lỗi tải dữ liệu CRM:", err.message);
    context.res.status = 500;
    context.res.body = { success: false, message: "Đã có lỗi xảy ra, vui lòng thử lại sau." };
  }
};
