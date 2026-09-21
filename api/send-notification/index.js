const sgMail = require("@sendgrid/mail");

// ===== Tên hiển thị cho từng loại biểu mẫu =====
const FORM_TITLES = {
  contact: "Liên hệ mới từ website",
  volunteer: "Đăng ký tình nguyện viên mới",
  item: "Đăng ký gây quỹ hiện vật mới",
  donor: "Đăng ký trở thành nhà tài trợ mới",
  support: "Yêu cầu kết nối hỗ trợ mới",
  newsletter: "Đăng ký nhận bản tin mới",
  luyen_chu_phu_huynh: "Đăng ký Luyện Chữ Đẹp — Phụ huynh mới",
  luyen_chu_tinh_nguyen: "Đăng ký Luyện Chữ Đẹp — Tình nguyện viên mới",
  luyen_chu_tai_tro: "Đăng ký Luyện Chữ Đẹp — Nhà tài trợ mới",
  tien_tieu_hoc: "Đăng ký Chương Trình Tiền Tiểu Học mới"
};

// ===== Nội dung email cảm ơn/xác nhận gửi lại cho chính người gửi form =====
const AUTOREPLY_INTRO = {
  contact: "Cảm ơn bạn đã liên hệ với Mạng Lưới Tri Thức Việt Nam. Chúng tôi đã nhận được tin nhắn của bạn và đội ngũ sẽ phản hồi trong vòng 1-2 ngày làm việc.",
  volunteer: "Cảm ơn bạn đã đăng ký trở thành tình nguyện viên. Chúng tôi đã nhận được thông tin đăng ký và đội ngũ điều phối sẽ liên hệ với bạn trong 3-5 ngày tới.",
  item: "Cảm ơn bạn đã đăng ký gây quỹ bằng hiện vật. Chúng tôi đã nhận được thông tin và sẽ liên hệ để xác nhận, hướng dẫn cách gửi hiện vật sớm nhất.",
  donor: "Cảm ơn bạn đã quan tâm trở thành nhà tài trợ. Chúng tôi đã nhận được thông tin đăng ký và đội ngũ sẽ liên hệ trong vòng 48 giờ để hướng dẫn hoàn tất tài trợ.",
  support: "Cảm ơn bạn đã tin tưởng chia sẻ. Chúng tôi đã nhận được thông tin và đội ngũ chương trình sẽ liên hệ để tìm hiểu, hỗ trợ trong thời gian sớm nhất.",
  newsletter: "Cảm ơn bạn đã đăng ký nhận bản tin. Chúng tôi đã ghi nhận email của bạn và sẽ gửi những tin tức, hoạt động mới nhất từ Mạng Lưới Tri Thức Việt Nam.",
  luyen_chu_phu_huynh: "Cảm ơn bạn đã đăng ký Chương trình Luyện chữ đẹp cho con em. Ban phụ trách sẽ xem xét hồ sơ và thông báo kết quả xét duyệt trong thời gian sớm nhất.",
  luyen_chu_tinh_nguyen: "Cảm ơn bạn đã đăng ký làm tình nguyện viên cho Chương trình Luyện chữ đẹp. Đội ngũ điều phối sẽ liên hệ với bạn trong thời gian sớm nhất.",
  luyen_chu_tai_tro: "Cảm ơn bạn đã quan tâm tài trợ cho Chương trình Luyện chữ đẹp. Đội ngũ điều phối sẽ liên hệ để trao đổi cụ thể trong thời gian sớm nhất.",
  tien_tieu_hoc: "Cảm ơn bạn đã đăng ký Chương trình Tiền Tiểu Học Miễn Phí 100% cho con em. Ban tổ chức sẽ xem xét hồ sơ và liên hệ thông báo kết quả trong thời gian sớm nhất."
};

