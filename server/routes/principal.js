const express = require('express');
const router = express.Router();
const { getDatabase } = require('../database/db');

// Same class ids as client (ClassSelection / PrinciplesView)
const CLASS_IDS = ['prenursery', 'nursery', '1', '2', '3', '4', '5'];

function normalizeClass(s) {
  if (s == null || s === '') return '';
  const t = String(s).trim().toLowerCase();
  return t.replace(/^(class|grade)\s+/, '').trim();
}

function classMatches(scanClass, matchId) {
  const sc = normalizeClass(scanClass);
  const mi = normalizeClass(matchId);
  if (!sc) return false;
  return sc === mi || sc.endsWith(mi) || mi.endsWith(sc);
}

// GET /api/principal/classes - list classes with total, picked, remaining
// Now accounts for direction: students are only "picked" if their last scan was 'out'
router.get('/classes', (req, res) => {
  const db = getDatabase();
  if (!db) {
    return res.status(500).json({ error: 'Database not available' });
  }

  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const todayStr = today.toISOString();

  db.all('SELECT student_class, COUNT(*) AS cnt FROM cards GROUP BY student_class', [], (err, cardRows) => {
    if (err) {
      console.error('Principal classes cards error:', err);
      return res.status(500).json({ error: 'Failed to fetch cards' });
    }

    // Get each student's LATEST scan for today with direction
    db.all(`
      SELECT p.card_id, p.student_class, p.direction
      FROM pickups p
      INNER JOIN (
        SELECT card_id, MAX(picked_at) as max_time
        FROM pickups
        WHERE picked_at >= ?
        GROUP BY card_id
      ) latest ON p.card_id = latest.card_id AND p.picked_at = latest.max_time
      WHERE p.picked_at >= ?
    `, [todayStr, todayStr], (err2, pickupRows) => {
      if (err2) {
        console.error('Principal classes pickups error:', err2);
        return res.status(500).json({ error: 'Failed to fetch pickups' });
      }

      const totalByClass = {};
      cardRows.forEach((r) => {
        const key = normalizeClass(r.student_class) || '_empty';
        totalByClass[key] = (totalByClass[key] || 0) + r.cnt;
      });

      // Count only students whose last scan was 'out' as "picked"
      const pickedByClass = {};
      const checkedInByClass = {};
      pickupRows.forEach((r) => {
        const key = normalizeClass(r.student_class) || '_empty';
        if (r.direction === 'out') {
          pickedByClass[key] = (pickedByClass[key] || 0) + 1;
        } else if (r.direction === 'in') {
          checkedInByClass[key] = (checkedInByClass[key] || 0) + 1;
        }
      });

      const classes = CLASS_IDS.map((id) => {
        let total = 0;
        let picked = 0;
        let checkedIn = 0;
        Object.keys(totalByClass).forEach((k) => {
          if (k === '_empty' || classMatches(k, id)) total += totalByClass[k];
        });
        Object.keys(pickedByClass).forEach((k) => {
          if (k === '_empty' || classMatches(k, id)) picked += pickedByClass[k];
        });
        Object.keys(checkedInByClass).forEach((k) => {
          if (k === '_empty' || classMatches(k, id)) checkedIn += checkedInByClass[k];
        });
        const remaining = Math.max(0, total - picked);
        return {
          id,
          label: id === '1' ? 'Class 1' : id === '2' ? 'Class 2' : id === '3' ? 'Class 3' : id === '4' ? 'Class 4' : id === '5' ? 'Class 5' : id === 'prenursery' ? 'Prenursery' : id === 'nursery' ? 'Nursery' : id,
          total,
          picked,
          checkedIn,
          remaining
        };
      });

      res.json({ classes });
    });
  });
});

