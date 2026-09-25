const crypto = require("crypto");
const { getTableClient } = require("./tableStorage");

const TOKENS_TABLE = "PublicConfirmTokens";

// Tạo token bí mật cho phép xác nhận/từ chối 1 bản ghi qua link email, không cần đăng nhập.
// type: 'donation' | 'grade' | 'tuition'
// recordPartitionKey: giá trị PartitionKey thật của bản ghi trong bảng gốc (vd: 'donation' hoặc email phụ huynh)
// recordId: RowKey thật của bản ghi
async function createConfirmToken(type, recordPartitionKey, recordId) {
  const token = crypto.randomBytes(20).toString("hex");
  const tokensTable = await getTableClient(TOKENS_TABLE);
  await tokensTable.createEntity({
    partitionKey: "token",
    rowKey: token,
    type,
    recordPartitionKey,
    recordId,
    createdAt: new Date().toISOString()
  });
  return token;
}

module.exports = { createConfirmToken };
