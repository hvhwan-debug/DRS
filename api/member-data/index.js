const { getTableClient } = require("../_shared/tableStorage");

const SESSION_TABLE = "AuthSessions";
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

function getBearerToken(req) {
  const header = req.headers && (req.headers.authorization || req.headers.Authorization);
  if (!header) return null;
  const match = /^Bearer\s+(.+)$/i.exec(header.trim());
  return match ? match[1] : null;
}

module.exports = async function (context, req) {
  context.res = { headers: { "Content-Type": "application/json" } };

  const token = getBearerToken(req);
  if (!token) {
    context.res.status = 401;
    context.res.body = { success: false, message: "Chưa đăng nhập." };
    return;
  }

  try {
    const sessionTable = await getTableClient(SESSION_TABLE);
    let session;
    try {
      session = await sessionTable.getEntity("session", token);
    } catch (err) {
      if (err.statusCode === 404) {
        context.res.status = 401;
        context.res.body = { success: false, message: "Phiên đăng nhập không hợp lệ." };
        return;
      }
      throw err;
    }

    if (new Date(session.expiresAt).getTime() < Date.now()) {
      context.res.status = 401;
      context.res.body = { success: false, message: "Phiên đăng nhập đã hết hạn." };
      return;
    }

    const email = session.email;
    const regTable = await getTableClient(REGISTRATIONS_TABLE);

    const registrations = [];
    const iterator = regTable.listEntities({
      queryOptions: { filter: `PartitionKey eq '${email.replace(/'/g, "''")}'` }
    });
    for await (const entity of iterator) {
      let data = {};
      try { data = JSON.parse(entity.dataJson || "{}"); } catch (e) { /* bỏ qua nếu lỗi parse */ }
      registrations.push({
        formType: entity.formType,
        formTitle: FORM_TITLES[entity.formType] || entity.formType,
        submittedAt: entity.submittedAt,
        data
      });
    }

    registrations.sort((a, b) => new Date(b.submittedAt) - new Date(a.submittedAt));

    context.res.status = 200;
    context.res.body = { success: true, email, registrations };
  } catch (err) {
    context.log.error("Lỗi lấy dữ liệu thành viên:", err.message);
    context.res.status = 500;
    context.res.body = { success: false, message: "Đã có lỗi xảy ra, vui lòng thử lại sau." };
  }
};
