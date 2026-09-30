// =====================================================================================
// Quy định NƠI chấm công — quản lý (quyền "payroll" / Quản trị viên chính) tự đặt ở
// Chấm Công → Quy định chấm công. Lưu ở bảng PayrollSettings (pk "settings", rk "clock").
//
// Khi BẬT, bấm "Vào ca" (và tuỳ chọn cả "Kết thúc ca") chỉ được chấp nhận nếu thoả ÍT NHẤT 1 điều kiện:
//   • Mạng trung tâm: IP công cộng của máy nhân viên trùng 1 mạng đã khai báo. Trình duyệt không đọc
//     được tên Wi-Fi, nên nhận diện qua IP internet của đường mạng trung tâm (mọi máy dùng chung Wi-Fi
//     của trung tâm ra internet bằng cùng 1 IP). Hỗ trợ IPv4 chính xác / dải CIDR (vd 113.160.0.0/24),
//     IPv6 so theo 4 nhóm đầu (/64) vì phần đuôi IPv6 thay đổi liên tục.
//   • Vị trí: toạ độ định vị của điện thoại nằm trong bán kính 1 địa điểm đã khai báo.
// Nhân viên được đánh dấu "chấm công từ xa" trong Hồ sơ lương thì không bị giới hạn.
// Không thoả -> không chấm được, nhưng vẫn có thể gửi "Bổ sung công" để quản lý duyệt.
// =====================================================================================
const { getTableClient } = require("./tableStorage");

const DEFAULTS = { enabled: false, applyToClockOut: false, networks: [], locations: [], updatedAt: null, updatedBy: "" };
const MAX_ACCURACY_M = 1000;   // định vị sai số lớn hơn -> yêu cầu thử lại ngoài trời / bật GPS chính xác
const ACCURACY_ALLOWANCE_M = 150; // cộng thêm tối đa phần sai số của điện thoại vào bán kính

async function getClockSettings() {
  const t = await getTableClient("PayrollSettings");
  try {
    const e = await t.getEntity("settings", "clock");
    const parse = (s, d) => { try { const v = JSON.parse(s || ""); return Array.isArray(v) ? v : d; } catch (err) { return d; } };
    return {
      enabled: e.enabled === true,
      applyToClockOut: e.applyToClockOut === true,
      networks: parse(e.networksJson, []),
      locations: parse(e.locationsJson, []),
      updatedAt: e.updatedAt || null,
      updatedBy: e.updatedBy || ""
    };
  } catch (err) { if (err.statusCode === 404) return { ...DEFAULTS }; throw err; }
}

async function saveClockSettings(input, by) {
  const clean = (v, n) => String(v || "").trim().slice(0, n);
  const networks = (Array.isArray(input.networks) ? input.networks : []).slice(0, 20)
    .map(n => ({ name: clean(n.name, 60) || "Mạng trung tâm", ip: normalizeIp(clean(n.ip, 60)) || clean(n.ip, 60) }))
    .filter(n => isValidRule(n.ip));
  const locations = (Array.isArray(input.locations) ? input.locations : []).slice(0, 20)
    .map(l => ({ name: clean(l.name, 80) || "Địa điểm", lat: Number(l.lat), lng: Number(l.lng), radius: Math.max(30, Math.min(5000, Math.round(Number(l.radius) || 200))) }))
    .filter(l => isFinite(l.lat) && isFinite(l.lng) && Math.abs(l.lat) <= 90 && Math.abs(l.lng) <= 180 && !(l.lat === 0 && l.lng === 0));
  const enabled = input.enabled === true;
  if (enabled && !networks.length && !locations.length) {
    const e = new Error("Cần khai báo ít nhất 1 mạng trung tâm hoặc 1 địa điểm trước khi bật giới hạn."); e.status = 400; throw e;
  }
  const now = new Date().toISOString();
  const t = await getTableClient("PayrollSettings");
  await t.upsertEntity({
    partitionKey: "settings", rowKey: "clock", enabled, applyToClockOut: input.applyToClockOut === true,
    networksJson: JSON.stringify(networks), locationsJson: JSON.stringify(locations), updatedAt: now, updatedBy: by || ""
  }, "Replace");
  return { enabled, applyToClockOut: input.applyToClockOut === true, networks, locations, updatedAt: now, updatedBy: by || "" };
}

