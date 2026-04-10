const express = require('express');
const cors = require('cors');
const http = require('http');
const WebSocket = require('ws');
const path = require('path');
const url = require('url');
const os = require('os');
require('dotenv').config();

const app = express();
const server = http.createServer(app);
const wss = new WebSocket.Server({ noServer: true });
const arduinoWss = new WebSocket.Server({ noServer: true });
const esp32Wss = new WebSocket.Server({ noServer: true });

const cardRoutes = require('./routes/cards');
const rfidRoutes = require('./routes/rfid');
const adminRoutes = require('./routes/admin');
const principalRoutes = require('./routes/principal');
const captureRoutes = require('./routes/capture');
const { initializeDatabase } = require('./database/db');
const { initializeRFIDReader } = require('./services/rfidService');

// Middleware
app.use(cors());
// Large base64 images (several guardians) expand ~4/3 in JSON — allow headroom
app.use(express.json({ limit: '70mb' }));

// Serve captured images (saved when card is scanned with camera)
const uploadsPath = path.join(__dirname, 'uploads');
app.use('/uploads', express.static(uploadsPath));

// Routes
app.use('/api/cards', cardRoutes);
app.use('/api/rfid', rfidRoutes);
app.use('/api/admin', adminRoutes);
app.use('/api/principal', principalRoutes);
app.use('/api/capture', captureRoutes);

// API endpoint to get WebSocket connection info
app.get('/api/websocket-info', (req, res) => {
  const localIP = getLocalIPAddress();
  const port = process.env.PORT || 5000;
  res.json({
    localIP,
    port,
    webSocketUrl: `ws://${localIP}:${port}/`,
    arduinoWebSocketUrl: `ws://${localIP}:${port}/ws/ping`,
    esp32WebSocketUrl: `ws://${localIP}:${port}/ws/esp32?device_id=<device_id>`,
    arduinoConfig: {
      host: localIP,
      port: port,
      path: '/ws/ping'
    },
    esp32Config: {
      host: localIP,
      port: port,
      path: '/ws/esp32?device_id=<device_id>'
    }
  });
});

// WebSocket connection handling for web clients
const clients = new Set();

wss.on('connection', (ws, req) => {
  clients.add(ws);
  // Optional: uncomment to log connections: console.log(`Web client connected. Total: ${clients.size}`);

  ws.on('message', (message) => {
    // Silently ignore or log only if needed
  });

  ws.on('error', () => {
    // Silently handle WebSocket errors (e.g., invalid frames from RFID data)
  });

  ws.on('close', () => {
    clients.delete(ws);
    // Optional: uncomment to log disconnections: console.log(`Web client disconnected. Total: ${clients.size}`);
  });

  // Send a welcome message to confirm connection
  ws.send(JSON.stringify({ type: 'connection', message: 'WebSocket connected successfully' }));

  // Send current Arduino connection status immediately (so UI can show status on page load)
  try {
    ws.send(JSON.stringify({
      type: 'arduino_status',
      connected: arduinoClients.size > 0,
      count: arduinoClients.size
    }));
  } catch (error) {
    console.error('Error sending arduino_status to web client:', error);
  }
});

// Arduino WebSocket connection handling
const arduinoClients = new Set();

arduinoWss.on('connection', (ws, req) => {
  arduinoClients.add(ws);
  console.log(`🔌 Arduino connected from ${req.socket.remoteAddress}. Total Arduino clients: ${arduinoClients.size}`);

  // Broadcast Arduino connection to all web clients
  global.broadcastToClients({
    type: 'arduino_connected',
    message: 'Arduino device connected',
    count: arduinoClients.size
  });

  ws.on('message', (message) => {
    console.log('📩 Received message from Arduino:', message.toString());
  });

  ws.on('error', (error) => {
    console.error('❌ Arduino WebSocket error:', error);
  });

  ws.on('close', (code, reason) => {
    arduinoClients.delete(ws);
    console.log(`🔌 Arduino disconnected (code: ${code}, reason: ${reason}). Total Arduino clients: ${arduinoClients.size}`);
    
    // Broadcast Arduino disconnection to all web clients
    global.broadcastToClients({
      type: 'arduino_disconnected',
      message: 'Arduino device disconnected',
      count: arduinoClients.size
    });
  });

  // Send a welcome message to confirm connection
  console.log('✅ Arduino WebSocket connection established');
});

