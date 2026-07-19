const express = require('express');
const fs = require('fs');
const path = require('path');

const app = express();
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

const PORT = process.env.PORT || 3000;
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || 'asc2026';

const EMPLOYEES_PATH = path.join(__dirname, 'data', 'employees.json');
const CHECKINS_PATH = path.join(__dirname, 'data', 'checkins.json');

// --- load static employee data ---
let employees = [];
try {
  employees = JSON.parse(fs.readFileSync(EMPLOYEES_PATH, 'utf-8'));
} catch (e) {
  console.error('Cannot load employees.json:', e.message);
}
const employeeById = new Map(employees.map((e) => [e.empId, e]));

// --- load / init check-in state ---
function loadCheckins() {
  try {
    return JSON.parse(fs.readFileSync(CHECKINS_PATH, 'utf-8'));
  } catch (e) {
    return {};
  }
}
function saveCheckins(data) {
  fs.writeFileSync(CHECKINS_PATH, JSON.stringify(data, null, 2));
}
let checkins = loadCheckins();

// --- helpers ---
function normalizeId(id) {
  return String(id || '').trim();
}

function requireAdmin(req, res, next) {
  const auth = req.headers['authorization'] || '';
  const token = auth.replace(/^Bearer\s+/i, '');
  if (token !== ADMIN_PASSWORD) {
    return res.status(401).json({ error: 'unauthorized' });
  }
  next();
}

// ================= Public API =================

// Employee looks up their own color group. Marks first check-in automatically.
app.post('/api/lookup', (req, res) => {
  const empId = normalizeId(req.body.empId);
  if (!empId) return res.status(400).json({ error: 'กรุณากรอกรหัสพนักงาน' });

  const emp = employeeById.get(empId);
  if (!emp) {
    return res.status(404).json({ error: 'ไม่พบรหัสพนักงานนี้ในระบบ กรุณาตรวจสอบอีกครั้ง' });
  }

  const already = !!checkins[empId];
  if (!already) {
    checkins[empId] = { checkedInAt: new Date().toISOString() };
    saveCheckins(checkins);
  }

  res.json({
    empId: emp.empId,
    fullName: `${emp.prefix}${emp.firstName} ${emp.lastName}`,
    position: emp.position,
    store: emp.store,
    team: emp.team,
    color: emp.color,
    firstCheckin: !already,
    checkedInAt: checkins[empId].checkedInAt,
  });
});

// ================= Admin API =================

app.post('/api/admin/login', (req, res) => {
  const { password } = req.body;
  if (password === ADMIN_PASSWORD) {
    return res.json({ token: ADMIN_PASSWORD });
  }
  res.status(401).json({ error: 'รหัสผ่านไม่ถูกต้อง' });
});

app.get('/api/admin/stats', requireAdmin, (req, res) => {
  const byColor = {};
  for (const e of employees) {
    if (!byColor[e.color]) byColor[e.color] = { color: e.color, total: 0, checkedIn: 0 };
    byColor[e.color].total += 1;
    if (checkins[e.empId]) byColor[e.color].checkedIn += 1;
  }
  const totalCheckedIn = Object.keys(checkins).length;
  res.json({
    totalEmployees: employees.length,
    totalCheckedIn,
    byColor: Object.values(byColor).sort((a, b) => b.total - a.total),
  });
});

app.get('/api/admin/list', requireAdmin, (req, res) => {
  const { q = '', color = '', status = '' } = req.query;
  const qLower = q.toLowerCase();

  let rows = employees.map((e) => ({
    ...e,
    fullName: `${e.prefix}${e.firstName} ${e.lastName}`,
    checkedIn: !!checkins[e.empId],
    checkedInAt: checkins[e.empId] ? checkins[e.empId].checkedInAt : null,
  }));

  if (qLower) {
    rows = rows.filter(
      (e) =>
        e.empId.toLowerCase().includes(qLower) ||
        e.fullName.toLowerCase().includes(qLower) ||
        e.store.toLowerCase().includes(qLower)
    );
  }
  if (color) rows = rows.filter((e) => e.color === color);
  if (status === 'checked') rows = rows.filter((e) => e.checkedIn);
  if (status === 'notchecked') rows = rows.filter((e) => !e.checkedIn);

  res.json({ total: rows.length, rows });
});

// Manual override in case admin needs to reset/mark a check-in by hand
app.post('/api/admin/checkin/:empId', requireAdmin, (req, res) => {
  const empId = normalizeId(req.params.empId);
  const emp = employeeById.get(empId);
  if (!emp) return res.status(404).json({ error: 'not found' });
  checkins[empId] = { checkedInAt: new Date().toISOString(), manual: true };
  saveCheckins(checkins);
  res.json({ ok: true });
});

app.delete('/api/admin/checkin/:empId', requireAdmin, (req, res) => {
  const empId = normalizeId(req.params.empId);
  delete checkins[empId];
  saveCheckins(checkins);
  res.json({ ok: true });
});

app.listen(PORT, () => {
  console.log(`ASC Color App running on port ${PORT}`);
});
