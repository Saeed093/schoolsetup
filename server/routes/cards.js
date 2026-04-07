const express = require('express');
const fs = require('fs');
const path = require('path');
const router = express.Router();
const { getDatabase } = require('../database/db');

const CARD_UPLOADS_DIR = path.join(__dirname, '..', 'uploads', 'cards');

function ensureUploadsDir() {
  fs.mkdirSync(CARD_UPLOADS_DIR, { recursive: true });
}

function parseDataUrlImage(dataUrl) {
  if (!dataUrl || typeof dataUrl !== 'string') return null;
  const match = dataUrl.match(/^data:image\/(png|jpe?g|webp);base64,(.+)$/i);
  if (!match) return null;
  const mimeSubtype = match[1].toLowerCase();
  const base64Payload = match[2];
  const ext = mimeSubtype === 'jpeg' ? 'jpg' : mimeSubtype; // normalize
  return { ext, base64Payload };
}

function saveCardImage(cardDbId, kind, dataUrl) {
  const parsed = parseDataUrlImage(dataUrl);
  if (!parsed) return null;

  const buf = Buffer.from(parsed.base64Payload, 'base64');
  if (!buf || buf.length === 0) return null;

  ensureUploadsDir();
  const safeKind = kind === 'adult' ? 'adult' : 'child';
  const filename = `${safeKind}_${String(cardDbId).replace(/[^0-9]/g, '') || '0'}.${parsed.ext}`;
  const filepath = path.join(CARD_UPLOADS_DIR, filename);
  fs.writeFileSync(filepath, buf);
  return `/uploads/cards/${filename}`;
}

// Get all cards
router.get('/', (req, res) => {
  const db = getDatabase();
  db.all('SELECT * FROM cards ORDER BY student_name ASC', (err, rows) => {
    if (err) {
      console.error('Error fetching cards:', err);
      return res.status(500).json({ error: 'Failed to fetch cards' });
    }
    res.json(rows);
  });
});

// Get a card by card_id (RFID card ID)
router.get('/card/:cardId', (req, res) => {
  const db = getDatabase();
  const cardId = req.params.cardId;
  
  db.get('SELECT * FROM cards WHERE card_id = ?', [cardId], (err, row) => {
    if (err) {
      console.error('Error fetching card:', err);
      return res.status(500).json({ error: 'Failed to fetch card' });
    }
    res.json(row || null);
  });
});

// Get a single card by ID
router.get('/:id', (req, res) => {
  const db = getDatabase();
  const cardId = req.params.id;
  
  db.get('SELECT * FROM cards WHERE id = ?', [cardId], (err, row) => {
    if (err) {
      console.error('Error fetching card:', err);
      return res.status(500).json({ error: 'Failed to fetch card' });
    }
    if (!row) {
      return res.status(404).json({ error: 'Card not found' });
    }
    res.json(row);
  });
});

// Create a new card
router.post('/', (req, res) => {
  const db = getDatabase();
  const { card_id, checkin_card_id, student_name, student_class, adult_name, adult_image, child_image, alarm_enabled } = req.body;

  if (!card_id || !student_name) {
    return res.status(400).json({ error: 'card_id and student_name are required' });
  }

  const incomingAdultImage = typeof adult_image === 'string' ? adult_image : '';
  const incomingChildImage = typeof child_image === 'string' ? child_image : '';
  const adultIsDataUrl = !!parseDataUrlImage(incomingAdultImage);
  const childIsDataUrl = !!parseDataUrlImage(incomingChildImage);

  // Insert first to get DB id, then save images (if data URLs) and update record with URL paths
  db.run(
    'INSERT INTO cards (card_id, checkin_card_id, student_name, student_class, adult_name, adult_image, child_image, alarm_enabled) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
    [
      card_id,
      checkin_card_id || '',
      student_name,
      student_class || '',
      adult_name || '',
      adultIsDataUrl ? '' : (incomingAdultImage || ''),
      childIsDataUrl ? '' : (incomingChildImage || ''),
      alarm_enabled ? 1 : 0
    ],
    function(err) {
      if (err) {
        if (err.message.includes('UNIQUE constraint')) {
          return res.status(409).json({ error: 'Card ID already exists' });
        }
        console.error('Error creating card:', err);
        return res.status(500).json({ error: 'Failed to create card' });
      }

      const newId = this.lastID;
      let savedAdult = adultIsDataUrl ? saveCardImage(newId, 'adult', incomingAdultImage) : (incomingAdultImage || '');
      let savedChild = childIsDataUrl ? saveCardImage(newId, 'child', incomingChildImage) : (incomingChildImage || '');

      if (adultIsDataUrl || childIsDataUrl) {
        db.run(
          'UPDATE cards SET adult_image = ?, child_image = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?',
          [savedAdult || '', savedChild || '', newId],
          (err2) => {
            if (err2) console.error('Error updating images after create:', err2);
            res.status(201).json({
              id: newId,
              card_id,
              checkin_card_id: checkin_card_id || '',
              student_name,
              student_class: student_class || '',
              adult_name: adult_name || '',
              adult_image: savedAdult || '',
              child_image: savedChild || '',
              alarm_enabled: alarm_enabled ? 1 : 0
            });
          }
        );
        return;
      }

      res.status(201).json({
        id: newId,
        card_id,
        checkin_card_id: checkin_card_id || '',
        student_name,
        student_class: student_class || '',
        adult_name: adult_name || '',
        adult_image: savedAdult || '',
        child_image: savedChild || '',
        alarm_enabled: alarm_enabled ? 1 : 0
      });
    }
  );
});