// ESP32 WebSocket connection handling with device registry
// Device registry: Map<device_id, WebSocket>
const esp32Devices = new Map();

esp32Wss.on('connection', (ws, req) => {
  // Extract device_id from query parameters
  const parsedUrl = url.parse(req.url, true);
  const deviceId = parsedUrl.query.device_id;

  if (!deviceId) {
    console.error('❌ ESP32 connection rejected: missing device_id parameter');
    ws.close(1008, 'device_id is required');
    return;
  }

  // If device already connected with this ID, close the old connection
  if (esp32Devices.has(deviceId)) {
    const oldWs = esp32Devices.get(deviceId);
    if (oldWs.readyState === WebSocket.OPEN) {
      console.log(`⚠️ Closing existing connection for device_id: ${deviceId}`);
      oldWs.close(1000, 'Replaced by new connection');
    }
  }

  // Register the new device
  esp32Devices.set(deviceId, ws);
  ws.deviceId = deviceId; // Store device_id on the WebSocket for cleanup

  console.log(`🔌 ESP32 connected - device_id: ${deviceId} from ${req.socket.remoteAddress}. Total ESP32 devices: ${esp32Devices.size}`);

  ws.on('message', (message) => {
    console.log(`📩 Received message from ESP32 (${deviceId}):`, message.toString());
  });

  ws.on('error', (error) => {
    console.error(`❌ ESP32 WebSocket error (${deviceId}):`, error);
    // Clean up on error
    if (ws.deviceId && esp32Devices.get(ws.deviceId) === ws) {
      esp32Devices.delete(ws.deviceId);
      console.log(`🧹 Cleaned up ESP32 device ${ws.deviceId} due to error`);
    }
  });

  ws.on('close', (code, reason) => {
    // Only remove if this is still the active connection for this device_id
    if (ws.deviceId && esp32Devices.get(ws.deviceId) === ws) {
      esp32Devices.delete(ws.deviceId);
      console.log(`🔌 ESP32 disconnected - device_id: ${ws.deviceId} (code: ${code}, reason: ${reason}). Total ESP32 devices: ${esp32Devices.size}`);
    }
  });

  // Send a welcome message to confirm connection (optional, plain text)
  ws.send('CONNECTED');
  console.log(`✅ ESP32 WebSocket connection established for device_id: ${deviceId}`);
});

// Handle WebSocket upgrades
server.on('upgrade', (request, socket, head) => {
  const pathname = url.parse(request.url, true).pathname;

  if (pathname === '/ws/esp32') {
    // ESP32 endpoint with device_id query parameter
    esp32Wss.handleUpgrade(request, socket, head, (ws) => {
      esp32Wss.emit('connection', ws, request);
    });
  } else if (pathname === '/ws/ping') {
    // Arduino endpoint
    arduinoWss.handleUpgrade(request, socket, head, (ws) => {
      arduinoWss.emit('connection', ws, request);
    });
  } else {
    // Default web client endpoint
    wss.handleUpgrade(request, socket, head, (ws) => {
      wss.emit('connection', ws, request);
    });
  }
});

// Broadcast function to send messages to all connected web clients
global.broadcastToClients = (data) => {
  const message = JSON.stringify(data);
  console.log(`Broadcasting to ${clients.size} web client(s):`, data);
  
  let sentCount = 0;
  clients.forEach((client) => {
    if (client.readyState === WebSocket.OPEN) {
      try {
        client.send(message);
        sentCount++;
        console.log(`Message sent to web client (${sentCount}/${clients.size})`);
      } catch (error) {
        console.error('Error sending message to web client:', error);
      }
    } else {
      console.log(`Web client not ready (state: ${client.readyState})`);
    }
  });
  
  if (sentCount === 0) {
    console.warn('No web clients connected to receive the message!');
  }
};

