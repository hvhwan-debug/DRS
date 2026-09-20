const { TableClient } = require("@azure/data-tables");

const TABLE_NAME = "Transactions";

// Bỏ dấu tiếng Việt + chuẩn hóa để so sánh họ tên không phân biệt dấu/hoa-thường
// (phải giống hệt logic ở frontend sao-ke.html)
function removeVietnameseDiacritics(str) {
  return String(str || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/đ/g, "d")
    .replace(/Đ/g, "D")
    .trim()
    .toUpperCase()
    .replace(/\s+/g, " ");
}

module.exports = async function (context, req) {
  const rawCode = (req.query.code || "").trim().toUpperCase();
  const rawName = req.query.name || "";
  const nameNormalized = removeVietnameseDiacritics(rawName);

  // Validate đầu vào cơ bản
  if (!rawCode || !nameNormalized) {
    context.res = {
      status: 400,
      headers: { "Content-Type": "application/json" },
      body: { success: false, message: "Thiếu họ tên hoặc mã giao dịch." }
    };
    return;
  }

  const connectionString = process.env.AZURE_STORAGE_CONNECTION_STRING;
  if (!connectionString) {
    context.log.error("Chưa cấu hình AZURE_STORAGE_CONNECTION_STRING.");
    context.res = {
      status: 500,
      headers: { "Content-Type": "application/json" },
      body: { success: false, message: "Hệ thống tra cứu tạm thời chưa sẵn sàng." }
    };
    return;
  }

  try {
    const tableClient = TableClient.fromConnectionString(connectionString, TABLE_NAME);

    // RowKey được lưu = mã giao dịch (đã upper-case khi ghi vào bảng)
    // PartitionKey cố định "TX" khi ghi dữ liệu (xem ghi chú cách nạp dữ liệu bên dưới)
    let entity;
    try {
      entity = await tableClient.getEntity("TX", rawCode);
    } catch (err) {
      if (err.statusCode === 404) {
        entity = null;
      } else {
        throw err;
      }
    }

    // Không tìm thấy mã giao dịch, HOẶC họ tên không khớp
    // -> trả về cùng một thông báo chung chung, không tiết lộ lý do cụ thể
    // (tránh để kẻ dò quét biết mã đúng nhưng tên sai, hay ngược lại)
    if (!entity || removeVietnameseDiacritics(entity.fullName) !== nameNormalized) {
      context.res = {
        status: 200,
        headers: { "Content-Type": "application/json" },
        body: { success: false, message: "Không tìm thấy giao dịch khớp với thông tin đã nhập." }
      };
      return;
    }

    context.res = {
      status: 200,
      headers: { "Content-Type": "application/json" },
      body: {
        success: true,
        data: {
          code: entity.rowKey,
          date: entity.date,
          content: entity.content,
          amount: entity.amount
        }
      }
    };
  } catch (err) {
    context.log.error("Lỗi tra cứu Table Storage:", err.message);
    context.res = {
      status: 500,
      headers: { "Content-Type": "application/json" },
      body: { success: false, message: "Có lỗi xảy ra khi tra cứu. Vui lòng thử lại sau." }
    };
  }
};
