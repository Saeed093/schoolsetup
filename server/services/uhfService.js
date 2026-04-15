const { getDatabase } = require('../database/db');

let axios;
try {
  axios = require('axios');
} catch {
  axios = null;
  console.warn('axios not available for UHF service — install with: npm install axios');
}

let sdkUrl = 'http://localhost:8888';
let comPort = '';
let baudRate = '115200';
let debounceSeconds = 5;
let pollInterval = null;
let isConnected = false;
let isScanning = false;

const tagLastSeen = new Map();

const readerStatus = {
  connected: false,
  scanning: false,
  sdkUrl,
  comPort,
  lastError: null,
  sdkReachable: false
};

function loadSettings() {
  const db = getDatabase();
  if (!db) return Promise.resolve();
  return new Promise((resolve) => {
    db.all('SELECT key, value FROM uhf_settings', [], (err, rows) => {
      if (err || !rows) return resolve();
      for (const row of rows) {
        switch (row.key) {
          case 'sdk_url': sdkUrl = row.value; readerStatus.sdkUrl = row.value; break;
          case 'com_port': comPort = row.value; readerStatus.comPort = row.value; break;
          case 'baud_rate': baudRate = row.value; break;
          case 'debounce_seconds': {
            const stored = parseInt(row.value, 10);
            // Migrate old 300-second default down to 5 seconds
            debounceSeconds = (!stored || stored >= 300) ? 5 : stored;
            break;
          }
        }
      }
      resolve();
    });
  });
}

function sdkBase() {
  return String(sdkUrl || 'http://localhost:8888').replace(/\/+$/, '');
}

async function sdkPost(endpoint, body = {}) {
  if (!axios) throw new Error('axios not installed');
  const url = `${sdkBase()}${endpoint.startsWith('/') ? endpoint : `/${endpoint}`}`;
  const res = await axios.post(url, body, { timeout: 5000 });
  return res.data;
}

async function checkSdkReachable() {
  if (!axios) {
    readerStatus.sdkReachable = false;
    return false;
  }
  const base = sdkBase();
  const probes = [
    () => axios.get(`${base}/health`, { timeout: 2500 }),
    () => axios.get(`${base}/`, { timeout: 2500 }),
    () => axios.post(`${base}/GetDevicePara`, {}, { timeout: 2500 })
  ];
  for (const probe of probes) {
    try {
      await probe();
      readerStatus.sdkReachable = true;
      return true;
    } catch {
      /* try next */
    }
  }
  readerStatus.sdkReachable = false;
  return false;
}

async function connectToReader(options = {}) {
  await loadSettings();
  if (options.sdkUrl) { sdkUrl = options.sdkUrl; readerStatus.sdkUrl = sdkUrl; }
  if (options.comPort) { comPort = options.comPort; readerStatus.comPort = comPort; }
  if (options.baudRate) baudRate = options.baudRate;

  if (!axios) {
    readerStatus.lastError = 'axios not installed';
    throw new Error('axios not installed — run: npm install axios');
  }

  const reachable = await checkSdkReachable();
  if (!reachable) {
    readerStatus.lastError = `Cannot reach UHF SDK at ${sdkUrl}`;
    throw new Error(readerStatus.lastError);
  }

  const openPort = async (port) => {
    // Retry up to 3 times — the bridge may need a moment after startup
    for (let i = 0; i < 3; i++) {
      try {
        await sdkPost('/OpenDevice', { port, baud: parseInt(baudRate, 10) || 115200 });
        return;
      } catch (err) {
        if (i === 2) throw err;
        await new Promise((r) => setTimeout(r, 600));
      }
    }
  };

  try {
    if (comPort) {
      await openPort(comPort);
    } else {
      const ports = await sdkPost('/getPorts');
      if (ports && ports.ports && ports.ports.length > 0) {
        comPort = ports.ports[0];
        readerStatus.comPort = comPort;
        await openPort(comPort);
      } else {
        throw new Error('No serial ports available');
      }
    }
    isConnected = true;
    readerStatus.connected = true;
    readerStatus.lastError = null;
    console.log(`UHF Reader connected on ${comPort} via SDK at ${sdkUrl}`);

    saveSetting('sdk_url', sdkUrl);
    saveSetting('com_port', comPort);
    saveSetting('baud_rate', baudRate);
  } catch (err) {
    readerStatus.lastError = err.message;
    throw err;
  }
}

async function disconnectReader() {
  stopScanning();
  try {
    await sdkPost('/CloseDevice');
  } catch { /* ignore */ }
  isConnected = false;
  readerStatus.connected = false;
  readerStatus.scanning = false;
  console.log('UHF Reader disconnected');
}

async function startScanning() {
  if (!isConnected) throw new Error('Reader not connected');
  try {
    await sdkPost('/StartCounting');
    isScanning = true;
    readerStatus.scanning = true;
    startPolling();
    console.log('UHF scanning started');
  } catch (err) {
    readerStatus.lastError = err.message;
    throw err;
  }
}