// Update a card
router.put('/:id', (req, res) => {
  const db = getDatabase();
  const cardId = req.params.id;
  const { student_name, student_class, adult_name, adult_image, child_image, card_id, checkin_card_id, alarm_enabled } = req.body;

  if (!student_name) {
    return res.status(400).json({ error: 'student_name is required' });
  }

  const updateFields = [];
  const values = [];

  if (student_name) {
    updateFields.push('student_name = ?');
    values.push(student_name);
  }

  if (typeof student_class === 'string') {
    updateFields.push('student_class = ?');
    values.push(student_class);
  }

  if (typeof adult_name === 'string') {
    updateFields.push('adult_name = ?');
    values.push(adult_name);
  }

  if (typeof adult_image === 'string') {
    // If we received a base64 data URL, save it to disk and store a URL path instead
    const saved = parseDataUrlImage(adult_image) ? saveCardImage(cardId, 'adult', adult_image) : null;
    updateFields.push('adult_image = ?');
    values.push(saved ?? adult_image);
  }

  if (typeof child_image === 'string') {
    const saved = parseDataUrlImage(child_image) ? saveCardImage(cardId, 'child', child_image) : null;
    updateFields.push('child_image = ?');
    values.push(saved ?? child_image);
  }

  if (card_id) {
    updateFields.push('card_id = ?');
    values.push(card_id);
  }

  // Allow checkin_card_id to be updated (can be empty string to clear it)
  if (typeof checkin_card_id === 'string') {
    updateFields.push('checkin_card_id = ?');
    values.push(checkin_card_id);
  }

  if (typeof alarm_enabled === 'boolean') {
    updateFields.push('alarm_enabled = ?');
    values.push(alarm_enabled ? 1 : 0);
  }

  updateFields.push('updated_at = CURRENT_TIMESTAMP');
  values.push(cardId);

  db.run(
    `UPDATE cards SET ${updateFields.join(', ')} WHERE id = ?`,
    values,
    function(err) {
      if (err) {
        if (err.message.includes('UNIQUE constraint')) {
          return res.status(409).json({ error: 'Card ID already exists' });
        }
        console.error('Error updating card:', err);
        return res.status(500).json({ error: 'Failed to update card' });
      }
      if (this.changes === 0) {
        return res.status(404).json({ error: 'Card not found' });
      }
      res.json({ message: 'Card updated successfully' });
    }
  );
});

// Delete a card (by numeric id or by card_id/RFID string so reassignment works)
router.delete('/:id', (req, res) => {
  const db = getDatabase();
  const param = req.params.id;
  const numericId = parseInt(param, 10);
  const isNumeric = String(numericId) === String(param) && !Number.isNaN(numericId) && numericId > 0;

  const runDelete = (sql, bindings) => {
    db.run(sql, bindings, function(err) {
      if (err) {
        console.error('Error deleting card:', err);
        return res.status(500).json({ error: 'Failed to delete card' });
      }
      if (this.changes === 0) {
        return res.status(404).json({ error: 'Card not found' });
      }
      res.json({ message: 'Card deleted successfully' });
    });
  };

  if (isNumeric) {
    runDelete('DELETE FROM cards WHERE id = ?', [numericId]);
  } else {
    // Treat as card_id (RFID) so deleting by RFID or wrong id still works and card can be reassigned
    runDelete('DELETE FROM cards WHERE card_id = ?', [param]);
  }
});

module.exports = router;
