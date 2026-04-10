// Try to load serialport - it's optional (has native dependencies that may fail to install)
let SerialPort = null;
let ReadlineParser = null;
let serialportAvailable = false;

try {
  const serialport = require('serialport');
  SerialPort = serialport.SerialPort;
  ReadlineParser = serialport.ReadlineParser;
  serialportAvailable = true;
  console.log('✅ Serialport module loaded successfully');
} catch (error) {
  console.warn('⚠️ Serialport module not available:', error.message);
  console.warn('   Physical RFID reader support is disabled.');
  console.warn('   You can still use manual card entry or keyboard-wedge scanners.');
}

const { getDatabase } = require('../database/db');

let serialPort = null;
let parser = null;
let isActive = true; // Reader is active by default
let readerStatus = {
  connected: false,
  active: true,
  port: null,
  serialportAvailable: serialportAvailable
};
let lastScanTime = 0;
let lastScanId = '';
const SCAN_DEBOUNCE_MS = 2000; // Prevent duplicate scans within 2 seconds

// Common baud rates for RFID readers
const BAUD_RATES = [9600, 115200, 57600, 38400, 19200];

// Initialize RFID reader
async function initializeRFIDReader() {
  // Check if serialport is available
  if (!serialportAvailable || !SerialPort) {
    console.log('ℹ️ Serialport not available - skipping physical RFID reader initialization');
    console.log('   Use manual card entry or keyboard-wedge (HID) scanners instead.');
    return;
  }

  try {
    const ports = await SerialPort.list();
    console.log('Available serial ports:', ports.map(p => p.path));

    // Try to find and connect to RFID reader
    // Most RFID readers use COM ports on Windows
    const candidatePorts = ports.filter(port =>
      port.path?.includes('COM') ||
      port.manufacturer?.toLowerCase().includes('rfid') ||
      port.manufacturer?.toLowerCase().includes('serial')
    );

    if (candidatePorts.length === 0) {
      console.warn('No RFID reader found. Please connect your USB RFID reader.');
      console.warn('You can still use the application by manually entering card IDs.');
      return;
    }

    console.log('Note: If you get "Access denied" errors, the port may be in use by another application.');

    // Try candidate ports (COM ports) and multiple baud rates until we connect
    for (const candidatePort of candidatePorts) {
      if (readerStatus.connected) break;

      console.log(`Connecting to RFID reader on ${candidatePort.path}...`);

      // Try different baud rates
      for (const baudRate of BAUD_RATES) {
        try {
          serialPort = new SerialPort({
            path: candidatePort.path,
            baudRate: baudRate,
            autoOpen: false
          });

        // ReadlineParser delimiter must be a string/Buffer (NOT a RegExp).
        // Use '\n' and strip '\r' in the handler so it works for '\n' or '\r\n' devices.
        parser = serialPort.pipe(new ReadlineParser({
          delimiter: '\n',
          encoding: 'utf8'
        }));

        serialPort.open((err) => {
          if (err) {
            if (err.message.includes('Access denied')) {
              console.log(`Failed to open at ${baudRate} baud: Access denied - Port may be in use or requires admin privileges`);
            } else {
              console.log(`Failed to open at ${baudRate} baud:`, err.message);
            }
            return;
          }

          console.log(`Successfully connected to RFID reader at ${baudRate} baud`);
          readerStatus.connected = true;
          readerStatus.port = candidatePort.path;
          readerStatus.active = isActive;

          // Handle incoming data - log raw data for debugging
          parser.on('data', (data) => {
            if (!isActive) {
              console.log('Reader is inactive, ignoring scan');
              return;
            }

            const rawData = data.toString().replace(/\r/g, '');
            console.log('Raw data received from RFID reader:', JSON.stringify(rawData));
            
            // Extract card ID - remove all non-alphanumeric characters except numbers and letters
            // Handle formats like "> 0087719321" or "← 87719321"
            let cardId = rawData.trim();
            console.log('Trimmed card ID:', JSON.stringify(cardId));
            
            // Remove all non-alphanumeric characters (keep only 0-9, A-Z, a-z)
            let cleanCardId = cardId.replace(/[^0-9A-Za-z]/g, '');
            
            // If that removed everything, try keeping the original but uppercase
            if (!cleanCardId || cleanCardId.length === 0) {
              cleanCardId = cardId.replace(/[^0-9]/g, ''); // Try keeping only numbers
            }
            
            // Convert to uppercase for consistency
            cleanCardId = cleanCardId.toUpperCase();
            
            console.log('Cleaned card ID:', cleanCardId, 'Length:', cleanCardId.length);

            if (cleanCardId && cleanCardId.length > 0) {
              console.log('Processing card scan with ID:', cleanCardId);
              handleCardScan(cleanCardId);
            } else {
              console.warn('Empty card ID after cleaning, ignoring. Original was:', JSON.stringify(rawData));
            }
          });

          // Also listen to raw data as a fallback (some readers don't use line endings)
          let rawBuffer = '';
          serialPort.on('data', (data) => {
            const dataStr = data.toString();
            rawBuffer += dataStr;
            console.log('Raw serial chunk received:', JSON.stringify(dataStr));
            
            // If we get a complete line or a timeout, process it
            // Look for card ID patterns (8+ digits)
            const cardIdMatch = rawBuffer.match(/(\d{8,})/);
            if (cardIdMatch) {
              const potentialCardId = cardIdMatch[1];
              console.log('Potential card ID found in raw buffer:', potentialCardId);
              
              // Clear buffer after a short delay to avoid duplicates
              setTimeout(() => {
                if (rawBuffer.includes(potentialCardId)) {
                  console.log('Processing card ID from raw buffer:', potentialCardId);
                  const cleanId = potentialCardId.replace(/[^0-9A-Za-z]/g, '');
                  if (cleanId && cleanId.length >= 8) {
                    handleCardScan(cleanId);
                  }
                  rawBuffer = ''; // Clear buffer
                }
              }, 100);
            }
            
            // Clear buffer if it gets too large (prevent memory issues)
            if (rawBuffer.length > 100) {
              rawBuffer = '';
            }
          });

          serialPort.on('error', (err) => {
            console.error('Serial port error:', err);
            readerStatus.connected = false;
          });

          serialPort.on('close', () => {
            console.log('Serial port closed');
            readerStatus.connected = false;
          });
        });

          // Wait a bit to see if connection succeeds
          await new Promise(resolve => setTimeout(resolve, 1000));
          if (readerStatus.connected) {
            break;
          }
        } catch (error) {
          console.log(`Error trying baud rate ${baudRate}:`, error.message);
          if (serialPort) {
            try {
              if (serialPort.isOpen || serialPort.opening) {
                serialPort.close();
              }
            } catch (closeError) {
              // Ignore close errors
            }
          }
        }
      }
    }

    if (!readerStatus.connected) {
      console.warn('Could not connect to RFID reader. Please check the connection and try again.');
    }
  } catch (error) {
    console.error('Error initializing RFID reader:', error);
  }
}