// ===== Nhãn tiếng Việt cho từng trường dữ liệu (áp dụng cho mọi form) =====
const FIELD_LABELS = {
  fullname: "Họ và tên",
  fullName: "Họ và tên",
  name: "Họ và tên",
  email: "Email",
  phone: "Số điện thoại",
  subject: "Chủ đề",
  message: "Nội dung",
  loai_hien_vat: "Loại hiện vật",
  so_luong: "Số lượng ước tính",
  hinh_thuc_gui: "Hình thức gửi",
  ghi_chu: "Ghi chú",
  hinh_thuc: "Hình thức tham gia",
  thoi_gian: "Thời gian rảnh",
  muc_tai_tro: "Mức tài trợ",
  needType: "Loại hỗ trợ cần thiết",
  relation: "Vai trò liên hệ",
  address: "Địa chỉ hiện tại",
  detail: "Mô tả hoàn cảnh",
  beneficiaryName: "Họ tên người cần hỗ trợ",
  beneficiaryPhone: "SĐT người cần hỗ trợ",
  beneficiaryAddress: "Địa chỉ người cần hỗ trợ",
  location: "Vị trí GPS (của bạn)",
  beneficiaryLocation: "Vị trí GPS (người cần hỗ trợ)",
  dia_chi_thu_gom: "Địa chỉ cần thu gom",
  vi_tri_gps_thu_gom: "Vị trí GPS (thu gom)",
  ten_phu_huynh: "Họ tên phụ huynh/người giám hộ",
  sdt_phu_huynh: "SĐT phụ huynh/người giám hộ",
  email_phu_huynh: "Email phụ huynh/người giám hộ",
  ten_tre: "Họ tên trẻ",
  ngay_sinh_tre: "Ngày sinh của trẻ",
  truong_lop: "Trường/lớp đang học",
  phuong_xa: "Xã/Phường (Hà Nội)",
  dia_chi: "Địa chỉ",
  hoan_canh_ly_do: "Hoàn cảnh gia đình / Lý do đăng ký",
  nhu_cau: "Nhu cầu cần hỗ trợ của trẻ",
  doi_tuong_dang_ky: "Đối tượng đăng ký",
  ten_tnv: "Họ tên tình nguyện viên",
  sdt_tnv: "SĐT tình nguyện viên",
  email_tnv: "Email tình nguyện viên",
  kinh_nghiem: "Kinh nghiệm dạy học/luyện chữ",
  thoi_gian_tnv: "Thời gian có thể tham gia",
  loai_tnv: "Bạn là",
  truong_dang_hoc: "Trường đang học",
  nganh_hoc: "Ngành học",
  truong_giang_day: "Trường/đơn vị đang giảng dạy",
  mon_cap_day: "Môn/cấp đang dạy",
  nghe_nghiep: "Nghề nghiệp hiện tại",
  ghi_chu_tnv: "Ghi chú thêm",
  ten_tai_tro: "Họ tên / Tên đơn vị tài trợ",
  sdt_tai_tro: "SĐT nhà tài trợ",
  email_tai_tro: "Email nhà tài trợ",
  hinh_thuc_tai_tro: "Hình thức hỗ trợ",
  chi_tiet_tai_tro: "Chi tiết cụ thể",
  dia_diem_cu_the: "Địa điểm cụ thể",
  vi_tri_gps_dia_diem: "Vị trí GPS (địa điểm tài trợ)"
};

// Các trường chứa tọa độ "lat,lng" cần hiển thị thành link Google Maps bấm được
const LOCATION_FIELDS = new Set(["location", "beneficiaryLocation", "vi_tri_gps_thu_gom", "vi_tri_gps_dia_diem"]);

// Các trường ẩn / kỹ thuật không hiển thị trong email
const SKIP_FIELDS = new Set(["_subject", "_captcha", "_honey", "_template", "formType"]);

// ===== Tích hợp Monday.com CRM (board "Marketing Contacts") =====
const MONDAY_BOARD_ID = 5031435768;

