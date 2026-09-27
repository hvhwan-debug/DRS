// Không Gian Công Việc — hằng số & tiện ích dùng chung.
// Bảng: WorkTasks (PK "task"), WorkProjects (PK "project"), WorkComments (PK = id công việc).
const TASKS_TABLE = "WorkTasks";
const PROJECTS_TABLE = "WorkProjects";
const COMMENTS_TABLE = "WorkComments";
const STATUSES = ["todo", "doing", "review", "done"];
const PRIORITIES = ["low", "normal", "high", "urgent"];
const RECURRENCES = ["", "daily", "weekdays", "weekly", "monthly"];

const clean = (v, max) => String(v == null ? "" : v).trim().slice(0, max || 500);
const cleanDate = v => (/^\d{4}-\d{2}-\d{2}$/.test(String(v || "")) ? String(v) : "");
const cleanTime = v => (/^\d{2}:\d{2}$/.test(String(v || "")) ? String(v) : "");
const isId = v => /^[A-Za-z0-9_-]{1,80}$/.test(String(v || ""));
const newId = () => `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
const parseJson = (v, d) => { try { const x = JSON.parse(v || ""); return x == null ? d : x; } catch (e) { return d; } };

function toTask(e) {
  return {
    id: e.rowKey,
    title: e.title || "",
    description: e.description || "",
    status: STATUSES.includes(e.status) ? e.status : "todo",
    priority: PRIORITIES.includes(e.priority) ? e.priority : "normal",
    dueDate: e.dueDate || "",
    dueTime: e.dueTime || "",
    assignees: parseJson(e.assigneesJson, []),
    projectId: e.projectId || "",
    labels: parseJson(e.labelsJson, []),
    checklist: parseJson(e.checklistJson, []),
    recurrence: e.recurrence || "",
    link: parseJson(e.linkJson, null),
    history: parseJson(e.historyJson, []),
    commentCount: Number(e.commentCount) || 0,
    order: Number(e.order) || 0,
    createdBy: e.createdBy || "",
    createdByName: e.createdByName || "",
    createdAt: e.createdAt || null,
    updatedAt: e.updatedAt || null,
    completedAt: e.completedAt || null
  };
}

// Ngày kế tiếp cho việc lặp lại
function nextDue(dateStr, rule) {
  const d = dateStr ? new Date(dateStr + "T00:00:00Z") : new Date();
  if (rule === "daily") d.setUTCDate(d.getUTCDate() + 1);
  else if (rule === "weekdays") { do { d.setUTCDate(d.getUTCDate() + 1); } while ([0, 6].includes(d.getUTCDay())); }
  else if (rule === "weekly") d.setUTCDate(d.getUTCDate() + 7);
  else if (rule === "monthly") d.setUTCMonth(d.getUTCMonth() + 1);
  return d.toISOString().slice(0, 10);
}

module.exports = { TASKS_TABLE, PROJECTS_TABLE, COMMENTS_TABLE, STATUSES, PRIORITIES, RECURRENCES, clean, cleanDate, cleanTime, isId, newId, parseJson, toTask, nextDue };
