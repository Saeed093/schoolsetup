const express = require('express');
const router = express.Router();
const { getDatabase } = require('../database/db');
const { updateDebounce } = require('../services/uhfService');

// Get all children's current attendance status (joined with cards for full info)
router.get('/', (req, res) => {
  const db = getDatabase();
  if (!db) return res.status(500).json({ error: 'Database not available' });

  db.all(
    `SELECT c.id, c.card_id, c.student_name, c.student_class, c.uhf_tag_id, c.child_image,
            COALESCE(a.status, 'out') AS status,
            a.last_changed_at
     FROM cards c
     LEFT JOIN attendance a ON c.uhf_tag_id = a.uhf_tag_id AND c.uhf_tag_id != ''
     WHERE c.uhf_tag_id IS NOT NULL AND c.uhf_tag_id != ''
     ORDER BY c.student_class, c.student_name`,
    [],
    (err, rows) => {
      if (err) return res.status(500).json({ error: err.message });
      res.json({ attendance: rows });
    }
  );
});

// Get attendance for a specific class
router.get('/class/:classId', (req, res) => {
  const db = getDatabase();
  if (!db) return res.status(500).json({ error: 'Database not available' });

  const classId = req.params.classId;

  db.all(
    `SELECT c.id, c.card_id, c.student_name, c.student_class, c.uhf_tag_id, c.child_image,
            COALESCE(a.status, 'out') AS status,
            a.last_changed_at
     FROM cards c
     LEFT JOIN attendance a ON c.uhf_tag_id = a.uhf_tag_id AND c.uhf_tag_id != ''
     WHERE c.uhf_tag_id IS NOT NULL AND c.uhf_tag_id != ''
       AND LOWER(REPLACE(REPLACE(c.student_class, 'Class ', ''), 'class ', '')) = LOWER(?)
     ORDER BY c.student_name`,
    [classId],
    (err, rows) => {
      if (err) return res.status(500).json({ error: err.message });
      res.json({ attendance: rows });
    }
  );
});

// Get attendance summary (counts by class)
router.get('/summary', (req, res) => {
  const db = getDatabase();
  if (!db) return res.status(500).json({ error: 'Database not available' });

  db.all(
    `SELECT c.student_class,
            COUNT(*) as total,
            SUM(CASE WHEN COALESCE(a.status, 'out') = 'in' THEN 1 ELSE 0 END) as total_in,
            SUM(CASE WHEN COALESCE(a.status, 'out') = 'out' THEN 1 ELSE 0 END) as total_out
     FROM cards c
     LEFT JOIN attendance a ON c.uhf_tag_id = a.uhf_tag_id AND c.uhf_tag_id != ''
     WHERE c.uhf_tag_id IS NOT NULL AND c.uhf_tag_id != ''
     GROUP BY c.student_class
     ORDER BY c.student_class`,
    [],
    (err, rows) => {
      if (err) return res.status(500).json({ error: err.message });

      const totalIn = rows.reduce((sum, r) => sum + r.total_in, 0);
      const totalOut = rows.reduce((sum, r) => sum + r.total_out, 0);
      const total = rows.reduce((sum, r) => sum + r.total, 0);

      res.json({
        total,
        total_in: totalIn,
        total_out: totalOut,
        by_class: rows
      });
    }
  );
});

// Get per-student arrival + departure summary for a given date (15-day history)
// GET /api/attendance/history?date=YYYY-MM-DD&q=name
router.get('/history', (req, res) => {
  const db = getDatabase();
  if (!db) return res.status(500).json({ error: 'Database not available' });

  const date = req.query.date || new Date().toISOString().slice(0, 10);
  const q = `%${req.query.q || ''}%`;

  db.all(
    `SELECT student_name, student_class, uhf_tag_id,
            MIN(CASE WHEN direction = 'in'  THEN timestamp END) AS arrival_time,
            MAX(CASE WHEN direction = 'out' THEN timestamp END) AS departure_time,
            COUNT(*) AS total_scans
     FROM attendance_log
     WHERE DATE(timestamp) = ? AND student_name LIKE ?
     GROUP BY uhf_tag_id, student_name
     ORDER BY arrival_time`,
    [date, q],
    (err, rows) => {
      if (err) return res.status(500).json({ error: err.message });
      res.json({ date, records: rows || [] });
    }
  );
});

// Get available dates in attendance_log (for date picker, last 15 days only)
router.get('/history/dates', (req, res) => {
  const db = getDatabase();
  if (!db) return res.status(500).json({ error: 'Database not available' });

  db.all(
    `SELECT DISTINCT DATE(timestamp) AS date
     FROM attendance_log
     WHERE timestamp >= datetime('now', '-15 days')
     ORDER BY date DESC`,
    [],
    (err, rows) => {
      if (err) return res.status(500).json({ error: err.message });
      res.json({ dates: (rows || []).map((r) => r.date) });
    }
  );
});

// Get attendance history log
router.get('/log', (req, res) => {
  const db = getDatabase();
  if (!db) return res.status(500).json({ error: 'Database not available' });

  const { date, limit: rawLimit } = req.query;
  const limit = parseInt(rawLimit, 10) || 200;

  let sql = 'SELECT * FROM attendance_log';
  const params = [];

  if (date) {
    sql += ' WHERE DATE(timestamp) = ?';
    params.push(date);
  }

  sql += ' ORDER BY timestamp DESC LIMIT ?';
  params.push(limit);

  db.all(sql, params, (err, rows) => {
    if (err) return res.status(500).json({ error: err.message });
    res.json({ log: rows });
  });
});

// Reset all attendance to "out"
router.post('/reset', (req, res) => {
  const db = getDatabase();
  if (!db) return res.status(500).json({ error: 'Database not available' });

  db.run('UPDATE attendance SET status = ?, last_changed_at = ?', ['out', new Date().toISOString()], (err) => {
    if (err) return res.status(500).json({ error: err.message });

    if (global.broadcastToClients) {
      global.broadcastToClients({
        type: 'attendance_reset',
        timestamp: new Date().toISOString()
      });
    }

    res.json({ success: true, message: 'All attendance reset to out' });
  });
});

// Get UHF settings
router.get('/settings', (req, res) => {
  const db = getDatabase();
  if (!db) return res.status(500).json({ error: 'Database not available' });

  db.all('SELECT key, value FROM uhf_settings', [], (err, rows) => {
    if (err) return res.status(500).json({ error: err.message });
    const settings = {};
    for (const row of rows) {
      settings[row.key] = row.value;
    }
    res.json({ settings });
  });
});

// Update UHF settings
router.put('/settings', (req, res) => {
  const db = getDatabase();
  if (!db) return res.status(500).json({ error: 'Database not available' });

  const { settings } = req.body;
  if (!settings || typeof settings !== 'object') {
    return res.status(400).json({ error: 'settings object required' });
  }

  const allowed = ['debounce_seconds', 'sdk_url', 'com_port', 'baud_rate', 'auto_connect'];
  const updates = [];

  for (const [key, value] of Object.entries(settings)) {
    if (allowed.includes(key)) {
      updates.push(
        new Promise((resolve, reject) => {
          db.run(
            'INSERT OR REPLACE INTO uhf_settings (key, value) VALUES (?, ?)',
            [key, String(value)],
            (err) => (err ? reject(err) : resolve())
          );
        })
      );

      if (key === 'debounce_seconds') {
        updateDebounce(value);
      }
    }
  }

  Promise.all(updates)
    .then(() => res.json({ success: true }))
    .catch((err) => res.status(500).json({ error: err.message }));
});

module.exports = router;