// Mỗi form dùng tên trường khác nhau -> thử lần lượt theo thứ tự ưu tiên
function pickField(data, keys) {
  for (const k of keys) {
    if (data[k] !== undefined && data[k] !== null && String(data[k]).trim() !== "") {
      return String(data[k]).trim();
    }
  }
  return "";
}

// Dựng nội dung tóm tắt toàn bộ trường của form (dùng để đính kèm vào Update trên Monday)
function buildMondayUpdateText(data, title) {
  const lines = [`📋 ${title}`, ""];
  for (const [key, value] of Object.entries(data)) {
    if (SKIP_FIELDS.has(key) || value === undefined || value === null || String(value).trim() === "") {
      continue;
    }
    const label = FIELD_LABELS[key] || key;
    lines.push(`${label}: ${value}`);
  }
  return lines.join("\n");
}

async function callMondayApi(token, query, variables) {
  const res = await fetch("https://api.monday.com/v2", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Authorization": token
    },
    body: JSON.stringify({ query, variables })
  });
  const json = await res.json();
  if (json.errors) {
    throw new Error(JSON.stringify(json.errors));
  }
  return json.data;
}

async function createMondayItem(formType, data, title) {
  const token = process.env.MONDAY_API_TOKEN;
  if (!token) {
    return; // Chưa cấu hình MONDAY_API_TOKEN -> bỏ qua âm thầm, không ảnh hưởng luồng chính
  }

  const fullName = pickField(data, [
    "fullname", "fullName", "name",
    "ten_phu_huynh", "ten_tre",
    "ten_tnv",
    "ten_tai_tro"
  ]) || "Người gửi form";

  const email = pickField(data, ["email", "email_phu_huynh", "email_tnv", "email_tai_tro"]);
  const phone = pickField(data, ["phone", "sdt_phu_huynh", "sdt_tnv", "sdt_tai_tro"]);

  const columnValues = {
    marketing_contact_first_name: fullName
  };
  if (email) {
    columnValues.marketing_contact_email = { email, text: email };
  }
  if (phone) {
    columnValues.marketing_contact_phone = { phone, countryShortName: "VN" };
  }

  const itemName = `${fullName} — ${title}`;

  const createItemQuery = `
    mutation ($boardId: ID!, $itemName: String!, $columnValues: JSON!) {
      create_item(board_id: $boardId, item_name: $itemName, column_values: $columnValues) {
        id
      }
    }
  `;

  const itemData = await callMondayApi(token, createItemQuery, {
    boardId: MONDAY_BOARD_ID,
    itemName,
    columnValues: JSON.stringify(columnValues)
  });

  const itemId = itemData && itemData.create_item && itemData.create_item.id;
  if (!itemId) {
    return;
  }

  // Đính kèm toàn bộ chi tiết form vào phần Update của item (mọi trường, mọi loại form)
  const updateBody = buildMondayUpdateText(data, title);
  const createUpdateQuery = `
    mutation ($itemId: ID!, $body: String!) {
      create_update(item_id: $itemId, body: $body) {
        id
      }
    }
  `;
  await callMondayApi(token, createUpdateQuery, { itemId, body: updateBody });
}

function escapeHtml(str) {
  return String(str ?? "").replace(/[&<>"']/g, (c) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"
  }[c]));
}

function buildRowsHtml(data) {
  return Object.entries(data)
    .filter(([key, value]) => !SKIP_FIELDS.has(key) && value !== undefined && value !== "")
    .map(([key, value]) => {
      const label = FIELD_LABELS[key] || key;
      const isLocation = LOCATION_FIELDS.has(key) && /^-?\d+\.?\d*,-?\d+\.?\d*$/.test(String(value).trim());
      const valueHtml = isLocation
        ? `<a href="https://www.google.com/maps?q=${encodeURIComponent(value)}" target="_blank" rel="noopener">📍 ${escapeHtml(value)} (xem trên Google Maps)</a>`
        : escapeHtml(value);
      return `
        <tr>
          <td style="padding:10px 14px;font-weight:600;color:#0f172a;background:#f8fafc;border-bottom:1px solid #e2e8f0;width:180px;font-size:13px;vertical-align:top;">${escapeHtml(label)}</td>
          <td style="padding:10px 14px;color:#334155;border-bottom:1px solid #e2e8f0;font-size:13px;white-space:pre-wrap;">${valueHtml}</td>
        </tr>`;
    })
    .join("");
}