// Function to send alarm trigger to Arduino
global.triggerArduinoAlarm = () => {
  console.log(`🚨 Triggering Arduino alarm! Connected Arduinos: ${arduinoClients.size}`);
  
  let sentCount = 0;
  arduinoClients.forEach((client) => {
    if (client.readyState === WebSocket.OPEN) {
      try {
        client.send('PING');
        sentCount++;
        console.log(`✅ PING sent to Arduino (${sentCount}/${arduinoClients.size})`);
      } catch (error) {
        console.error('❌ Error sending PING to Arduino:', error);
      }
    } else {
      console.log(`Arduino not ready (state: ${client.readyState})`);
    }
  });
  
  if (sentCount === 0) {
    console.warn('⚠️ No Arduino devices connected to receive the alarm signal!');
  }
};

// Function to send ALARM to ESP32 devices
// Can send to a specific device_id or all devices if deviceId is null/undefined
global.sendAlarmToESP32 = (deviceId = null) => {
  const message = 'ALARM';
  let sentCount = 0;
  const targetDevices = deviceId 
    ? (esp32Devices.has(deviceId) ? [[deviceId, esp32Devices.get(deviceId)]] : [])
    : Array.from(esp32Devices.entries());

  if (targetDevices.length === 0) {
    console.warn(`⚠️ No ESP32 devices ${deviceId ? `with device_id: ${deviceId}` : ''} connected to receive the alarm signal!`);
    return;
  }

  console.log(`🚨 Sending ALARM to ${deviceId ? `ESP32 device: ${deviceId}` : `all ${targetDevices.length} ESP32 device(s)`}`);

  targetDevices.forEach(([id, ws]) => {
    if (ws.readyState === WebSocket.OPEN) {
      try {
        ws.send(message);
        sentCount++;
        console.log(`✅ ALARM sent to ESP32 device_id: ${id} (${sentCount}/${targetDevices.length})`);
      } catch (error) {
        console.error(`❌ Error sending ALARM to ESP32 device_id: ${id}:`, error);
        // Clean up on error
        if (esp32Devices.get(id) === ws) {
          esp32Devices.delete(id);
          console.log(`🧹 Cleaned up ESP32 device ${id} due to send error`);
        }
      }
    } else {
      console.log(`⚠️ ESP32 device_id: ${id} not ready (state: ${ws.readyState}), removing from registry`);
      // Clean up closed connections
      if (esp32Devices.get(id) === ws) {
        esp32Devices.delete(id);
      }
    }
  });

  if (sentCount === 0) {
    console.warn(`⚠️ Failed to send ALARM to any ESP32 devices!`);
  }
};

// Function to check authorization and trigger alarm if unauthorized
// This is the function that should be called when an RFID card is scanned
global.onRFIDScan = async (card_uid) => {
  const { getDatabase } = require('./database/db');
  const db = getDatabase();
  
  if (!db) {
    console.error('Database not available!');
    return false;
  }

  // Check if card is authorized (exists in database)
  return new Promise((resolve) => {
    db.get('SELECT * FROM cards WHERE card_id = ?', [card_uid], (err, row) => {
      if (err) {
        console.error('Error checking authorization:', err);
        // On database error, treat as unauthorized and trigger alarm
        global.sendAlarmToESP32();
        resolve(false);
        return;
      }

      // Try without leading zeros if not found
      if (!row && card_uid.match(/^0+/)) {
        const cardIdNoZeros = card_uid.replace(/^0+/, '');
        db.get('SELECT * FROM cards WHERE card_id = ?', [cardIdNoZeros], (err2, row2) => {
          if (err2) {
            console.error('Error in second lookup:', err2);
          }
          const isAuthorized = !!row2;
          
          if (!isAuthorized) {
            console.log(`🚨 Unauthorized card detected: ${card_uid} - Triggering ESP32 alarm`);
            global.sendAlarmToESP32();
          }
          
          resolve(isAuthorized);
        });
      } else {
        const isAuthorized = !!row;
        
        if (!isAuthorized) {
          console.log(`🚨 Unauthorized card detected: ${card_uid} - Triggering ESP32 alarm`);
          global.sendAlarmToESP32();
        }
        
        resolve(isAuthorized);
      }
    });
  });
};

