const express = require('express');
const fs = require('fs');
const path = require('path');
const router = express.Router();
const { getDatabase } = require('../database/db');

const ADMIN_PASSWORD = 'system1234';

const CAPTURES_DIR = path.join(__dirname, '..', 'uploads', 'captures');

function checkPassword(req, res, next) {
  const password = req.body?.password || req.headers['x-admin-password'];
  if (password !== ADMIN_PASSWORD) {
    return res.status(401).json({ error: 'Invalid password' });
  }
  next();
}

// Sanitize card_id for use as filename (alphanumeric and underscore only)
function sanitizeFilename(cardId) {
  return String(cardId).replace(/[^a-zA-Z0-9_-]/g, '_') || 'card';
}

// Save captured image to disk and return URL path; overwrites existing file
function saveCapturedImage(cardId, base64Data) {
  if (!base64Data || typeof base64Data !== 'string') return null;
  const base64 = base64Data.replace(/^data:image\/\w+;base64,/, '');
  const buf = Buffer.from(base64, 'base64');
  if (buf.length === 0) return null;
  fs.mkdirSync(CAPTURES_DIR, { recursive: true });
  const filename = sanitizeFilename(cardId) + '.jpg';
  const filepath = path.join(CAPTURES_DIR, filename);
  fs.writeFileSync(filepath, buf);
  return '/uploads/captures/' + filename;
}

// Simulate a card scan (broadcasts same payload as real RFID scan)
// If live_adult_image is sent, save it to disk and update the card's adult_image (overwrites previous).
// direction: 'in' = arriving at school (check-in), 'out' = leaving school (check-out, default)
router.post('/simulate-scan', checkPassword, (req, res) => {
  const { card_id, live_adult_image, direction } = req.body;
  if (!card_id || typeof card_id !== 'string') {
    return res.status(400).json({ error: 'card_id is required' });
  }

  const db = getDatabase();
  const cardId = String(card_id).trim();
  // Normalize direction: 'in' = check-in (arriving), 'out' = check-out (leaving, default)
  const scanDirection = direction === 'in' ? 'in' : 'out';

  // For check-in scans, match by checkin_card_id; for check-out scans, match by card_id.
  // Fallback: also try card_id in case the same physical card is used.
  const lookupSql =
    scanDirection === 'in'
      ? 'SELECT * FROM cards WHERE checkin_card_id = ? OR card_id = ?'
      : 'SELECT * FROM cards WHERE card_id = ?';
  const lookupParams = scanDirection === 'in' ? [cardId, cardId] : [cardId];

  db.get(lookupSql, lookupParams, (err, row) => {
    if (err) {
      console.error('Admin simulate-scan DB error:', err);
      return res.status(500).json({ error: 'Database error' });
    }

    // Original stored guardian image (never overwrite)
    const storedAdultImage = row ? (row.adult_image ?? '') : '';

    // If a live capture was sent (only for checkout/out), save it as pickup_image (separate from adult_image)
    let pickupImage = '';
    let isLiveCapture = false;
    if (live_adult_image && scanDirection === 'out') {
      console.log('[Admin] Received live_adult_image, length:', live_adult_image.length);
      try {
        // Save with timestamp to avoid overwriting previous captures
        const timestamp = Date.now();
        const captureFilename = sanitizeFilename(cardId) + '_' + timestamp + '.jpg';
        const base64 = live_adult_image.replace(/^data:image\/\w+;base64,/, '');
        const buf = Buffer.from(base64, 'base64');
        console.log('[Admin] Decoded buffer length:', buf.length);
        if (buf.length > 0) {
          fs.mkdirSync(CAPTURES_DIR, { recursive: true });
          const filepath = path.join(CAPTURES_DIR, captureFilename);
          fs.writeFileSync(filepath, buf);
          pickupImage = '/uploads/captures/' + captureFilename;
          isLiveCapture = true;
          console.log('[Admin] Saved pickup capture:', pickupImage);
        } else {
          console.error('[Admin] Empty buffer - image not saved');
        }
      } catch (e) {
        console.error('[Admin] Error saving captured image:', e);
      }
    } else if (scanDirection === 'out') {
      console.log('[Admin] No live_adult_image received (camera not used or checkbox not checked)');
    }

    // Add cache-busting timestamp for live captures so browser fetches new image
    const cacheBuster = isLiveCapture ? `?t=${Date.now()}` : '';
    
    const payload = {
      type: 'card_scan',
      card_id: cardId,
      student_name: row ? (row.student_name ?? row.name) : 'Unknown',
      student_class: row ? (row.student_class ?? '') : '',
      adult_name: row ? (row.adult_name ?? '') : '',
      adult_image: storedAdultImage,  // Always use stored guardian image
      child_image: row ? (row.child_image ?? '') : '',
      pickup_image: pickupImage ? (pickupImage + cacheBuster) : '',  // Live capture goes here
      name: row ? (row.student_name ?? row.name) : 'Unknown',
      found: !!row,
      timestamp: new Date().toISOString(),
      is_live_capture: isLiveCapture,
      direction: scanDirection, // 'in' = arriving, 'out' = leaving
      source: 'admin_simulate' // Flag so CaptureStation knows not to re-process
    };

    if (global.broadcastToClients) {
      global.broadcastToClients(payload);
      const dirLabel = scanDirection === 'in' ? 'CHECK-IN' : 'CHECK-OUT';
      console.log(`Admin: simulated ${dirLabel} broadcast`, payload.card_id, row ? row.student_name : 'unknown', live_adult_image ? '(with saved image)' : '');
    }

    // Log pickup for Principal view (authorized scans only)
    if (row) {
      try {
        const { logPickup } = require('../database/db');
        logPickup(payload); // logPickup already handles direction
      } catch (e) {
        console.error('logPickup error:', e);
      }
    }

    res.json({ success: true, message: 'Scan broadcast sent', card: row ? { student_name: row.student_name, student_class: row.student_class } : null, direction: scanDirection });
  });
});