function buildEmailHtml(title, rowsHtml) {
  return `<!DOCTYPE html>
<html lang="vi">
<head><meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1.0"></head>
<body style="margin:0;padding:0;background:#f1f5f9;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f1f5f9;padding:32px 16px;">
    <tr>
      <td align="center">
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:560px;background:#ffffff;border-radius:16px;overflow:hidden;box-shadow:0 8px 28px rgba(15,23,42,0.10);">

          <tr>
            <td bgcolor="#0f172a" style="background-color:#0f172a;background:linear-gradient(135deg,#0f172a 0%,#1e3a8a 50%,#0284c7 100%);padding:28px 32px;">
              <table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr>
                <td align="center" style="text-align:center;">
                  <img src="https://wvn.vn/images/logo-wvn.png" alt="WVN" width="56" style="display:block;height:auto;margin:0 auto 10px;">
                  <div style="color:#ffffff;font-size:17px;font-weight:800;line-height:1.3;">Mạng Lưới Tri Thức Việt Nam</div>
                  <div style="color:#bfdbfe;font-size:11px;font-weight:600;letter-spacing:0.2px;">WISDOM VIETNAM NETWORK | DR SOLUTIONS</div>
                </td>
              </tr></table>
            </td>
          </tr>

          <tr>
            <td style="padding:28px 32px 6px;">
              <span style="display:inline-block;background:#e0f2fe;color:#0369a1;font-size:11px;font-weight:700;letter-spacing:0.4px;padding:5px 12px;border-radius:999px;">THÔNG BÁO TỰ ĐỘNG TỪ WEBSITE</span>
              <h1 style="font-size:20px;line-height:1.35;color:#0f172a;margin:14px 0 6px;font-weight:800;">${escapeHtml(title)}</h1>
              <p style="font-size:13px;color:#64748b;margin:0 0 22px;line-height:1.6;">Có người vừa gửi thông tin qua biểu mẫu trên website <strong>wvn.vn</strong>. Chi tiết bên dưới:</p>
            </td>
          </tr>

          <tr>
            <td style="padding:0 32px 26px;">
              <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border:1px solid #e2e8f0;border-radius:10px;overflow:hidden;">
                ${rowsHtml}
              </table>
            </td>
          </tr>

          <tr>
            <td style="padding:0 32px 30px;">
              <a href="https://wvn.vn" style="display:inline-block;background:linear-gradient(135deg,#0284c7 0%,#2563eb 100%);color:#ffffff;text-decoration:none;font-weight:700;font-size:13px;padding:11px 22px;border-radius:8px;">Mở website wvn.vn →</a>
            </td>
          </tr>

          <tr>
            <td style="background:#f8fafc;padding:18px 32px;border-top:1px solid #e2e8f0;">
              <div style="font-size:11px;color:#94a3b8;line-height:1.6;">
                Đây là email tự động từ hệ thống website Mạng Lưới Tri Thức Việt Nam — vui lòng không trả lời trực tiếp email này.<br>
                Doanh nghiệp xã hội phi lợi nhuận đồng hành vì cơ hội học tập công bằng cho trẻ em vùng cao.
              </div>
            </td>
          </tr>

        </table>
      </td>
    </tr>
  </table>
</body>
</html>`;
}

