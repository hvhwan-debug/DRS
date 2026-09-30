const { getTableClient } = require("../_shared/tableStorage");
const { buildIcs } = require("../_shared/calendarIcs");

// Lịch học ĐĂNG KÝ THEO DÕI (webcal) cho từng gia đình: GET /api/member-calendar?k=<mã lịch riêng>
// Ứng dụng lịch (iPhone, Google Calendar, Outlook) tự tải lại vài giờ một lần, nên khi trung tâm đổi lịch học
// thì lịch trên điện thoại của phụ huynh tự cập nhật. Mã lịch là chuỗi ngẫu nhiên, không lộ email.
const SCHEDULE_TABLE = "ClassSchedules";
module.exports = async function (context, req) {
  const k = String((req.query && req.query.k) || "").replace(/\.ics$/i, "");
  const fail = (code, msg) => { context.res = { status: code, headers: { "Content-Type": "text/plain; charset=utf-8" }, body: msg }; };
  if (!/^[a-f0-9]{24}$/.test(k)) return fail(400, "Liên kết lịch không hợp lệ.");
  try {
    const profiles = await getTableClient("MemberProfiles");
    let email = null;
    for await (const p of profiles.listEntities({ queryOptions: { filter: `calendarKey eq '${k}'`, select: ["rowKey"] } })) { email = String(p.rowKey).toLowerCase(); break; }
    if (!email) return fail(404, "Không tìm thấy lịch.");
    const q = email.replace(/'/g, "''");
    const programs = new Set();
    try { const st = await getTableClient("Students"); for await (const s of st.listEntities({ queryOptions: { filter: `PartitionKey eq '${q}'` } })) { if (s.program) programs.add(s.program); try { JSON.parse(s.programsJson || "[]").forEach(x => programs.add(x)); } catch (e) {} } } catch (e) {}
    try { const tp = await getTableClient("TuitionPayments"); for await (const t of tp.listEntities({ queryOptions: { filter: `PartitionKey eq '${q}'`, select: ["program"] } })) if (t.program) programs.add(t.program); } catch (e) {}
    const schedules = [];
    try { const sc = await getTableClient(SCHEDULE_TABLE); for await (const e of sc.listEntities()) if (programs.has(e.program)) schedules.push({ program: e.program, days: e.days, startTime: e.startTime, endTime: e.endTime, location: e.location, teacherName: e.teacherName, note: e.note }); } catch (e) {}
    context.res = { status: 200, headers: { "Content-Type": "text/calendar; charset=utf-8", "Content-Disposition": 'inline; filename="lich-hoc-tri-thuc-viet.ics"', "Cache-Control": "public, max-age=1800" }, body: buildIcs(schedules, "Lịch học Tri thức Việt") };
  } catch (err) {
    context.log.error("Lỗi lịch học:", err.message);
    fail(500, "Đã có lỗi xảy ra.");
  }
};
