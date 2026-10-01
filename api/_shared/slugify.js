// Chuyển tiêu đề tiếng Việt có dấu thành slug không dấu, chữ thường, nối bằng dấu gạch ngang —
// khớp định dạng slug đang dùng cho các bài viết tĩnh sẵn có trong content/posts-index.json.
function slugify(text) {
  return String(text || "")
    .normalize("NFD").replace(/[\u0300-\u036f]/g, "") // bỏ dấu
    .replace(/đ/g, "d").replace(/Đ/g, "D")
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, "")
    .trim()
    .replace(/\s+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");
}

module.exports = { slugify };
