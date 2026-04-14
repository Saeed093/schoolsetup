const express = require('express');
const router = express.Router();
const {
  connectToReader,
  disconnectReader,
  startScanning,
  stopScanning,
  getUHFStatus,
  getAvailablePorts,
  processTag,
  scanSingleTag,
  refreshSdkReachable,
  isSdkUrlReachable
} = require('../services/uhfService');

router.get('/status', async (req, res) => {
  const probeUrl = typeof req.query.sdkUrl === 'string' ? req.query.sdkUrl.trim() : '';
  if (probeUrl) {
    const reachable = await isSdkUrlReachable(probeUrl);
    return res.json({ ...getUHFStatus(), probeUrl, probeReachable: reachable });
  }
  const forceRefresh = req.query.refresh === '1';
  if (forceRefresh) {
    await refreshSdkReachable();
  }
  res.json(getUHFStatus());
});

router.post('/connect', async (req, res) => {
  try {
    const { sdkUrl, comPort, baudRate } = req.body || {};
    await connectToReader({ sdkUrl, comPort, baudRate });
    res.json({ success: true, status: getUHFStatus() });
  } catch (err) {
    res.status(500).json({ error: err.message, status: getUHFStatus() });
  }
});

router.post('/disconnect', async (req, res) => {
  try {
    await disconnectReader();
    res.json({ success: true, status: getUHFStatus() });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/start', async (req, res) => {
  try {
    await startScanning();
    res.json({ success: true, status: getUHFStatus() });
  } catch (err) {
    res.status(500).json({ error: err.message, status: getUHFStatus() });
  }
});

router.post('/stop', async (req, res) => {
  try {
    await stopScanning();
    res.json({ success: true, status: getUHFStatus() });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.get('/ports', async (req, res) => {
  try {
    const ports = await getAvailablePorts();
    res.json({ ports });
  } catch (err) {
    res.status(500).json({ error: err.message, ports: [] });
  }
});

// Quick single-shot scan for tag registration
router.post('/scan-single', async (req, res) => {
  try {
    const { timeout } = req.body || {};
    const tags = await scanSingleTag(timeout || 3000);
    if (tags.length === 0) {
      return res.json({ success: false, tags: [], message: 'No tags detected. Hold the tag near the reader and try again.' });
    }
    res.json({ success: true, tags, epc: tags[0] });
  } catch (err) {
    res.status(500).json({ error: err.message, tags: [] });
  }
});

router.post('/simulate-tag', (req, res) => {
  const { epc } = req.body || {};
  if (!epc) {
    return res.status(400).json({ error: 'epc is required' });
  }
  processTag(epc.toString().trim().toUpperCase());
  res.json({ success: true, epc: epc.toString().trim().toUpperCase() });
});

module.exports = router;
