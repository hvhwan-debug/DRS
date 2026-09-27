// Hằng số & tiện ích dùng chung cho module CRM Học Sinh.
// Dữ liệu CRM được lưu ở 2 bảng RIÊNG, không sửa cấu trúc bảng Students đang chạy:
//  - StudentCrm          : hồ sơ chăm sóc mở rộng, 1 dòng / học sinh (PK "crm", RK = id học sinh)
//  - StudentInteractions : lịch sử chăm sóc (PK = id học sinh, RK = thời điểm + ngẫu nhiên)

const CRM_TABLE = "StudentCrm";
const INTERACTIONS_TABLE = "StudentInteractions";
const CRM_PARTITION = "crm";

const STAGES = ["tiem-nang", "hoc-thu", "dang-hoc", "tam-nghi", "da-nghi", "hoan-thanh"];
const DEFAULT_STAGE = "dang-hoc";
const PRIORITIES = ["thuong", "cao", "khan"];
const INTERACTION_TYPES = ["goi-dien", "zalo", "gap-mat", "email", "tham-nha", "phan-hoi-hoc-tap", "khac"];

function clean(value, max) {
  return String(value == null ? "" : value).trim().slice(0, max || 500);
}

function cleanDate(value) {
  const v = clean(value, 10);
  return /^\d{4}-\d{2}-\d{2}$/.test(v) ? v : "";
}

function cleanTags(input) {
  let arr = [];
  if (Array.isArray(input)) arr = input;
  else if (typeof input === "string") arr = input.split(",");
  return Array.from(new Set(arr.map(t => clean(t, 40)).filter(Boolean))).slice(0, 12);
}

// Id học sinh do hệ thống cũ sinh ra dạng "<timestamp>-<chuỗi ngẫu nhiên>". Chặn ký tự lạ để
// không thể dùng làm khoá bảng bất thường (Azure Table cấm / \ # ? trong khoá).
function isValidStudentId(id) {
  return /^[A-Za-z0-9_-]{1,80}$/.test(id);
}

module.exports = {
  CRM_TABLE, INTERACTIONS_TABLE, CRM_PARTITION,
  STAGES, DEFAULT_STAGE, PRIORITIES, INTERACTION_TYPES,
  clean, cleanDate, cleanTags, isValidStudentId
};
