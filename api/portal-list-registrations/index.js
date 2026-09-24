const { getTableClient } = require("../_shared/tableStorage");
const { requireAdmin } = require("../_shared/adminAuth");

const REGISTRATIONS_TABLE = "Registrations";

const FORM_TITLES = {
  contact: "Liên hệ",
  volunteer: "Đăng ký tình nguyện viên",
  item: "Đăng ký gây quỹ hiện vật",
  donor: "Đăng ký trở thành nhà tài trợ",
  support: "Yêu cầu kết nối hỗ trợ",
  newsletter: "Đăng ký nhận bản tin",
  luyen_chu_phu_huynh: "Đăng ký Luyện Chữ Đẹp — Phụ huynh",
  luyen_chu_tinh_nguyen: "Đăng ký Luyện Chữ Đẹp — Tình nguyện viên",
  luyen_chu_tai_tro: "Đăng ký Luyện Chữ Đẹp — Nhà tài trợ",
  tien_tieu_hoc: "Đăng ký Chương Trình Tiền Tiểu Học"
};

module.exports = async function (context, req) {
  context.res = { headers: { "Content-Type": "application/json" } };

  if (!(await requireAdmin(context, req))) return;

  try {
    const regTable = await getTableClient(REGISTRATIONS_TABLE);
    const registrations = [];

    for await (const entity of regTable.listEntities()) {
      let data = {};
      try { data = JSON.parse(entity.dataJson || "{}"); } catch (e) { /* bỏ qua nếu lỗi parse */ }
      registrations.push({
        email: entity.partitionKey,
        id: entity.rowKey,
        formType: entity.formType,
        formTitle: FORM_TITLES[entity.formType] || entity.formType,
        status: entity.status || "Đã ghi nhận",
        submittedAt: entity.submittedAt,
        data
      });
    }

    registrations.sort((a, b) => new Date(b.submittedAt) - new Date(a.submittedAt));

    context.res.status = 200;
    context.res.body = { success: true, registrations };
  } catch (err) {
    context.log.error("Lỗi lấy danh sách đăng ký (admin):", err.message);
    context.res.status = 500;
    context.res.body = { success: false, message: "Đã có lỗi xảy ra, vui lòng thử lại sau." };
  }
};