async function stopScanning() {
  if (pollInterval) {
    clearInterval(pollInterval);
    pollInterval = null;
  }
  if (isScanning) {
    try {
      await sdkPost('/InventoryStop');
    } catch { /* ignore */ }
  }
  isScanning = false;
  readerStatus.scanning = false;
  console.log('UHF scanning stopped');
}

function startPolling() {
  if (pollInterval) clearInterval(pollInterval);
  pollInterval = setInterval(pollForTags, 500);
}

async function pollForTags() {
  if (!isScanning) return;
  try {
    const data = await sdkPost('/GetTagInfo');
    if (!data) return;

    let tags = [];
    if (Array.isArray(data)) {
      tags = data;
    } else if (data.tags && Array.isArray(data.tags)) {
      tags = data.tags;
    } else if (data.epc) {
      tags = [data];
    } else if (data.result && Array.isArray(data.result)) {
      tags = data.result;
    }

    for (const tag of tags) {
      const epc = (tag.epc || tag.EPC || tag.tagId || tag.tag_id || tag.id || '').toString().trim().toUpperCase();
      if (!epc) continue;
      processTag(epc);
    }
  } catch (err) {
    if (err.code === 'ECONNREFUSED' || err.code === 'ECONNRESET') {
      console.error('UHF SDK connection lost');
      isScanning = false;
      isConnected = false;
      readerStatus.connected = false;
      readerStatus.scanning = false;
      readerStatus.lastError = 'SDK connection lost';
      stopScanning();
    }
  }
}

function processTag(epc) {
  const now = Date.now();
  const lastSeen = tagLastSeen.get(epc);
  const debounceMs = debounceSeconds * 1000;

  if (lastSeen && (now - lastSeen) < debounceMs) {
    const remaining = Math.ceil((debounceMs - (now - lastSeen)) / 1000);
    console.log(`    [UHF] EPC ${epc} debounced — ${remaining}s until next scan accepted`);
    return;
  }
  tagLastSeen.set(epc, now);

  const db = getDatabase();
  if (!db) return;

  db.get('SELECT * FROM cards WHERE uhf_tag_id = ?', [epc], (err, card) => {
    if (err) {
      console.error('UHF tag lookup error:', err);
      return;
    }
    if (!card) {
      console.log(`\n>>> UHF TAG SCANNED  EPC: ${epc}  (UNKNOWN — not assigned to any child)`);
      if (global.broadcastToClients) {
        global.broadcastToClients({
          type: 'uhf_unknown_tag',
          epc,
          timestamp: new Date().toISOString()
        });
      }
      return;
    }

    db.get(
      'SELECT * FROM attendance WHERE uhf_tag_id = ?',
      [epc],
      (err2, attendance) => {
        if (err2) {
          console.error('Attendance lookup error:', err2);
          return;
        }

        const currentStatus = attendance ? attendance.status : 'out';
        const newStatus = currentStatus === 'in' ? 'out' : 'in';
        const now = new Date().toISOString();

        if (attendance) {
          db.run(
            'UPDATE attendance SET status = ?, last_changed_at = ? WHERE id = ?',
            [newStatus, now, attendance.id],
            (err3) => {
              if (err3) console.error('Attendance update error:', err3);
            }
          );
        } else {
          db.run(
            'INSERT INTO attendance (uhf_tag_id, card_id, student_name, student_class, status, last_changed_at) VALUES (?, ?, ?, ?, ?, ?)',
            [epc, card.card_id, card.student_name, card.student_class || '', newStatus, now],
            (err3) => {
              if (err3) console.error('Attendance insert error:', err3);
            }
          );
        }

        db.run(
          'INSERT INTO attendance_log (uhf_tag_id, card_id, student_name, student_class, direction, timestamp) VALUES (?, ?, ?, ?, ?, ?)',
          [epc, card.card_id, card.student_name, card.student_class || '', newStatus, now],
          (err3) => {
            if (err3) console.error('Attendance log error:', err3);
          }
        );

        const event = {
          type: 'attendance_change',
          uhf_tag_id: epc,
          card_id: card.card_id,
          student_name: card.student_name,
          student_class: card.student_class || '',
          child_image: card.child_image || '',
          previous_status: currentStatus,
          new_status: newStatus,
          timestamp: now
        };

        console.log(`\n>>> UHF TAG SCANNED  EPC: ${epc}  |  ${card.student_name} (Class ${card.student_class || '?'})  ->  ${newStatus.toUpperCase()}`);

        if (global.broadcastToClients) {
          global.broadcastToClients(event);
        }
      }
    );
  });
}

function saveSetting(key, value) {
  const db = getDatabase();
  if (!db) return;
  db.run(
    'INSERT OR REPLACE INTO uhf_settings (key, value) VALUES (?, ?)',
    [key, value],
    (err) => { if (err) console.error('saveSetting error:', err); }
  );
}

async function refreshSdkReachable() {
  await loadSettings();
  return checkSdkReachable();
}

