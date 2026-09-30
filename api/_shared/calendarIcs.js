// Tạo lịch học dạng iCalendar (.ics) lặp hằng tuần, nhắc trước giờ học 1 tiếng.
const DAYMAP = [["chủ nhật", "SU"], ["cn", "SU"], ["thứ 2", "MO"], ["thứ hai", "MO"], ["t2", "MO"], ["thứ 3", "TU"], ["thứ ba", "TU"], ["t3", "TU"],
  ["thứ 4", "WE"], ["thứ tư", "WE"], ["t4", "WE"], ["thứ 5", "TH"], ["thứ năm", "TH"], ["t5", "TH"], ["thứ 6", "FR"], ["thứ sáu", "FR"], ["t6", "FR"],
  ["thứ 7", "SA"], ["thứ bảy", "SA"], ["t7", "SA"]];
function byDays(text) {
  const t = " " + String(text || "").toLowerCase().replace(/[,;/+&-]/g, " ").replace(/\s+/g, " ") + " ";
  const out = [];
  DAYMAP.forEach(([k, c]) => { if (t.includes(" " + k + " ") && !out.includes(c)) out.push(c); });
  (t.match(/thứ\s+([2-7](\s+[2-7])*)/g) || []).forEach(m => m.replace(/[2-7]/g, n => { const c = ["", "", "MO", "TU", "WE", "TH", "FR", "SA"][n]; if (!out.includes(c)) out.push(c); return n; }));
  return out;
}
const esc = s => String(s || "").replace(/\\/g, "\\\\").replace(/[,;]/g, m => "\\" + m).replace(/\r?\n/g, "\\n");
function buildIcs(schedules, calName) {
  const pad = n => String(n).padStart(2, "0");
  const stamp = new Date().toISOString().replace(/[-:]/g, "").slice(0, 15) + "Z";
  const IDX = ["SU", "MO", "TU", "WE", "TH", "FR", "SA"];
  const lines = ["BEGIN:VCALENDAR", "VERSION:2.0", "PRODID:-//Tri thuc Viet//Lich hoc//VI", "CALSCALE:GREGORIAN", "METHOD:PUBLISH",
    "X-WR-CALNAME:" + esc(calName || "Lịch học Tri thức Việt"), "X-WR-TIMEZONE:Asia/Ho_Chi_Minh", "REFRESH-INTERVAL;VALUE=DURATION:PT6H", "X-PUBLISHED-TTL:PT6H",
    "BEGIN:VTIMEZONE", "TZID:Asia/Ho_Chi_Minh", "BEGIN:STANDARD", "DTSTART:19700101T000000", "TZOFFSETFROM:+0700", "TZOFFSETTO:+0700", "TZNAME:ICT", "END:STANDARD", "END:VTIMEZONE"];
  (schedules || []).forEach((s, i) => {
    const days = byDays(s.days); const st = String(s.startTime || "").match(/(\d{1,2}):(\d{2})/), en = String(s.endTime || "").match(/(\d{1,2}):(\d{2})/);
    if (!days.length || !st) return;
    const d = new Date(Date.now() + 7 * 3600e3); d.setUTCHours(0, 0, 0, 0);
    while (!days.includes(IDX[d.getUTCDay()])) d.setUTCDate(d.getUTCDate() + 1);
    const ds = d.getUTCFullYear() + pad(d.getUTCMonth() + 1) + pad(d.getUTCDate());
    const endT = en ? pad(en[1]) + en[2] : pad(Number(st[1]) + 1) + st[2];
    const uidBase = String(s.program || "lop").normalize("NFD").replace(/[^A-Za-z0-9]/g, "").slice(0, 20) + "-" + days.join("") + "-" + pad(st[1]) + st[2];
    lines.push("BEGIN:VEVENT", `UID:${uidBase}-${i}@wvn.vn`, "DTSTAMP:" + stamp,
      `DTSTART;TZID=Asia/Ho_Chi_Minh:${ds}T${pad(st[1])}${st[2]}00`, `DTEND;TZID=Asia/Ho_Chi_Minh:${ds}T${endT}00`,
      "RRULE:FREQ=WEEKLY;BYDAY=" + days.join(","), "SUMMARY:" + esc(s.program || "Buổi học"), "LOCATION:" + esc(s.location || ""),
      "DESCRIPTION:" + esc((s.teacherName ? "Giáo viên: " + s.teacherName : "") + (s.note ? (s.teacherName ? " · " : "") + s.note : "")),
      "BEGIN:VALARM", "TRIGGER:-PT60M", "ACTION:DISPLAY", "DESCRIPTION:" + esc("Sắp đến giờ học " + (s.program || "")), "END:VALARM", "END:VEVENT");
  });
  lines.push("END:VCALENDAR");
  return lines.join("\r\n") + "\r\n";
}
module.exports = { buildIcs, byDays };
