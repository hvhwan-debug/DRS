const { TableClient } = require("@azure/data-tables");

const tableCache = {};

// Trả về TableClient cho 1 bảng, tự tạo bảng nếu chưa tồn tại (chỉ tạo 1 lần, có cache trong bộ nhớ).
async function getTableClient(tableName) {
  if (tableCache[tableName]) return tableCache[tableName];

  const connectionString = process.env.AZURE_STORAGE_CONNECTION_STRING;
  if (!connectionString) {
    throw new Error("Thiếu AZURE_STORAGE_CONNECTION_STRING trong Application settings.");
  }

  const client = TableClient.fromConnectionString(connectionString, tableName, {
    allowInsecureConnection: false
  });

  try {
    await client.createTable();
  } catch (err) {
    // 409 = bảng đã tồn tại, bỏ qua; các lỗi khác thì báo thật
    if (err.statusCode !== 409) throw err;
  }

  tableCache[tableName] = client;
  return client;
}

module.exports = { getTableClient };
