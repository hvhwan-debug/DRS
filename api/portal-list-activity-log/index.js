const { getTableClient } = require("../_shared/tableStorage");
const { requireSuperAdmin } = require("../_shared/adminAuth");
const { ACTIVITY_LOG_TABLE } = require("../_shared/activityLog");

// Tra cứu nhật ký thao tác — KHÔNG giới hạn thời gian lưu: mọi dòng được giữ vĩnh viễn trong bảng
// AdminActivityLog (không có tác vụ nào tự xoá). API cho phép lọc theo:
//   from / to  : khoảng ngày YYYY-MM-DD (lọc thẳng trên PartitionKey = ngày, nên nhanh kể cả khi nhiều năm)
//   actor      : email người thao tác
//   action     : đúng tên hành động
//   q          : từ khoá tìm trong người thao tác / hành động / chi tiết (không phân biệt dấu, hoa thường)
//   limit, offset : phân trang (mặc định 200 dòng/lần, tối đa 5000)
// Trả kèm danh sách người thao tác & hành động có trong khoảng ngày để dựng bộ lọc.
const DAY = /^\d{4}-\d{2}-\d{2}$/;
const norm = s => String(s || "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/đ/g, "d").replace(/Đ/g, "D").toLowerCase();

module.exports = async function (context, req) {
  context.res = { headers: { "Content-Type": "application/json" } };
  if (!(await requireSuperAdmin(context, req))) return;

  const p = Object.assign({}, req.query || {}, (req.method === "POST" && req.body) || {});
  const from = DAY.test(p.from || "") ? p.from : "";
  const to = DAY.test(p.to || "") ? p.to : "";
  const actor = String(p.actor || "").trim().toLowerCase();
  const action = String(p.action || "").trim();
  const q = norm(String(p.q || "").trim());
  const limit = Math.min(Math.max(parseInt(p.limit, 10) || 200, 1), 5000);
  const offset = Math.max(parseInt(p.offset, 10) || 0, 0);

  try {
    const table = await getTableClient(ACTIVITY_LOG_TABLE);
    const filters = [];
    if (from) filters.push(`PartitionKey ge '${from}'`);
    if (to) filters.push(`PartitionKey le '${to}'`);
    const opts = filters.length ? { queryOptions: { filter: filters.join(" and ") } } : undefined;

    const all = [];
    for await (const e of table.listEntities(opts)) {
      all.push({
        adminName: e.adminName || "",
        adminEmail: e.adminEmail || "",
        action: e.action || "",
        details: e.details || "",
        createdAt: e.createdAt || ""
      });
    }

    // Bộ lọc dựng từ toàn bộ khoảng ngày (trước khi lọc người/hành động/từ khoá)
    const actors = {}; const actions = {};
    all.forEach(e => {
      const k = e.adminEmail || e.adminName;
      if (k && !actors[k]) actors[k] = e.adminName || e.adminEmail;
      if (e.action) actions[e.action] = (actions[e.action] || 0) + 1;
    });

    let rows = all;
    if (actor) rows = rows.filter(e => (e.adminEmail || "").toLowerCase() === actor || norm(e.adminName) === norm(actor));
    if (action) rows = rows.filter(e => e.action === action);
    if (q) rows = rows.filter(e => norm(`${e.adminName} ${e.adminEmail} ${e.action} ${e.details}`).includes(q));
    rows.sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)));

    const oldest = all.reduce((m, e) => (!m || (e.createdAt && e.createdAt < m) ? e.createdAt : m), "");
    context.res.status = 200;
    context.res.body = {
      success: true,
      total: rows.length,
      offset,
      entries: rows.slice(offset, offset + limit),
      hasMore: offset + limit < rows.length,
      oldestAt: oldest,
      actors: Object.entries(actors).map(([key, name]) => ({ key, name })).sort((a, b) => a.name.localeCompare(b.name, "vi")),
      actions: Object.entries(actions).map(([name, count]) => ({ name, count })).sort((a, b) => a.name.localeCompare(b.name, "vi"))
    };
  } catch (err) {
    context.log.error("Lỗi lấy nhật ký thao tác:", err.message);
    context.res.status = 500;
    context.res.body = { success: false, message: "Đã có lỗi xảy ra, vui lòng thử lại sau." };
  }
};