// Handle card scan
function handleCardScan(cardId) {
  // Debounce: ignore if same card scanned within debounce period
  const now = Date.now();
  if (cardId === lastScanId && (now - lastScanTime) < SCAN_DEBOUNCE_MS) {
    console.log(`Ignoring duplicate scan of ${cardId} (debounced)`);
    return;
  }
  
  lastScanTime = now;
  lastScanId = cardId;
  
  console.log(`\n=== CARD SCAN DETECTED ===`);
  console.log(`Card ID: ${cardId}`);
  console.log(`Card ID length: ${cardId.length}`);

  const db = getDatabase();
  if (!db) {
    console.error('Database not available!');
    return;
  }

  // Try to find the card by card_id (checkout) OR checkin_card_id (checkin)
  // This allows the physical RFID reader to work with both check-in and check-out cards
  db.get('SELECT * FROM cards WHERE card_id = ? OR checkin_card_id = ?', [cardId, cardId], (err, row) => {
    if (err) {
      console.error('Error fetching card from database:', err);
      // Still broadcast even if database error
      const errorResult = {
        type: 'card_scan',
        card_id: cardId,
        name: 'Database Error',
        found: false,
        timestamp: new Date().toISOString()
      };
      if (global.broadcastToClients) {
        global.broadcastToClients(errorResult);
      }
      return;
    }

    // If not found, try without leading zeros
    if (!row && cardId.match(/^0+/)) {
      const cardIdNoZeros = cardId.replace(/^0+/, '');
      console.log(`Card not found with leading zeros, trying without: ${cardIdNoZeros}`);
      db.get('SELECT * FROM cards WHERE card_id = ? OR checkin_card_id = ?', [cardIdNoZeros, cardIdNoZeros], (err2, row2) => {
        if (err2) {
          console.error('Error in second lookup:', err2);
        }
        const finalRow = row2 || row;
        broadcastResult(cardId, finalRow);
      });
    } else {
      broadcastResult(cardId, row);
    }
  });
}