function buildAutoReplyHtml(recipientName, introMessage) {
  const greeting = recipientName ? `Xin chào <strong>${escapeHtml(recipientName)}</strong>,` : "Xin chào,";
  return `<!DOCTYPE html>
<html lang="vi">
<head><meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1.0"></head>
<body style="margin:0;padding:0;background:#f1f5f9;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f1f5f9;padding:32px 16px;">
    <tr>
      <td align="center">
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:560px;background:#ffffff;border-radius:16px;overflow:hidden;box-shadow:0 8px 28px rgba(15,23,42,0.10);">

          <tr>
            <td bgcolor="#0f172a" style="background-color:#0f172a;background:linear-gradient(135deg,#0f172a 0%,#1e3a8a 50%,#0284c7 100%);padding:28px 32px;">
              <table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr>
                <td align="center" style="text-align:center;">
                  <img src="https://wvn.vn/images/logo-wvn.png" alt="WVN" width="56" style="display:block;height:auto;margin:0 auto 10px;">
                  <div style="color:#ffffff;font-size:17px;font-weight:800;line-height:1.3;">Mạng Lưới Tri Thức Việt Nam</div>
                  <div style="color:#bfdbfe;font-size:11px;font-weight:600;letter-spacing:0.2px;">WISDOM VIETNAM NETWORK | DR SOLUTIONS</div>
                </td>
              </tr></table>
            </td>
          </tr>

          <tr>
            <td style="padding:32px 32px 8px;">
              <span style="display:inline-block;background:#f0fdf4;color:#166534;font-size:11px;font-weight:700;letter-spacing:0.4px;padding:5px 12px;border-radius:999px;">✓ ĐÃ NHẬN ĐƯỢC THÔNG TIN</span>
              <h1 style="font-size:20px;line-height:1.35;color:#0f172a;margin:16px 0 14px;font-weight:800;">Chúng tôi đã nhận được thông tin của bạn</h1>
              <p style="font-size:14px;color:#334155;margin:0 0 12px;line-height:1.7;">${greeting}</p>
              <p style="font-size:14px;color:#334155;margin:0 0 22px;line-height:1.7;">${escapeHtml(introMessage)}</p>
            </td>
          </tr>

          <tr>
            <td style="padding:0 32px 30px;">
              <a href="https://wvn.vn" style="display:inline-block;background:linear-gradient(135deg,#0284c7 0%,#2563eb 100%);color:#ffffff;text-decoration:none;font-weight:700;font-size:13px;padding:11px 22px;border-radius:8px;">Xem thêm về Mạng Lưới Tri Thức Việt Nam →</a>
            </td>
          </tr>

          <tr>
            <td style="background:#f8fafc;padding:18px 32px;border-top:1px solid #e2e8f0;">
              <div style="font-size:11px;color:#94a3b8;line-height:1.6;">
                Đây là email tự động, vui lòng không trả lời trực tiếp email này. Cần hỗ trợ gấp? Liên hệ <a href="mailto:hotro@wvn.vn" style="color:#0284c7;">hotro@wvn.vn</a>.<br>
                Doanh nghiệp xã hội phi lợi nhuận đồng hành vì cơ hội học tập công bằng cho trẻ em vùng cao.
              </div>
            </td>
          </tr>

        </table>
      </td>
    </tr>
  </table>
</body>
</html>`;
}