// Helper function to check if a card is authorized (without triggering alarm)
global.isAuthorized = (card_uid) => {
  const { getDatabase } = require('./database/db');
  const db = getDatabase();
  
  if (!db) {
    return false;
  }

  return new Promise((resolve) => {
    db.get('SELECT * FROM cards WHERE card_id = ?', [card_uid], (err, row) => {
      if (err) {
        console.error('Error checking authorization:', err);
        resolve(false);
        return;
      }

      if (!row && card_uid.match(/^0+/)) {
        const cardIdNoZeros = card_uid.replace(/^0+/, '');
        db.get('SELECT * FROM cards WHERE card_id = ?', [cardIdNoZeros], (err2, row2) => {
          resolve(!!row2);
        });
      } else {
        resolve(!!row);
      }
    });
  });
};

// Serve static files from React app in production
if (process.env.NODE_ENV === 'production') {
  app.use(express.static(path.join(__dirname, '../client/build')));
  app.get('*', (req, res) => {
    res.sendFile(path.join(__dirname, '../client/build/index.html'));
  });
}

const PORT = process.env.PORT || 5000;

// ============ FIXED SERVER HOST ============
// Set this to your laptop's IP address to prevent it from changing
// You can also set SERVER_HOST environment variable
// Set to 'auto' to auto-detect, or specify a fixed IP like '192.168.1.100'
const FIXED_SERVER_HOST = 'auto';  // Use 'auto' for dynamic IP detection
// ===========================================

// Function to get local IP address
function getLocalIPAddress() {
  // Use fixed host if set via environment variable or constant
  if (process.env.SERVER_HOST) {
    return process.env.SERVER_HOST;
  }
  
  if (FIXED_SERVER_HOST && FIXED_SERVER_HOST !== 'auto') {
    return FIXED_SERVER_HOST;
  }
  
  // Auto-detect (fallback)
  const interfaces = os.networkInterfaces();
  for (const name of Object.keys(interfaces)) {
    for (const iface of interfaces[name]) {
      // Skip internal (loopback) and non-IPv4 addresses
      if (iface.family === 'IPv4' && !iface.internal) {
        return iface.address;
      }
    }
  }
  return 'localhost';
}

// Initialize database and RFID reader
async function startServer() {
  try {
    await initializeDatabase();
    await initializeRFIDReader();
    
    const localIP = getLocalIPAddress();
    
    server.listen(PORT, '0.0.0.0', () => {
      console.log('\n' + '='.repeat(60));
      console.log('🚀 SERVER STARTED SUCCESSFULLY');
      console.log('='.repeat(60));
      console.log(`📡 HTTP Server:     http://${localIP}:${PORT}`);
      console.log(`📡 HTTP Server:     http://localhost:${PORT}`);
      console.log(`📡 HTTP Server:     http://0.0.0.0:${PORT} (all interfaces)`);
      console.log('\n🔌 WEBSOCKET ENDPOINTS:');
      console.log(`   Web Clients:     ws://${localIP}:${PORT}/`);
      console.log(`   Arduino ESP32:   ws://${localIP}:${PORT}/ws/ping`);
      console.log(`   ESP32 Devices:   ws://${localIP}:${PORT}/ws/esp32?device_id=<device_id>`);
      console.log('\n📋 ESP32 CONFIGURATION:');
      console.log(`   Update your ESP32 code with:`);
      console.log(`   const char* WS_HOST = "${localIP}";`);
      console.log(`   const uint16_t WS_PORT = ${PORT};`);
      console.log(`   const char* WS_PATH = "/ws/esp32?device_id=YOUR_DEVICE_ID";`);
      console.log('='.repeat(60) + '\n');
    }).on('error', (err) => {
      if (err.code === 'EADDRINUSE') {
        console.error(`\n❌ Port ${PORT} is already in use!`);
        console.error('Please either:');
        console.error('  1. Stop the other application using port', PORT);
        console.error('  2. Run: .\\kill-ports.ps1 (to kill processes on ports 3000 and 5000)');
        console.error('  3. Or change the PORT in .env file\n');
        process.exit(1);
      } else {
        console.error('Server error:', err);
        process.exit(1);
      }
    });
  } catch (error) {
    console.error('Failed to start server:', error);
    process.exit(1);
  }
}

startServer();