// Helper function to broadcast the result
function broadcastResult(scannedCardId, row) {
  const isAuthorized = !!row;
  const { getGuardiansForRow, guardiansCompactForScan } = require('../utils/cardDisplay');

  // Use the primary card_id (checkout card) for tracking, even if a check-in card was scanned
  const primaryCardId = row ? row.card_id : scannedCardId;

  // Add cache-busting for captured images (in /uploads/captures/)
  let adultImage = row ? (row.adult_image ?? '') : '';
  if (adultImage && adultImage.includes('/uploads/captures/')) {
    adultImage = adultImage + '?t=' + Date.now();
  }

  const guardiansList = row ? getGuardiansForRow(row) : [];
  const guardiansVerify = guardiansCompactForScan(guardiansList);

  const result = {
    type: 'card_scan',
    card_id: primaryCardId, // Use primary checkout card ID for tracking
    scanned_card_id: scannedCardId, // The actual card that was scanned
    student_name: row ? (row.student_name ?? row.name) : 'Unknown',
    student_class: row ? (row.student_class ?? '') : '',
    adult_name: row ? (row.adult_name ?? '') : '',
    adult_image: adultImage,
    child_image: row ? (row.child_image ?? '') : '',
    guardians: guardiansVerify,
    // backward-compat alias (older UI code)
    name: row ? (row.student_name ?? row.name) : 'Unknown',
    found: isAuthorized,
    timestamp: new Date().toISOString()
  };

  console.log('Card lookup result:', result);
  console.log('Broadcasting card scan to WebSocket clients...');
  
  // Broadcast to all WebSocket clients
  if (global.broadcastToClients) {
    global.broadcastToClients(result);
    console.log('✅ Card scan broadcasted successfully');
  } else {
    console.error('❌ broadcastToClients function not available!');
  }

  // Log pickup for Principal view (authorized scans only)
  // Note: Direction will be set by CaptureStation when it processes this scan
  if (isAuthorized) {
    try {
      const { logPickup } = require('../database/db');
      logPickup({
        ...result,
        card_id: primaryCardId // Use primary card ID for consistent tracking
      });
    } catch (e) {
      console.error('logPickup error:', e);
    }
  }

  // Check if alarm is enabled for this card (from management page)
  if (row && row.alarm_enabled === 1) {
    console.log(`🚨 ALARM ENABLED for card ${scannedCardId} (${row.student_name ?? row.name}) - Sending ALARM to ESP32!`);
    
    // Send to ESP32 devices (new implementation)
    if (global.sendAlarmToESP32) {
      console.log('📤 Calling sendAlarmToESP32()...');
      global.sendAlarmToESP32(); // Send to all ESP32 devices
    } else {
      console.error('❌ sendAlarmToESP32 function not available!');
    }
    
    // Also trigger legacy Arduino alarm
    if (global.triggerArduinoAlarm) {
      global.triggerArduinoAlarm();
    }
  } else {
    console.log(`ℹ️ Card ${scannedCardId}: alarm_enabled = ${row ? row.alarm_enabled : 'N/A (card not found)'}`);
  }
  
  console.log(`=== END CARD SCAN ===\n`);
}

// Activate reader
function activateReader() {
  isActive = true;
  readerStatus.active = true;
  console.log('RFID reader activated');
}

// Deactivate reader
function deactivateReader() {
  isActive = false;
  readerStatus.active = false;
  console.log('RFID reader deactivated');
}

// Get reader status
function getReaderStatus() {
  return { ...readerStatus };
}

// Close serial port
function closeReader() {
  if (!serialportAvailable) return;
  
  if (serialPort) {
    try {
      if (serialPort.isOpen || serialPort.opening) {
        serialPort.close();
      }
      readerStatus.connected = false;
    } catch (error) {
      console.error('Error closing serial port:', error);
      readerStatus.connected = false;
    }
  }
}

module.exports = {
  initializeRFIDReader,
  activateReader,
  deactivateReader,
  getReaderStatus,
  closeReader
};