// ---------- IP ----------
// IP thật của người dùng từ header của Azure Static Web Apps / Front Door (bỏ cổng, bỏ ngoặc IPv6)
function clientIp(req) {
  const h = (req && req.headers) || {};
  const raw = String(h["x-azure-clientip"] || h["x-client-ip"] || h["x-forwarded-for"] || "").split(",")[0].trim();
  return normalizeIp(raw);
}
function normalizeIp(ip) {
  ip = String(ip || "").trim();
  if (!ip) return "";
  if (ip.includes("/")) return ip.toLowerCase(); // dải CIDR giữ nguyên
  const v6 = ip.match(/^\[([0-9a-f:]+)\](?::\d+)?$/i);
  if (v6) return v6[1].toLowerCase();
  const v4port = ip.match(/^(\d{1,3}(?:\.\d{1,3}){3})(?::\d+)?$/);
  if (v4port) return v4port[1];
  const mapped = ip.match(/^::ffff:(\d{1,3}(?:\.\d{1,3}){3})$/i);
  if (mapped) return mapped[1];
  return ip.toLowerCase();
}
const isV4 = ip => /^\d{1,3}(\.\d{1,3}){3}$/.test(ip) && ip.split(".").every(n => Number(n) <= 255);
const isV6 = ip => /^[0-9a-f:]+$/i.test(ip) && ip.includes(":");
function isValidRule(r) {
  if (!r) return false;
  const [base, bits] = r.split("/");
  if (bits !== undefined) return isV4(base) && /^\d+$/.test(bits) && Number(bits) >= 8 && Number(bits) <= 32;
  return isV4(r) || isV6(r);
}
const v4num = ip => ip.split(".").reduce((a, n) => (a * 256) + Number(n), 0);
function expandV6(ip) {
  const [head, tail] = ip.split("::");
  const h = head ? head.split(":") : [], t = tail !== undefined ? (tail ? tail.split(":") : []) : [];
  const fill = tail !== undefined ? Array(Math.max(0, 8 - h.length - t.length)).fill("0") : [];
  return [...h, ...fill, ...t].map(x => x.padStart(4, "0")).slice(0, 8);
}
function ipMatches(ip, rule) {
  ip = normalizeIp(ip); rule = String(rule || "").trim().toLowerCase();
  if (!ip || !rule) return false;
  if (rule.includes("/")) {
    const [base, bits] = rule.split("/");
    if (!isV4(ip) || !isV4(base)) return false;
    const mask = Number(bits) === 0 ? 0 : (0xffffffff << (32 - Number(bits))) >>> 0;
    return ((v4num(ip) & mask) >>> 0) === ((v4num(base) & mask) >>> 0);
  }
  if (isV4(ip) && isV4(rule)) return ip === rule;
  if (isV6(ip) && isV6(rule)) return expandV6(ip).slice(0, 4).join(":") === expandV6(rule).slice(0, 4).join(":");
  return false;
}

// ---------- Vị trí ----------
function distanceM(a, b) {
  const R = 6371000, rad = x => x * Math.PI / 180;
  const dLat = rad(b.lat - a.lat), dLng = rad(b.lng - a.lng);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return Math.round(2 * R * Math.asin(Math.sqrt(h)));
}
function cleanGeo(g) {
  if (!g || typeof g !== "object") return null;
  const lat = Number(g.lat), lng = Number(g.lng), accuracy = Math.max(0, Math.round(Number(g.accuracy) || 0));
  if (!isFinite(lat) || !isFinite(lng) || Math.abs(lat) > 90 || Math.abs(lng) > 180) return null;
  return { lat, lng, accuracy };
}

// ---------- Kiểm tra 1 lần chấm công ----------
// action: "in" | "out". Trả { ok, via, label, record, message, needGeo }
function checkPlace(settings, profile, ip, geoInput, action) {
  const geo = cleanGeo(geoInput);
  const record = { ip, geo, via: "", label: "" };
  if (!settings.enabled || (action === "out" && !settings.applyToClockOut)) return { ok: true, record };
  if (profile && profile.remoteAllowed) return { ok: true, via: "remote", label: "Được chấm công từ xa", record: { ...record, via: "remote", label: "Chấm từ xa (được phép)" } };

  const net = settings.networks.find(n => ipMatches(ip, n.ip));
  if (net) return { ok: true, via: "network", label: net.name, record: { ...record, via: "network", label: "Mạng: " + net.name } };

  if (!settings.locations.length) {
    return { ok: false, message: `Chỉ chấm công được khi dùng mạng Wi-Fi của trung tâm (${settings.networks.map(n => n.name).join(", ")}). Hãy kết nối Wi-Fi trung tâm và thử lại, hoặc gửi "Bổ sung công" để quản lý duyệt.` };
  }
  if (!geo) return { ok: false, needGeo: true, message: "Cần bật định vị để chấm công (hoặc kết nối Wi-Fi của trung tâm)." };
  if (geo.accuracy > MAX_ACCURACY_M) return { ok: false, needGeo: true, message: `Định vị chưa đủ chính xác (sai số khoảng ${geo.accuracy} m). Hãy bật "Vị trí chính xác", ra gần cửa sổ rồi thử lại.` };

  let best = null;
  for (const l of settings.locations) {
    const d = distanceM(geo, l);
    if (!best || d - l.radius < best.d - best.l.radius) best = { l, d };
  }
  const allowance = Math.min(geo.accuracy, ACCURACY_ALLOWANCE_M);
  if (best && best.d <= best.l.radius + allowance) {
    return { ok: true, via: "location", label: best.l.name, record: { ...record, via: "location", label: `Vị trí: ${best.l.name} (cách ${best.d} m)`, distance: best.d } };
  }
  const far = best ? (best.d >= 1000 ? (best.d / 1000).toFixed(1).replace(".", ",") + " km" : best.d + " m") : "";
  return { ok: false, message: `Bạn đang ở ngoài khu vực chấm công${best ? ` (cách ${best.l.name} khoảng ${far})` : ""}. Hãy chấm công khi tới nơi, hoặc gửi "Bổ sung công" để quản lý duyệt.` };
}

// Tóm tắt cho màn hình nhân viên — KHÔNG lộ IP hay toạ độ của trung tâm
function publicPolicy(settings, profile, ip) {
  const remote = !!(profile && profile.remoteAllowed);
  const net = settings.networks.find(n => ipMatches(ip, n.ip));
  return {
    enabled: settings.enabled && !remote,
    remoteAllowed: remote,
    applyToClockOut: settings.applyToClockOut,
    onNetwork: net ? net.name : "",
    networkNames: settings.networks.map(n => n.name),
    locationNames: settings.locations.map(l => l.name),
    usesLocation: settings.locations.length > 0
  };
}

module.exports = { getClockSettings, saveClockSettings, clientIp, normalizeIp, ipMatches, isValidRule, distanceM, checkPlace, publicPolicy };