/** Probe a URL without changing global sdkUrl (for UI "Test URL"). */
async function isSdkUrlReachable(candidateUrl) {
  if (!axios) return false;
  const base = String(candidateUrl || 'http://localhost:8888').replace(/\/+$/, '');
  const probes = [
    () => axios.get(`${base}/health`, { timeout: 2500 }),
    () => axios.get(`${base}/`, { timeout: 2500 }),
    () => axios.post(`${base}/GetDevicePara`, {}, { timeout: 2500 })
  ];
  for (const p of probes) {
    try {
      await p();
      return true;
    } catch {
      /* try next */
    }
  }
  return false;
}

function pruneAttendanceLog() {
  const db = getDatabase();
  if (!db) return;
  db.run(
    `DELETE FROM attendance_log WHERE timestamp < datetime('now', '-15 days')`,
    [],
    (err) => {
      if (err) console.error('Attendance log pruning error:', err);
      else console.log('Attendance log pruned: removed entries older than 15 days');
    }
  );
}

async function initializeUHFReader() {
  await loadSettings();
  // Write corrected debounce back to DB so old installs with 300s are fixed
  saveSetting('debounce_seconds', String(debounceSeconds));
  // Seed COM8 as default if no port has ever been saved, so scan-single works
  // even before the user opens the Attendance Dashboard or Capture Station.
  if (!comPort) {
    comPort = 'COM8';
    readerStatus.comPort = comPort;
    saveSetting('com_port', comPort);
  }
  console.log(`UHF Reader service initialized (SDK URL: ${sdkUrl}, COM: ${comPort}, debounce: ${debounceSeconds}s)`);
  pruneAttendanceLog();
  if (axios) {
    checkSdkReachable().then(async (reachable) => {
      if (reachable) {
        console.log('UHF SDK server is reachable — auto-connecting...');
        try {
          await connectToReader();
          await startScanning();
          console.log('UHF auto-connect + scan started successfully');
        } catch (e) {
          console.warn('UHF auto-connect failed:', e.message);
        }
      } else {
        console.log('UHF SDK server not reachable — start the Python bridge and connect manually');
      }
    });
  }
}

function getUHFStatus() {
  return { ...readerStatus, debounceSeconds };
}

async function getAvailablePorts() {
  try {
    const data = await sdkPost('/getPorts');
    return data.ports || data || [];
  } catch {
    return [];
  }
}

function updateDebounce(seconds) {
  const v = parseInt(seconds, 10);
  debounceSeconds = (!v || v >= 300) ? 5 : v;
  saveSetting('debounce_seconds', String(debounceSeconds));
}

/**
 * Do a quick single-shot inventory: pause the regular poller, flush the
 * bridge buffer, poll until a tag appears (or timeout), then restore the
 * poller.  Never calls /InventoryStop — the bridge keeps running so the
 * Capture Station continues to receive scans while/after registration.
 */
async function scanSingleTag(timeoutMs = 3000) {
  if (!axios) throw new Error('axios not installed');

  // Ensure connected — auto-connect if possible
  if (!isConnected) {
    await loadSettings();
    const reachable = await checkSdkReachable();
    if (!reachable) {
      throw new Error(
        `Cannot reach UHF bridge at ${sdkUrl}. Is the Python bridge running? (python app.py)`
      );
    }
    await connectToReader();   // throws if it fails — no silent ignore
  }

  const found = new Set();

  // Temporarily pause the regular 500 ms poller so it doesn't consume tags
  // from the bridge buffer before our dedicated poll below can see them.
  const wasPolling = !!pollInterval;
  if (wasPolling) {
    clearInterval(pollInterval);
    pollInterval = null;
  }

  try {
    // Flush any stale buffered tags and re-arm the bridge inventory.
    // Do NOT call InventoryStop at the end — the bridge must keep scanning
    // so the Capture Station keeps working.
    await sdkPost('/StartCounting');

    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      try {
        const data = await sdkPost('/GetTagInfo');
        if (data) {
          let tags = [];
          if (Array.isArray(data)) tags = data;
          else if (data.tags && Array.isArray(data.tags)) tags = data.tags;
          else if (data.epc) tags = [data];
          else if (data.result && Array.isArray(data.result)) tags = data.result;

          for (const tag of tags) {
            const epc = (tag.epc || tag.EPC || tag.tagId || tag.tag_id || tag.id || '')
              .toString().trim().toUpperCase();
            if (epc) found.add(epc);
          }
        }
      } catch { /* ignore transient poll errors */ }

      if (found.size > 0) break;
      await new Promise((r) => setTimeout(r, 200));
    }
  } finally {
    // Always restore the regular poller so ongoing scanning isn't disrupted
    if (wasPolling) startPolling();
  }

  return [...found];
}

module.exports = {
  initializeUHFReader,
  connectToReader,
  disconnectReader,
  startScanning,
  stopScanning,
  getUHFStatus,
  getAvailablePorts,
  updateDebounce,
  processTag,
  scanSingleTag,
  refreshSdkReachable,
  isSdkUrlReachable
};