// Clear the class view display (child went out)
router.post('/clear-display', checkPassword, (req, res) => {
  if (global.broadcastToClients) {
    global.broadcastToClients({ type: 'clear_class_display' });
    console.log('Admin: clear_class_display broadcast');
  }
  res.json({ success: true, message: 'Display clear sent' });
});

// Reset pickups (simulate students coming in in the morning – all students "in" again)
router.post('/reset-pickups', checkPassword, (req, res) => {
  const db = getDatabase();
  if (!db) {
    return res.status(500).json({ error: 'Database not available' });
  }
  db.run('DELETE FROM pickups', [], function(err) {
    if (err) {
      console.error('Admin reset-pickups error:', err);
      return res.status(500).json({ error: 'Database error' });
    }
    console.log(`Admin: reset pickups – cleared ${this.changes} rows (morning reset)`);
    if (global.broadcastToClients) {
      global.broadcastToClients({ type: 'clear_class_display' });
      console.log('Admin: clear_class_display broadcast (display cleared)');
    }
    res.json({ success: true, cleared: this.changes, message: 'Pickups cleared and display cleared. All students are now "in" (morning reset).' });
  });
});

// Update all cards to a specific class (for testing)
router.post('/set-all-class', checkPassword, (req, res) => {
  const { student_class } = req.body;
  const classValue = typeof student_class === 'string' ? student_class : '1';
  const db = getDatabase();
  db.run('UPDATE cards SET student_class = ?', [classValue], function(err) {
    if (err) {
      console.error('Admin set-all-class error:', err);
      return res.status(500).json({ error: 'Database error' });
    }
    console.log(`Admin: set all ${this.changes} cards to class "${classValue}"`);
    res.json({ success: true, updated: this.changes, student_class: classValue });
  });
});

// Assign images to first 4 cards (adult1-4.jpg, child1-4.jpg)
router.post('/assign-images', checkPassword, (req, res) => {
  const db = getDatabase();
  db.all('SELECT id FROM cards ORDER BY id ASC LIMIT 4', [], (err, rows) => {
    if (err) {
      console.error('Admin assign-images error:', err);
      return res.status(500).json({ error: 'Database error' });
    }
    if (!rows || rows.length === 0) {
      return res.json({ success: false, message: 'No cards found' });
    }
    let updated = 0;
    let pending = rows.length;
    rows.forEach((row, idx) => {
      const num = idx + 1;
      db.run(
        'UPDATE cards SET adult_image = ?, child_image = ? WHERE id = ?',
        [`/images/adult${num}.jpg`, `/images/child${num}.jpg`, row.id],
        function(err2) {
          if (!err2 && this.changes > 0) updated++;
          pending--;
          if (pending === 0) {
            console.log(`Admin: assigned images to ${updated} cards`);
            res.json({ success: true, updated });
          }
        }
      );
    });
  });
});

// Assign child photo to every card (cycles child1–4.jpg for 8+ cards)
router.post('/assign-child-photos', checkPassword, (req, res) => {
  const db = getDatabase();
  db.all('SELECT id FROM cards ORDER BY id ASC', [], (err, rows) => {
    if (err) {
      console.error('Admin assign-child-photos error:', err);
      return res.status(500).json({ error: 'Database error' });
    }
    if (!rows || rows.length === 0) {
      return res.json({ success: false, message: 'No cards found' });
    }
    let updated = 0;
    let pending = rows.length;
    rows.forEach((row, idx) => {
      const num = (idx % 4) + 1;
      db.run(
        'UPDATE cards SET child_image = ? WHERE id = ?',
        [`/images/child${num}.jpg`, row.id],
        function(err2) {
          if (!err2 && this.changes > 0) updated++;
          pending--;
          if (pending === 0) {
            console.log(`Admin: assigned child photos to ${updated} cards`);
            res.json({ success: true, updated });
          }
        }
      );
    });
  });
});

// Remove cards without student name (up to 4) and rename saeed iqbal to ayesha
router.post('/fix-cards', checkPassword, (req, res) => {
  const db = getDatabase();

  db.all('SELECT id, card_id, student_name FROM cards ORDER BY id', [], (err, rows) => {
    if (err) {
      console.error('Admin fix-cards list error:', err);
      return res.status(500).json({ error: 'Database error' });
    }

    const noName = (rows || []).filter(
      (r) => r.student_name == null || String(r.student_name).trim() === ''
    );
    const toDelete = noName.slice(0, 4);
    let deleted = 0;
    let renameCount = 0;

    const doDelete = (idx) => {
      if (idx >= toDelete.length) {
        db.run(
          "UPDATE cards SET student_name = 'ayesha' WHERE LOWER(TRIM(student_name)) = 'saeed iqbal'",
          [],
          function(err2) {
            if (err2) {
              console.error('Admin fix-cards rename error:', err2);
              return res.json({ success: true, deleted, renamed: 0, error: 'Rename failed' });
            }
            renameCount = this.changes;
            console.log(`Admin fix-cards: deleted ${deleted} cards without name, renamed ${renameCount} to ayesha`);
            res.json({ success: true, deleted, renamed: renameCount });
          }
        );
        return;
      }
      const row = toDelete[idx];
      db.run('DELETE FROM cards WHERE id = ?', [row.id], function(err2) {
        if (!err2 && this.changes > 0) deleted++;
        doDelete(idx + 1);
      });
    };

    doDelete(0);
  });
});

module.exports = router;
