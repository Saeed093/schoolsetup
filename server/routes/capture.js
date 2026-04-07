const express = require('express');
const router = express.Router();
const fs = require('fs');
const path = require('path');
const { getDatabase, logPickup } = require('../database/db');

const CAPTURES_DIR = path.join(__dirname, '..', 'uploads', 'captures');

// Ensure captures directory exists
if (!fs.existsSync(CAPTURES_DIR)) {
  fs.mkdirSync(CAPTURES_DIR, { recursive: true });
}

/**
 * Save a captured image to disk
 * @param {string} cardId - Card ID (used for filename)
 * @param {string} base64Data - Base64 encoded image data
 * @returns {string|null} - Path to saved image or null
 */
function saveCapturedImage(cardId, base64Data) {
  if (!base64Data || typeof base64Data !== 'string') return null;
  
  const base64 = base64Data.replace(/^data:image\/\w+;base64,/, '');
  const buf = Buffer.from(base64, 'base64');
  if (buf.length === 0) return null;
  
  const sanitized = String(cardId).replace(/[^a-zA-Z0-9_-]/g, '_') || 'card';
  // Use timestamp to make each capture unique
  const timestamp = Date.now();
  const filename = `${sanitized}_${timestamp}.jpg`;
  const filepath = path.join(CAPTURES_DIR, filename);
  
  fs.writeFileSync(filepath, buf);
  return '/uploads/captures/' + filename;
}

/**
 * POST /api/capture/scan
 * Handle RFID scan with optional captured image from CaptureStation
 * This is the main endpoint called when a card is scanned at the capture station
 * 
 * @param {string} card_id - Required. The RFID card ID
 * @param {string} captured_image - Optional. Base64 encoded image
 * @param {string} direction - Optional. 'in' for check-in, 'out' for check-out (default: 'out')
 * 
 * Card lookup logic:
 * - Check-OUT mode: looks up by card_id (checkout card)
 * - Check-IN mode: looks up by checkin_card_id first, then falls back to card_id
 */
router.post('/scan', (req, res) => {
  const { card_id, captured_image, direction } = req.body;
  
  if (!card_id) {
    return res.status(400).json({ success: false, message: 'card_id is required' });
  }

  // Direction: 'in' = check-in (arriving), 'out' = check-out/pickup (leaving)
  const scanDirection = direction === 'in' ? 'in' : 'out';
  const isCheckIn = scanDirection === 'in';

  const db = getDatabase();
  
  // Different lookup based on direction:
  // - Check-OUT: look up by card_id (the checkout RFID card)
  // - Check-IN: look up by checkin_card_id first, fall back to card_id
  const lookupQuery = isCheckIn 
    ? 'SELECT * FROM cards WHERE checkin_card_id = ? OR card_id = ?'
    : 'SELECT * FROM cards WHERE card_id = ?';
  const lookupParams = isCheckIn ? [card_id, card_id] : [card_id];

  db.get(lookupQuery, lookupParams, (err, row) => {
    if (err) {
      console.error('Error fetching card:', err);
      return res.status(500).json({ success: false, message: 'Database error' });
    }

    const isAuthorized = !!row;
    let capturedImagePath = '';
    
    // Save captured image if provided
    if (captured_image) {
      try {
        capturedImagePath = saveCapturedImage(card_id, captured_image);
        console.log('[Capture] Saved image:', capturedImagePath);
      } catch (e) {
        console.error('[Capture] Error saving image:', e);
      }
    }

    // Get the registered adult image (from cards table)
    const registeredAdultImage = row ? (row.adult_image ?? '') : '';
    
    // Use the primary card_id for logging (the checkout card ID from the student record)
    const primaryCardId = row ? row.card_id : card_id;
    
    // Build result object
    const result = {
      type: 'card_scan',
      card_id: primaryCardId, // Use the student's primary checkout card ID
      scanned_card_id: card_id, // The actual card that was scanned
      student_name: row ? (row.student_name ?? row.name) : 'Unknown',
      student_class: row ? (row.student_class ?? '') : '',
      adult_name: row ? (row.adult_name ?? '') : '',
      // adult_image should be the REGISTERED guardian image, not the captured one
      adult_image: registeredAdultImage,
      child_image: row ? (row.child_image ?? '') : '',
      captured_image: capturedImagePath, // The newly captured image at pickup
      pickup_image: capturedImagePath, // Same as captured_image for consistency
      direction: scanDirection, // 'in' or 'out'
      found: isAuthorized,
      alarm_enabled: row ? row.alarm_enabled : 0,
      timestamp: new Date().toISOString()
    };

    // Add cache-busting to captured images only
    if (result.captured_image) {
      result.captured_image = result.captured_image + '?t=' + Date.now();
      result.pickup_image = result.captured_image;
    }

    // Broadcast to all WebSocket clients
    if (global.broadcastToClients) {
      global.broadcastToClients(result);
      console.log(`[Capture] Broadcasted card_scan (direction: ${scanDirection}, scanned: ${card_id}, student: ${result.student_name})`);
    }

    // Log for authorized cards (both check-in and check-out)
    if (isAuthorized) {
      logPickup({
        ...result,
        card_id: primaryCardId, // Use primary card ID for consistent tracking
        // adult_image stays as registered image
        adult_image: registeredAdultImage,
        // pickup_image is the captured image at pickup time
        pickup_image: capturedImagePath || '',
        direction: scanDirection
      });
    }

    // Handle alarm if enabled (only on check-out, not check-in)
    if (!isCheckIn && row && row.alarm_enabled === 1) {
      console.log(`[Capture] Alarm enabled for ${card_id}`);
      if (global.sendAlarmToESP32) {
        global.sendAlarmToESP32();
      }
      if (global.triggerArduinoAlarm) {
        global.triggerArduinoAlarm();
      }
    }

    const actionMessage = isCheckIn ? 'Check-in recorded' : 'Pickup recorded';

    res.json({
      success: true,
      found: isAuthorized,
      student_name: result.student_name,
      student_class: result.student_class,
      captured_image: result.captured_image,
      direction: scanDirection,
      message: isAuthorized ? actionMessage : 'Unknown card'
    });
  });
});

