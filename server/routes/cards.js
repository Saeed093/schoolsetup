const express = require('express');
const fs = require('fs');
const path = require('path');
const router = express.Router();
const { getDatabase } = require('../database/db');
const { syncAdultFromGuardians } = require('../utils/cardDisplay');

const CARD_UPLOADS_DIR = path.join(__dirname, '..', 'uploads', 'cards');

const ALLOWED_RELATIONS = new Set(['father', 'mother', 'driver', 'other']);

function ensureUploadsDir() {
  fs.mkdirSync(CARD_UPLOADS_DIR, { recursive: true });
}

function parseDataUrlImage(dataUrl) {
  if (!dataUrl || typeof dataUrl !== 'string') return null;
  const match = dataUrl.match(/^data:image\/(png|jpe?g|webp);base64,(.+)$/i);
  if (!match) return null;
  const mimeSubtype = match[1].toLowerCase();
  const base64Payload = match[2];
  const ext = mimeSubtype === 'jpeg' ? 'jpg' : mimeSubtype;
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

function saveGuardianImage(cardDbId, index, dataUrl) {
  const parsed = parseDataUrlImage(dataUrl);
  if (!parsed) return null;
  const buf = Buffer.from(parsed.base64Payload, 'base64');
  if (!buf || buf.length === 0) return null;
  ensureUploadsDir();
  const idPart = String(cardDbId).replace(/[^0-9]/g, '') || '0';
  const filename = `guardian_${idPart}_${index}.${parsed.ext}`;
  const filepath = path.join(CARD_UPLOADS_DIR, filename);
  fs.writeFileSync(filepath, buf);
  return `/uploads/cards/${filename}`;
}

function normalizeDescriptor(d) {
  if (!Array.isArray(d)) return null;
  const nums = d.map((x) => Number(x)).filter((n) => !Number.isNaN(n));
  if (nums.length !== 128) return null;
  return nums;
}

/**
 * Process raw guardian rows from client: save new data URLs, keep existing paths, validate descriptors.
 */
function processGuardiansInput(rawList, cardDbId) {
  const list = Array.isArray(rawList) ? rawList.slice(0, 5) : [];
  const out = [];
  for (let i = 0; i < list.length; i++) {
    const g = list[i] || {};
    const name = String(g.name || '').trim();
    let relation = String(g.relation || 'other').toLowerCase();
    if (!ALLOWED_RELATIONS.has(relation)) relation = 'other';
    const relationOther = relation === 'other' ? String(g.relationOther || '').trim() : '';
    let image = typeof g.image === 'string' ? g.image.trim() : '';
    if (parseDataUrlImage(image)) {
      const saved = saveGuardianImage(cardDbId, out.length, image);
      image = saved || '';
    }
    if (image) {
      image = image.split('?')[0];
    }
    const descriptor = normalizeDescriptor(g.descriptor);
    if (!name && !image && !descriptor) continue;
    out.push({ name, relation, relationOther, image, descriptor });
  }
  const { adult_name, adult_image } = syncAdultFromGuardians(out);
  return {
    guardians: out,
    guardians_json: JSON.stringify(out),
    adult_name,
    adult_image
  };
}

function guardiansFromBodyOrLegacy(body) {
  if (Array.isArray(body.guardians)) {
    return body.guardians;
  }
  const name = typeof body.adult_name === 'string' ? body.adult_name : '';
  const image = typeof body.adult_image === 'string' ? body.adult_image : '';
  if (!name && !image) return [];
  return [
    {
      name,
      relation: 'other',
      relationOther: '',
      image,
      descriptor: normalizeDescriptor(body.guardian_descriptor) || null
    }
  ];
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
  const {
    card_id,
    checkin_card_id,
    student_name,
    student_class,
    child_image,
    alarm_enabled
  } = req.body;

  if (!card_id || !student_name) {
    return res.status(400).json({ error: 'card_id and student_name are required' });
  }

  const incomingChildImage = typeof child_image === 'string' ? child_image : '';
  const childIsDataUrl = !!parseDataUrlImage(incomingChildImage);

  db.run(
    `INSERT INTO cards (card_id, checkin_card_id, student_name, student_class, adult_name, adult_image, child_image, alarm_enabled, guardians_json) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      card_id,
      checkin_card_id || '',
      student_name,
      student_class || '',
      '',
      '',
      childIsDataUrl ? '' : (incomingChildImage || ''),
      alarm_enabled ? 1 : 0,
      '[]'
    ],
    function (err) {
      if (err) {
        if (err.message.includes('UNIQUE constraint')) {
          return res.status(409).json({ error: 'Card ID already exists' });
        }
        console.error('Error creating card:', err);
        return res.status(500).json({ error: 'Failed to create card' });
      }

      const newId = this.lastID;
      const rawGuardians = guardiansFromBodyOrLegacy(req.body);
      const proc = processGuardiansInput(rawGuardians, newId);

      let savedChild = childIsDataUrl ? saveCardImage(newId, 'child', incomingChildImage) : (incomingChildImage || '');

      db.run(
        `UPDATE cards SET guardians_json = ?, adult_name = ?, adult_image = ?, child_image = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?`,
        [proc.guardians_json, proc.adult_name, proc.adult_image, savedChild || '', newId],
        (err2) => {
          if (err2) console.error('Error updating card after create:', err2);
          res.status(201).json({
            id: newId,
            card_id,
            checkin_card_id: checkin_card_id || '',
            student_name,
            student_class: student_class || '',
            adult_name: proc.adult_name,
            adult_image: proc.adult_image,
            child_image: savedChild || '',
            guardians_json: proc.guardians_json,
            alarm_enabled: alarm_enabled ? 1 : 0
          });
        }
      );
    }
  );
});

// Update a card
router.put('/:id', (req, res) => {
  const db = getDatabase();
  const paramId = req.params.id;
  const {
    student_name,
    student_class,
    child_image,
    card_id,
    checkin_card_id,
    alarm_enabled
  } = req.body;

  if (!student_name) {
    return res.status(400).json({ error: 'student_name is required' });
  }

  db.get('SELECT * FROM cards WHERE id = ?', [paramId], (err, row) => {
    if (err) {
      console.error('Error fetching card:', err);
      return res.status(500).json({ error: 'Failed to update card' });
    }
    if (!row) {
      return res.status(404).json({ error: 'Card not found' });
    }

    const numericId = row.id;
    const updateFields = [];
    const values = [];

    updateFields.push('student_name = ?');
    values.push(student_name);

    if (typeof student_class === 'string') {
      updateFields.push('student_class = ?');
      values.push(student_class);
    }

    if (Object.prototype.hasOwnProperty.call(req.body, 'guardians')) {
      const rawGuardians = Array.isArray(req.body.guardians) ? req.body.guardians : [];
      const proc = processGuardiansInput(rawGuardians, numericId);
      updateFields.push('guardians_json = ?');
      values.push(proc.guardians_json);
      updateFields.push('adult_name = ?');
      values.push(proc.adult_name);
      updateFields.push('adult_image = ?');
      values.push(proc.adult_image);
    } else {
      if (typeof req.body.adult_name === 'string') {
        updateFields.push('adult_name = ?');
        values.push(req.body.adult_name);
      }
      if (typeof req.body.adult_image === 'string') {
        const saved = parseDataUrlImage(req.body.adult_image)
          ? saveCardImage(numericId, 'adult', req.body.adult_image)
          : null;
        updateFields.push('adult_image = ?');
        values.push(saved ?? req.body.adult_image);
      }
    }

    if (typeof child_image === 'string') {
      const saved = parseDataUrlImage(child_image) ? saveCardImage(numericId, 'child', child_image) : null;
      updateFields.push('child_image = ?');
      values.push(saved ?? child_image);
    }

    if (card_id) {
      updateFields.push('card_id = ?');
      values.push(card_id);
    }

    if (typeof checkin_card_id === 'string') {
      updateFields.push('checkin_card_id = ?');
      values.push(checkin_card_id);
    }

    if (typeof alarm_enabled === 'boolean') {
      updateFields.push('alarm_enabled = ?');
      values.push(alarm_enabled ? 1 : 0);
    }

    updateFields.push('updated_at = CURRENT_TIMESTAMP');
    values.push(paramId);

    db.run(`UPDATE cards SET ${updateFields.join(', ')} WHERE id = ?`, values, function (err2) {
      if (err2) {
        if (err2.message.includes('UNIQUE constraint')) {
          return res.status(409).json({ error: 'Card ID already exists' });
        }
        console.error('Error updating card:', err2);
        return res.status(500).json({ error: 'Failed to update card' });
      }
      if (this.changes === 0) {
        return res.status(404).json({ error: 'Card not found' });
      }
      res.json({ message: 'Card updated successfully' });
    });
  });
});

// Delete a card (by numeric id or by card_id/RFID string so reassignment works)
router.delete('/:id', (req, res) => {
  const db = getDatabase();
  const param = req.params.id;
  const numericId = parseInt(param, 10);
  const isNumeric = String(numericId) === String(param) && !Number.isNaN(numericId) && numericId > 0;

  const runDelete = (sql, bindings) => {
    db.run(sql, bindings, function (delErr) {
      if (delErr) {
        console.error('Error deleting card:', delErr);
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
    runDelete('DELETE FROM cards WHERE card_id = ?', [param]);
  }
});

module.exports = router;