module.exports = async function (context, req) {
  context.res = {
    headers: { "Content-Type": "application/json" }
  };

  const apiKey = process.env.SENDGRID_API_KEY;
  const fromEmail = process.env.SENDGRID_FROM_EMAIL;
  const toEmail = process.env.NOTIFY_TO_EMAIL || "hotro@wvn.vn";

  if (!apiKey || !fromEmail) {
    context.log.error("Thiếu SENDGRID_API_KEY hoặc SENDGRID_FROM_EMAIL trong Application settings.");
    context.res.status = 500;
    context.res.body = { success: false, message: "Hệ thống gửi email chưa được cấu hình." };
    return;
  }

  const body = req.body || {};
  const formType = body.formType || "contact";
  const data = body.data || {};

  // Honeypot chống spam đơn giản (nếu form có field ẩn _honey bị điền thì bỏ qua âm thầm)
  if (data._honey) {
    context.res.status = 200;
    context.res.body = { success: true };
    return;
  }

  const title = FORM_TITLES[formType] || "Thông báo mới từ website";
  const rowsHtml = buildRowsHtml(data);
  const adminHtml = buildEmailHtml(title, rowsHtml);

  sgMail.setApiKey(apiKey);

  const senderName = data.fullname || data.fullName || data.name || "";
  const senderEmail = (data.email || "").trim();

  // Đính kèm ảnh minh chứng (nếu form gửi kèm) — giới hạn tổng dung lượng
  // để tránh vượt hạn mức SendGrid (thường ~30MB mỗi email tính cả header).
  const MAX_TOTAL_ATTACHMENT_MB = 20;
  let attachments;
  if (Array.isArray(body.attachments) && body.attachments.length > 0) {
    let totalBytes = 0;
    attachments = [];
    for (const att of body.attachments) {
      if (!att || !att.content || !att.filename) continue;
      const approxBytes = Math.ceil((att.content.length * 3) / 4); // ước lượng dung lượng gốc từ base64
      totalBytes += approxBytes;
      if (totalBytes > MAX_TOTAL_ATTACHMENT_MB * 1024 * 1024) {
        context.log.warn("Bỏ qua các ảnh vượt tổng dung lượng cho phép.");
        break;
      }
      attachments.push({
        content: att.content,
        filename: att.filename,
        type: att.type || "application/octet-stream",
        disposition: "attachment"
      });
    }
  }

  const adminMsg = {
    to: toEmail,
    from: { email: fromEmail, name: "Website Mạng Lưới Tri Thức Việt Nam" },
    replyTo: senderEmail || undefined,
    subject: `[WVN Website] ${title}`,
    html: adminHtml,
    ...(attachments && attachments.length > 0 ? { attachments } : {})
  };

  try {
    // Email báo cho admin — bắt buộc phải thành công, nếu lỗi thì báo lỗi cho người dùng
    await sgMail.send(adminMsg);
  } catch (err) {
    context.log.error("Gửi email thông báo admin thất bại:", err?.response?.body || err.message);
    context.res.status = 502;
    context.res.body = { success: false, message: "Gửi email thất bại, vui lòng thử lại sau." };
    return;
  }

  // Tạo item mới trên Monday.com CRM (best-effort — không chặn phản hồi thành công nếu lỗi)
  try {
    await createMondayItem(formType, data, title);
  } catch (err) {
    context.log.error("Tạo item Monday.com thất bại:", err.message);
  }

  // Email cảm ơn/xác nhận gửi lại cho chính người gửi (best-effort — không chặn phản hồi thành công nếu lỗi)
  if (senderEmail) {
    try {
      const introMessage = AUTOREPLY_INTRO[formType] || "Chúng tôi đã nhận được thông tin bạn gửi và đang xử lý. Đội ngũ sẽ phản hồi sớm nhất có thể.";
      const autoReplyHtml = buildAutoReplyHtml(senderName, introMessage);
      await sgMail.send({
        to: senderEmail,
        from: { email: fromEmail, name: "Mạng Lưới Tri Thức Việt Nam" },
        subject: "Đã nhận được thông tin của bạn - Mạng Lưới Tri Thức Việt Nam",
        html: autoReplyHtml
      });
    } catch (err) {
      context.log.error("Gửi email cảm ơn cho người gửi thất bại:", err?.response?.body || err.message);
      // Không return lỗi ở đây — người dùng vẫn nên thấy "gửi thành công" vì admin đã nhận được.
    }
  }

  context.res.status = 200;
  context.res.body = { success: true };
};