/**
 * POST /api/capture/add-image
 * Add a captured image to an existing scan/pickup OR update direction only (for check-in mode)
 * Called by CaptureStation when it receives a card_scan event
 * 
 * @param {string} card_id - Required. The RFID card ID
 * @param {string} captured_image - Optional. Base64 encoded image (not required for check-in mode)
 * @param {string} direction - Optional. 'in' for check-in, 'out' for check-out (used in broadcast)
 */
router.post('/add-image', (req, res) => {
  const { card_id, captured_image, direction } = req.body;
  
  if (!card_id) {
    return res.status(400).json({ success: false, message: 'card_id is required' });
  }

  const scanDirection = direction === 'in' ? 'in' : 'out';
  const isCheckIn = scanDirection === 'in';
  const db = getDatabase();
  
  // Save the captured image (only if provided - not in check-in mode)
  let capturedImagePath = '';
  if (captured_image) {
    try {
      capturedImagePath = saveCapturedImage(card_id, captured_image);
      console.log('[Capture] Saved additional image:', capturedImagePath);
    } catch (e) {
      console.error('[Capture] Error saving image:', e);
      // Don't fail the request if image save fails in check-out mode
      if (!isCheckIn) {
        return res.status(500).json({ success: false, message: 'Failed to save image' });
      }
    }
  }

  // In check-out mode without a valid image, return error
  if (!isCheckIn && !capturedImagePath && captured_image) {
    return res.status(400).json({ success: false, message: 'Invalid image data' });
  }

  // Get card info to broadcast updated data
  // Use different lookup based on direction (check-in uses checkin_card_id)
  const lookupQuery = isCheckIn 
    ? 'SELECT * FROM cards WHERE checkin_card_id = ? OR card_id = ?'
    : 'SELECT * FROM cards WHERE card_id = ?';
  const lookupParams = isCheckIn ? [card_id, card_id] : [card_id];

  db.get(lookupQuery, lookupParams, (err, row) => {
    if (err) {
      console.error('Error fetching card:', err);
      return res.status(500).json({ success: false, message: 'Database error' });
    }

    // Use the primary card_id for tracking (checkout card ID)
    const primaryCardId = row ? row.card_id : card_id;
    const cacheBustedPath = capturedImagePath ? capturedImagePath + '?t=' + Date.now() : '';

    // Broadcast update
    if (global.broadcastToClients) {
      global.broadcastToClients({
        type: isCheckIn ? 'checkin_update' : 'pickup_image_update',
        card_id: primaryCardId,
        scanned_card_id: card_id,
        student_name: row ? (row.student_name ?? row.name) : 'Unknown',
        student_class: row ? (row.student_class ?? '') : '',
        adult_name: row ? (row.adult_name ?? '') : '',
        captured_image: cacheBustedPath,
        pickup_image: cacheBustedPath,
        adult_image: row ? (row.adult_image ?? '') : '',
        child_image: row ? (row.child_image ?? '') : '',
        direction: scanDirection,
        timestamp: new Date().toISOString()
      });
      console.log(`[Capture] Broadcasted ${isCheckIn ? 'checkin_update' : 'pickup_image_update'} (direction: ${scanDirection})`);
    }

    // Update the most recent pickup record for this card (use primary card_id for consistency)
    if (isCheckIn) {
      // Check-in mode: only update direction (no image)
      db.run(
        `UPDATE pickups SET direction = ? WHERE card_id = ? AND id = (SELECT MAX(id) FROM pickups WHERE card_id = ?)`,
        [scanDirection, primaryCardId, primaryCardId],
        (updateErr) => {
          if (updateErr) {
            console.error('[Capture] Error updating pickup direction:', updateErr);
          } else {
            console.log(`[Capture] Updated pickup direction to: ${scanDirection}`);
          }
        }
      );
    } else {
      // Check-out mode: update both image and direction
      db.run(
        `UPDATE pickups SET pickup_image = ?, direction = ? WHERE card_id = ? AND id = (SELECT MAX(id) FROM pickups WHERE card_id = ?)`,
        [capturedImagePath, scanDirection, primaryCardId, primaryCardId],
        (updateErr) => {
          if (updateErr) {
            console.error('[Capture] Error updating pickup:', updateErr);
          } else {
            console.log(`[Capture] Updated pickup with image and direction: ${scanDirection}`);
          }
        }
      );
    }

    res.json({
      success: true,
      captured_image: cacheBustedPath || null,
      direction: scanDirection
    });
  });
});

module.exports = router;
