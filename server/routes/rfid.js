const express = require('express');
const router = express.Router();
const { getDatabase } = require('../database/db');
const { activateReader, deactivateReader, getReaderStatus } = require('../services/rfidService');

// Get reader status
router.get('/status', (req, res) => {
  const status = getReaderStatus();
  res.json(status);
});

// Activate RFID reader (for ESP32 integration)
router.post('/activate', (req, res) => {
  try {
    activateReader();
    res.json({ message: 'RFID reader activated', status: 'active' });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Deactivate RFID reader (for ESP32 integration)
router.post('/deactivate', (req, res) => {
  try {
    deactivateReader();
    res.json({ message: 'RFID reader deactivated', status: 'inactive' });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Manual card scan endpoint (for testing)
router.post('/scan', (req, res) => {
  const { card_id } = req.body;
  
  if (!card_id) {
    return res.status(400).json({ error: 'card_id is required' });
  }

  const db = getDatabase();
  db.get('SELECT * FROM cards WHERE card_id = ?', [card_id], (err, row) => {
    if (err) {
      console.error('Error fetching card:', err);
      return res.status(500).json({ error: 'Failed to fetch card' });
    }
    
    // Add cache-busting for captured images (from Admin page)
    let adultImage = row ? (row.adult_image ?? '') : '';
    if (adultImage && adultImage.includes('/uploads/captures/')) {
      adultImage = adultImage + '?t=' + Date.now();
    }
    
    const result = {
      card_id,
      student_name: row ? (row.student_name ?? row.name) : 'Unknown',
      student_class: row ? (row.student_class ?? '') : '',
      adult_name: row ? (row.adult_name ?? '') : '',
      adult_image: adultImage,
      child_image: row ? (row.child_image ?? '') : '',
      found: !!row,
      alarm_enabled: row ? row.alarm_enabled : 0,
      timestamp: new Date().toISOString()
    };

    // Broadcast to WebSocket clients
    if (global.broadcastToClients) {
      global.broadcastToClients({
        type: 'card_scan',
        ...result
      });
    }

    // If alarm is enabled for this card, trigger ESP32 alarm
    if (row && row.alarm_enabled === 1) {
      console.log(`🚨 Manual scan: Alarm enabled for card ${card_id} - Sending ALARM to ESP32!`);
      if (global.sendAlarmToESP32) {
        global.sendAlarmToESP32();
      }
    }

    res.json(result);
  });
});

// Test endpoint to manually trigger ESP32 alarm (for debugging)
router.post('/test-alarm', (req, res) => {
  console.log('🚨 TEST ALARM ENDPOINT CALLED');
  
  if (global.sendAlarmToESP32) {
    console.log('📤 Sending ALARM to all ESP32 devices...');
    global.sendAlarmToESP32();
    res.json({ 
      success: true, 
      message: 'ALARM sent to all connected ESP32 devices',
      timestamp: new Date().toISOString()
    });
  } else {
    console.error('❌ sendAlarmToESP32 function not available!');
    res.status(500).json({ 
      success: false, 
      error: 'sendAlarmToESP32 function not available' 
    });
  }
});

module.exports = router;
