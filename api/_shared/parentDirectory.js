const { getTableClient } = require("./tableStorage");

// Danh bạ phụ huynh dùng chung cho admin & CRM: gộp HỒ SƠ THÀNH VIÊN (MemberProfiles — do chính
// phụ huynh cập nhật, tin cậy nhất) với ĐƠN ĐĂNG KÝ (Registrations — có tên/SĐT phụ huynh, tên trẻ,
// ngày sinh, trường lớp, địa chỉ). Hồ sơ thành viên được ưu tiên; đơn đăng ký chỉ bù chỗ còn trống,
// đơn mới hơn được ưu tiên hơn đơn cũ.

function norm(s) {
  return String(s || "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/đ/gi, "d").toLowerCase().replace(/\s+/g, " ").trim();
}
function childKey(email, childName) {
  return `${String(email || "").trim().toLowerCase()}|${norm(childName)}`;
}
function pick(obj, keys) {
  for (const k of keys) {
    const v = obj && obj[k];
    if (v !== undefined && v !== null && String(v).trim()) return String(v).trim();
  }
  return "";
}

async function buildParentDirectory() {
  const parents = {};  // email -> { name, phone, address }
  const children = {}; // childKey -> { dob, school, address, program, submittedAt }

  const setIfEmpty = (email, field, value) => {
    if (!email || !value) return;
    const p = parents[email] || (parents[email] = { name: "", phone: "", address: "" });
    if (!p[field]) p[field] = value;
  };

  try {
    const profiles = await getTableClient("MemberProfiles");
    for await (const e of profiles.listEntities()) {
      if (e.partitionKey !== "profile") continue;
      const email = String(e.rowKey || "").toLowerCase();
      setIfEmpty(email, "name", pick(e, ["fullName"]));
      setIfEmpty(email, "phone", pick(e, ["phone"]));
      setIfEmpty(email, "address", pick(e, ["address"]));
      if (e.referredBy) { const p = parents[email] || (parents[email] = { name: "", phone: "", address: "" }); p.referredBy = String(e.referredBy); }
    }
  } catch (err) { /* chưa có bảng -> bỏ qua */ }

  try {
    const regTable = await getTableClient("Registrations");
    const regs = [];
    for await (const e of regTable.listEntities()) regs.push(e);
    regs.sort((a, b) => new Date(b.submittedAt || 0) - new Date(a.submittedAt || 0));
    for (const r of regs) {
      let data = {};
      try { data = JSON.parse(r.dataJson || "{}"); } catch (e) { data = {}; }
      const email = (pick(data, ["email_phu_huynh", "email"]) || r.partitionKey || "").toLowerCase();
      if (!email) continue;
      setIfEmpty(email, "name", pick(data, ["ten_phu_huynh", "fullname", "fullName", "name", "ho_ten"]));
      setIfEmpty(email, "phone", pick(data, ["sdt_phu_huynh", "phone", "so_dien_thoai", "sdt"]));
      setIfEmpty(email, "address", pick(data, ["dia_chi", "phuong_xa"]));
      const child = pick(data, ["ten_tre", "hoc_sinh"]);
      if (child) {
        const k = childKey(email, child);
        if (!children[k]) {
          children[k] = {
            childName: child,
            dob: pick(data, ["ngay_sinh_tre"]),
            school: pick(data, ["truong_lop"]),
            address: pick(data, ["dia_chi", "phuong_xa"]),
            formType: r.formType || "",
            program: pick(data, ["chuong_trinh", "program", "khoa_hoc"]) || r.formType || "",
            status: r.status || "pending",
            email,
            submittedAt: r.submittedAt || null
          };
        }
      }
    }
  } catch (err) { /* chưa có bảng -> bỏ qua */ }

  return { parents, children };
}

module.exports = { buildParentDirectory, childKey, norm };
