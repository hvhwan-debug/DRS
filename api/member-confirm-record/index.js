const { getTableClient } = require("../_shared/tableStorage");

const SESSION_TABLE = "AuthSessions";
const DONATIONS_TABLE = "Donations";
const GRADES_TABLE = "Grades";

function getMemberToken(req) {
  const header = req.headers && (req.headers["x-member-token"] || req.headers["X-Member-Token"]);
  return header ? header.trim() : null;
}

module.exports = async function (context, req) {
  context.res = { headers: { "Content-Type": "application/json" } };

  const token = getMemberToken(req);
  if (!token) {
    context.res.status = 401;
    context.res.body = { success: false, message: "Chưa đăng nhập." };
    return;
  }

  const body = req.body || {};
  const type = String(body.type || ""); // 'donation' | 'grade'
  const id = String(body.id || "");
  const action = String(body.action || ""); // 'confirm' | 'reject'
  const feedback = String(body.feedback || "").trim();

  if (!["donation", "grade"].includes(type) || !id || !["confirm", "reject"].includes(action)) {
    context.res.status = 400;
    context.res.body = { success: false, message: "Yêu cầu không hợp lệ." };
    return;
  }
  if (action === "reject" && !feedback) {
    context.res.status = 400;
    context.res.body = { success: false, message: "Vui lòng nhập lý do từ chối." };
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

    const confirmationStatus = action === "confirm" ? "confirmed" : "rejected";
    const update = {
      confirmationStatus,
      memberFeedback: action === "reject" ? feedback : "",
      confirmedAt: new Date().toISOString()
    };

    if (type === "donation") {
      const table = await getTableClient(DONATIONS_TABLE);
      let entity;
      try {
        entity = await table.getEntity("donation", id);
      } catch (err) {
        context.res.status = 404;
        context.res.body = { success: false, message: "Không tìm thấy giao dịch." };
        return;
      }
      if ((entity.donorEmail || "").toLowerCase() !== email) {
        context.res.status = 403;
        context.res.body = { success: false, message: "Bạn không có quyền xác nhận mục này." };
        return;
      }
      await table.updateEntity({ partitionKey: "donation", rowKey: id, ...update }, "Merge");
    } else {
      const table = await getTableClient(GRADES_TABLE);
      let entity;
      try {
        entity = await table.getEntity(email, id);
      } catch (err) {
        context.res.status = 404;
        context.res.body = { success: false, message: "Không tìm thấy bản ghi." };
        return;
      }
      await table.updateEntity({ partitionKey: email, rowKey: id, ...update }, "Merge");
    }

    context.res.status = 200;
    context.res.body = { success: true };
  } catch (err) {
    context.log.error("Lỗi xác nhận:", err.message);
    context.res.status = 500;
    context.res.body = { success: false, message: "Đã có lỗi xảy ra, vui lòng thử lại sau." };
  }
};