// GET /api/principal/summary - get summary counts for dashboard
// Now accounts for direction: 'in' = arrived, 'out' = left
router.get('/summary', (req, res) => {
  const db = getDatabase();
  if (!db) {
    return res.status(500).json({ error: 'Database not available' });
  }

  // Get total students count
  db.get('SELECT COUNT(*) as total FROM cards', [], (err, totalRow) => {
    if (err) {
      console.error('Principal summary error:', err);
      return res.status(500).json({ error: 'Failed to fetch summary' });
    }

    const totalStudents = totalRow?.total || 0;

    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const todayStr = today.toISOString();

    // Get each student's LATEST scan direction for today
    // This determines if they're currently in or out
    db.all(`
      SELECT card_id, direction, MAX(picked_at) as last_scan 
      FROM pickups 
      WHERE picked_at >= ? 
      GROUP BY card_id
    `, [todayStr], (err2, rows) => {
      if (err2) {
        console.error('Principal summary pickups error:', err2);
        return res.status(500).json({ error: 'Failed to fetch pickup count' });
      }

      // Count students based on their latest direction
      let checkedIn = 0;  // Students who last scanned 'in'
      let checkedOut = 0; // Students who last scanned 'out'

      rows.forEach(row => {
        if (row.direction === 'in') {
          checkedIn++;
        } else {
          checkedOut++;
        }
      });

      // Students currently in school:
      // - Students registered but no scan today (assumed in school at start of day)
      // - Students whose last scan was 'in' (checked in)
      // - Minus students whose last scan was 'out' (checked out/picked up)
      const studentsWithNoScanToday = totalStudents - rows.length;
      const inSchool = studentsWithNoScanToday + checkedIn;
      const pickedUp = checkedOut;

      res.json({
        totalStudents,
        inSchool,      // "Welcome" - students currently in school
        pickedUp,      // "Goodbye" - students who left (checked out)
        checkedIn,     // Students who checked in today
        checkedOut     // Students who checked out today
      });
    });
  });
});

// GET /api/principal/class/:classId/latest - get the most recent pickup for a class (for ClassView polling)
router.get('/class/:classId/latest', (req, res) => {
  const { classId } = req.params;
  const db = getDatabase();
  if (!db) {
    return res.status(500).json({ error: 'Database not available' });
  }

  // Get the most recent pickup overall and check if it matches this class
  db.get('SELECT id, card_id, student_name, student_class, adult_name, adult_image, child_image, pickup_image, direction, picked_at FROM pickups ORDER BY picked_at DESC LIMIT 1', [], (err, row) => {
    if (err) {
      console.error('Latest pickup error:', err);
      return res.status(500).json({ error: 'Failed to fetch latest pickup' });
    }

    if (!row) {
      return res.json({ pickup: null });
    }

    const matchId = (classId || '').toString().trim();
    if (!classMatches(row.student_class, matchId)) {
      return res.json({ pickup: null }); // Most recent pickup is not for this class
    }

    res.json({
      pickup: {
        id: row.id,
        card_id: row.card_id,
        student_name: row.student_name,
        student_class: row.student_class,
        adult_name: row.adult_name,
        adult_image: row.adult_image || '',
        child_image: row.child_image || '',
        pickup_image: row.pickup_image || '',
        direction: row.direction || 'out',
        timestamp: row.picked_at
      }
    });
  });
});

// GET /api/principal/class/:classId/pickups - list pickups for a class (for Principal class detail page)
// Includes direction field and uhf_out_time (last UHF departure for that student today).
router.get('/class/:classId/pickups', (req, res) => {
  const { classId } = req.params;
  const db = getDatabase();
  if (!db) {
    return res.status(500).json({ error: 'Database not available' });
  }

  db.all(
    `SELECT p.id, p.card_id, p.student_name, p.student_class,
            p.adult_name, p.adult_image, p.child_image, p.pickup_image,
            p.direction, p.picked_at,
            a.last_changed_at AS uhf_out_time
     FROM pickups p
     LEFT JOIN attendance a ON a.card_id = p.card_id AND a.status = 'out'
     ORDER BY p.picked_at DESC`,
    [],
    (err, rows) => {
      if (err) {
        console.error('Principal pickups error:', err);
        return res.status(500).json({ error: 'Failed to fetch pickups' });
      }

      const matchId = (classId || '').toString().trim();
      const byClass = rows.filter((r) => classMatches(r.student_class, matchId));
      const seenCards = new Set();
      const filtered = byClass.filter((r) => {
        if (seenCards.has(r.card_id)) return false;
        seenCards.add(r.card_id);
        return true;
      });

      const pickups = filtered.map((r) => ({
        id: r.id,
        card_id: r.card_id,
        student_name: r.student_name,
        student_class: r.student_class,
        adult_name: r.adult_name,
        adult_image: r.adult_image || '',
        child_image: r.child_image || '',
        pickup_image: r.pickup_image || '',
        direction: r.direction || 'out',
        timestamp: r.picked_at,
        uhf_out_time: r.uhf_out_time || null
      }));

      res.json({ classId: matchId, pickups });
    }
  );
});

module.exports = router;
