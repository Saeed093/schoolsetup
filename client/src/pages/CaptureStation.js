import React, { useState, useEffect, useRef, useCallback } from 'react';
import { Link } from 'react-router-dom';
import './CaptureStation.css';
import { getApiBase, getWebSocketUrl } from '../utils/connection';
import {
  verifyLiveCaptureToGuardians,
  loadFaceModelsOnce,
  areFaceModelsReady,
  getFaceRecognitionEnabled,
  FACE_SETTINGS_CHANGED_EVENT
} from '../utils/faceVerification';
import FaceNoMatchBanner from '../components/FaceNoMatchBanner';

/**
 * CaptureStation - Runs on the server machine with RFID reader + camera.
 * Camera is ALWAYS ON. When an RFID card is scanned, it automatically captures
 * an image and sends it to the server.
 * 
 * Supports two modes:
 * - Check-Out (default): Records student leaving school (pickup)
 * - Check-In: Records student arriving at school
 */
function CaptureStation() {
  // Camera state
  const [cameras, setCameras] = useState([]);
  const [selectedCamera, setSelectedCamera] = useState('');
  const [cameraActive, setCameraActive] = useState(false);
  const [cameraError, setCameraError] = useState('');
  
  // WebSocket state
  const [wsConnected, setWsConnected] = useState(false);
  
  // RFID scanner state (keyboard-wedge)
  const [scanDraft, setScanDraft] = useState('');
  
  // Check-in/Check-out mode: 'in' = arriving at school, 'out' = leaving school (pickup)
  const [stationMode, setStationMode] = useState('out');
  
  // Last capture info
  const [lastCapture, setLastCapture] = useState(null);
  const [captureStatus, setCaptureStatus] = useState('Initializing camera...');
  const [faceMatchResult, setFaceMatchResult] = useState(null);
  /** True while face-api is loading models or comparing faces (first scan can take several seconds). */
  const [faceMatchPending, setFaceMatchPending] = useState(false);
  /** Banner payload when last checkout face check was NO (authorized card, face not matched) */
  const [faceNoMatchAlert, setFaceNoMatchAlert] = useState(null);
  const [frsEnabled, setFrsEnabled] = useState(() => getFaceRecognitionEnabled());
  /** Full-page gate while face-api weights load (checkout + FRS on); scans are ignored until cleared. */
  const [frsModelsLoadingGate, setFrsModelsLoadingGate] = useState(() => {
    if (typeof window === 'undefined') return false;
    return (
      getFaceRecognitionEnabled() && !areFaceModelsReady()
    );
  });

  // Refs
  const videoRef = useRef(null);
  const canvasRef = useRef(null);
  const streamRef = useRef(null);
  const wsRef = useRef(null);
  const scanInputRef = useRef(null);
  const scanBufferRef = useRef('');
  const lastKeyAtRef = useRef(0);
  const selectedCameraRef = useRef('');
  const mountedRef = useRef(true);
  const stationModeRef = useRef('out'); // Ref for async access
  const localScanDebounceRef = useRef(new Map()); // Track locally-initiated scans to prevent WS double-processing
  const prevFrsEnabledRef = useRef(null);

  const API_BASE = getApiBase();

  const runFaceVerification = useCallback(
    async (capturedDataUrl, guardiansList, found, scanContext) => {
      if (!capturedDataUrl || !found) {
        setFaceMatchResult(null);
        setFaceNoMatchAlert(null);
        setFaceMatchPending(false);
        return;
      }
      if (!getFaceRecognitionEnabled()) {
        setFaceMatchResult({
          status: 'disabled',
          message: 'Face recognition is turned off in Admin (Test Tools).',
          yes: false,
          confidence: 0,
          bestLabel: '',
          matchedGuardian: null
        });
        setFaceNoMatchAlert(null);
        setFaceMatchPending(false);
        return;
      }
      setFaceMatchPending(true);
      try {
        const r = await verifyLiveCaptureToGuardians(capturedDataUrl, guardiansList || []);
        setFaceMatchResult(r);

        if (r.status === 'ok' && !r.yes) {
          const alertPayload = {
            student_name: scanContext?.student_name || '',
            student_class: scanContext?.student_class || '',
            card_id: scanContext?.card_id || '',
            confidence: r.confidence,
            best_label: r.bestLabel || ''
          };
          setFaceNoMatchAlert(alertPayload);
          try {
            const res = await fetch(`${API_BASE}/api/capture/face-no-match-notify`, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify(alertPayload)
            });
            if (!res.ok) {
              console.warn('[CaptureStation] Face no-match notify HTTP', res.status);
            }
          } catch (notifyErr) {
            console.error('[CaptureStation] Face no-match notify failed:', notifyErr);
          }
        } else {
          setFaceNoMatchAlert(null);
        }
      } catch (e) {
        console.error('[CaptureStation] Face verification error:', e);
        setFaceMatchResult({
          status: 'error',
          message: e.message || 'Face check failed',
          yes: false,
          confidence: 0,
          bestLabel: '',
          matchedGuardian: null
        });
        setFaceNoMatchAlert(null);
      } finally {
        setFaceMatchPending(false);
      }
    },
    [API_BASE]
  );

  useEffect(() => {
    const syncFrs = () => setFrsEnabled(getFaceRecognitionEnabled());
    window.addEventListener('storage', syncFrs);
    window.addEventListener(FACE_SETTINGS_CHANGED_EVENT, syncFrs);
    return () => {
      window.removeEventListener('storage', syncFrs);
      window.removeEventListener(FACE_SETTINGS_CHANGED_EVENT, syncFrs);
    };
  }, []);

  // Start preloading face models immediately on mount so weights download
  // and GPU warm-up happen in the background before the first scan.
  useEffect(() => {
    if (getFaceRecognitionEnabled() && !areFaceModelsReady()) {
      loadFaceModelsOnce().catch(() => {});
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    const needModels = stationMode === 'out' && frsEnabled;
    if (!needModels) {
      setFrsModelsLoadingGate(false);
      return;
    }
    if (areFaceModelsReady()) {
      setFrsModelsLoadingGate(false);
      return;
    }
    setFrsModelsLoadingGate(true);
    let cancelled = false;
    loadFaceModelsOnce()
      .catch((err) => console.warn('[CaptureStation] Face models load failed:', err))
      .finally(() => {
        if (!cancelled && mountedRef.current) {
          setFrsModelsLoadingGate(false);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [stationMode, frsEnabled]);

  useEffect(() => {
    if (stationMode === 'in') {
      setFaceMatchResult(null);
      setFaceNoMatchAlert(null);
      setFaceMatchPending(false);
    }
  }, [stationMode]);

  /** Clear face UI only when FRS is turned off (was on), not on every render while off — else "disabled" scan feedback would vanish. */
  useEffect(() => {
    if (prevFrsEnabledRef.current === null) {
      prevFrsEnabledRef.current = frsEnabled;
      return;
    }
    const wasOn = prevFrsEnabledRef.current;
    prevFrsEnabledRef.current = frsEnabled;
    if (stationMode === 'out' && wasOn && !frsEnabled) {
      setFaceMatchResult(null);
      setFaceMatchPending(false);
      setFaceNoMatchAlert(null);
    }
  }, [stationMode, frsEnabled]);

  // Stop camera (used when switching to check-in mode)
  const stopCamera = () => {
    if (streamRef.current) {
      streamRef.current.getTracks().forEach(t => t.stop());
      streamRef.current = null;
    }
    if (videoRef.current) {
      videoRef.current.srcObject = null;
    }
    setCameraActive(false);
    console.log('[CaptureStation] Camera stopped');
  };

  // Handle mode change
  const handleModeChange = (newMode) => {
    setStationMode(newMode);
    stationModeRef.current = newMode;
    
    if (newMode === 'in') {
      // Stop camera in check-in mode
      stopCamera();
      setCaptureStatus('Waiting for student scan...');
    } else {
      // Start camera in check-out mode
      setCaptureStatus('Starting camera...');
      startCamera(selectedCameraRef.current || undefined);
    }

    // Re-focus hidden scan input so keyboard-wedge RFID readers keep working
    // after clicking the mode toggle button (important for remote laptop setups)
    setTimeout(() => {
      if (scanInputRef.current) scanInputRef.current.focus();
    }, 100);
  };

  // Start camera - Linux-friendly: try multiple constraint strategies
  const startCamera = async (deviceId) => {
    console.log('[CaptureStation] Starting camera, deviceId:', deviceId || 'default');
    setCaptureStatus('Starting camera...');
    setCameraError('');
    
    // Stop existing stream first
    if (streamRef.current) {
      streamRef.current.getTracks().forEach(t => t.stop());
      streamRef.current = null;
    }
    
    const constraintsToTry = [];
    
    if (deviceId) {
      // 1) Exact deviceId + ideal resolution (Linux often fails on exact width/height)
      constraintsToTry.push({
        video: { deviceId: { exact: deviceId }, width: { ideal: 640 }, height: { ideal: 480 } }
      });
      // 2) Ideal deviceId (softer - works on some Linux)
      constraintsToTry.push({
        video: { deviceId: { ideal: deviceId }, width: { ideal: 640 }, height: { ideal: 480 } }
      });
      // 3) Just deviceId, no resolution
      constraintsToTry.push({
        video: { deviceId: { exact: deviceId } }
      });
      constraintsToTry.push({
        video: { deviceId: { ideal: deviceId } }
      });
    }
    
    // 4) Default camera, no deviceId (most reliable on Linux)
    constraintsToTry.push({
      video: { width: { ideal: 640 }, height: { ideal: 480 } }
    });
    constraintsToTry.push({ video: true });
    
    for (let i = 0; i < constraintsToTry.length; i++) {
      try {
        const stream = await navigator.mediaDevices.getUserMedia(constraintsToTry[i]);
        
        if (!mountedRef.current) {
          stream.getTracks().forEach(t => t.stop());
          return;
        }
        
        streamRef.current = stream;
        if (videoRef.current) {
          videoRef.current.srcObject = stream;
          await videoRef.current.play();
        }
        setCameraActive(true);
        setCaptureStatus('Camera ready - waiting for RFID scan');
        setCameraError('');
        console.log('[CaptureStation] Camera started with constraint set', i + 1);
        return;
      } catch (err) {
        console.warn('[CaptureStation] Constraint set', i + 1, 'failed:', err.message);
        if (i === constraintsToTry.length - 1) {
          setCameraError(err.message || 'Camera access failed');
          setCaptureStatus('Camera error - will retry...');
          setCameraActive(false);
          setTimeout(() => {
            if (mountedRef.current) {
              startCamera(selectedCameraRef.current || undefined);
            }
          }, 3000);
        }
      }
    }
  };

  // Initialize cameras on mount - Linux: start default camera first, then enumerate
  useEffect(() => {
    mountedRef.current = true;
    
    const initCamera = async () => {
      // Camera APIs generally require a secure context (HTTPS) unless you're on localhost.
      // If you open Capture Station from another laptop via http://<LAN-IP>:3000/capture,
      // browsers may block getUserMedia and report it as "not supported".
      if (!window.isSecureContext && window.location.hostname !== 'localhost' && window.location.hostname !== '127.0.0.1') {
        setCameraError('Camera requires HTTPS or localhost');
        setCaptureStatus('Open Capture Station on the server PC at http://localhost:3000/capture (camera is blocked on non-HTTPS LAN URLs).');
        setCameraActive(false);
        return;
      }

      if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
        setCameraError('getUserMedia not supported');
        setCaptureStatus('Browser does not support camera access (try Chrome/Edge, and use HTTPS or localhost).');
        return;
      }
      
      try {
        // Linux-friendly: try default camera first (no enumerate), then list devices
        setCaptureStatus('Requesting camera access...');
        
        const stream = await navigator.mediaDevices.getUserMedia({ video: true });
        
        if (!mountedRef.current) {
          stream.getTracks().forEach(t => t.stop());
          return;
        }
        
        // Got default camera - use it immediately
        streamRef.current = stream;
        if (videoRef.current) {
          videoRef.current.srcObject = stream;
          await videoRef.current.play();
        }
        setCameraActive(true);
        setCaptureStatus('Camera ready - waiting for RFID scan');
        setCameraError('');
        
        // Now enumerate devices (labels may be filled after permission on Linux)
        const devices = await navigator.mediaDevices.enumerateDevices();
        const videoDevices = devices.filter(d => d.kind === 'videoinput');
        
        if (!mountedRef.current) return;
        
        setCameras(videoDevices);
        if (videoDevices.length > 0) {
          const firstId = videoDevices[0].deviceId;
          setSelectedCamera(firstId);
          selectedCameraRef.current = firstId;
        }
        
        console.log('[CaptureStation] Camera started (default), devices:', videoDevices.length);
      } catch (err) {
        console.error('[CaptureStation] Camera init error:', err);
        setCameraError(err.message || String(err));
        setCaptureStatus('Cannot access camera: ' + (err.message || err.name));
        setCameraActive(false);
        
        // Still try to enumerate so user sees "Camera 1" etc.
        try {
          const devices = await navigator.mediaDevices.enumerateDevices();
          const videoDevices = devices.filter(d => d.kind === 'videoinput');
          setCameras(videoDevices);
          if (videoDevices.length > 0) {
            setSelectedCamera(videoDevices[0].deviceId);
            selectedCameraRef.current = videoDevices[0].deviceId;
            // Retry with deviceId
            setTimeout(() => {
              if (mountedRef.current) startCamera(videoDevices[0].deviceId);
            }, 2000);
          }
        } catch (_) {
          // Ignore
        }
      }
    };
    
    initCamera();
    
    return () => {
      mountedRef.current = false;
      if (streamRef.current) {
        streamRef.current.getTracks().forEach(t => t.stop());
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Handle camera selection change (same fallback logic as start)
  const handleCameraChange = (e) => {
    const newDeviceId = e.target.value || '';
    setSelectedCamera(newDeviceId);
    selectedCameraRef.current = newDeviceId;
    startCamera(newDeviceId || undefined);
  };

  // WebSocket connection for receiving scans from physical RFID reader
  useEffect(() => {
    let reconnectTimeout = null;

    const connectWebSocket = () => {
      try {
        if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
          wsRef.current.close();
        }
        // Connect to backend WebSocket (configurable for other-laptop setups)
        const wsUrl = getWebSocketUrl('/');
        console.log('[CaptureStation] Connecting to WebSocket:', wsUrl);
        wsRef.current = new WebSocket(wsUrl);

        wsRef.current.onopen = () => {
          console.log('[CaptureStation] WebSocket connected successfully');
          setWsConnected(true);
          if (reconnectTimeout) {
            clearTimeout(reconnectTimeout);
            reconnectTimeout = null;
          }
        };

        wsRef.current.onmessage = async (event) => {
          try {
            const data = JSON.parse(event.data);
            console.log('[CaptureStation] WebSocket message:', data);
            
            // When a card scan event comes in
            if (data.type === 'card_scan' && data.card_id) {

              // If this scan came from admin simulate, it's already saved to the database.
              // Just update the CaptureStation UI - don't call the API again (avoids duplicates).
              if (data.source === 'admin_simulate') {
                const dir = data.direction || 'out';
                const isIn = dir === 'in';
                const actionLabel = isIn ? 'Arrived' : 'Left';
                const actionIcon = isIn ? '📥' : '📤';
                console.log(`[CaptureStation] Admin-simulated ${dir} scan for:`, data.student_name || data.card_id);
                setFaceMatchResult(null);
                setFaceMatchPending(false);
                setFaceNoMatchAlert(null);
                setLastCapture({
                  cardId: data.card_id,
                  studentName: data.student_name || data.name || 'Unknown',
                  timestamp: data.timestamp || new Date().toISOString(),
                  hasImage: !!data.pickup_image,
                  direction: dir,
                  faceCheckSkipped: false
                });
                setCaptureStatus(`${actionIcon} ${actionLabel}: ${data.student_name || data.name || data.card_id}`);
                return;
              }

              // ─── Skip if this scan was already processed by our local handleScan ───
              // When the RFID reader is on THIS laptop (keyboard-wedge), handleScan
              // already called /api/capture/scan which handled everything (lookup,
              // broadcast, log). The server then broadcasts the card_scan event back
              // to us. Without this check, we'd re-process the scan a second time,
              // which caused check-in to fail on remote laptops (the redundant
              // add-image call would overwrite the success status with an error).
              const scannedId = (data.scanned_card_id || data.card_id || '').toUpperCase();
              const localTs = localScanDebounceRef.current.get(scannedId) ||
                              localScanDebounceRef.current.get(data.card_id);
              if (localTs && (Date.now() - localTs) < 5000) {
                console.log('[CaptureStation] Skipping WS broadcast - already handled by local handleScan:', scannedId);
                localScanDebounceRef.current.delete(scannedId);
                localScanDebounceRef.current.delete(data.card_id);
                return;
              }

              // This scan came from an external source (physical RFID reader on the
              // server, or another station). Use local station mode to determine direction.
              const currentDirection = stationModeRef.current;
              const isCheckIn = currentDirection === 'in';

              // CHECK-IN MODE: No camera capture, just update direction
              if (isCheckIn) {
                console.log('[CaptureStation] Arrival mode - no image capture');
                setCaptureStatus(`Processing arrival: ${data.student_name || data.card_id}`);
                
                try {
                  // Send scan with direction but no image
                  await fetch(`${API_BASE}/api/capture/add-image`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                      card_id: data.card_id,
                      captured_image: null,
                      direction: 'in'
                    })
                  });
                  setLastCapture({
                    cardId: data.card_id,
                    studentName: data.student_name,
                    timestamp: new Date().toISOString(),
                    hasImage: false,
                    direction: 'in',
                    faceCheckSkipped: false
                  });
                  setCaptureStatus(`✅ Arrived: ${data.student_name || data.card_id}`);
                } catch (err) {
                  console.error('[CaptureStation] Error processing arrival:', err);
                  setCaptureStatus(`❌ Failed to process arrival`);
                }
                return;
              }

              if (getFaceRecognitionEnabled() && !areFaceModelsReady()) {
                console.log('[CaptureStation] Checkout scan ignored — FRS models still loading');
                setCaptureStatus('⏳ Face recognition is still loading — please wait…');
                return;
              }

              // CHECK-OUT MODE: Capture image from video
              if (videoRef.current && canvasRef.current && streamRef.current) {
                const video = videoRef.current;
                const canvas = canvasRef.current;
                canvas.width = video.videoWidth || 640;
                canvas.height = video.videoHeight || 480;
                const ctx = canvas.getContext('2d');
                ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
                const capturedImage = canvas.toDataURL('image/jpeg', 0.95);
                
                console.log('[CaptureStation] Auto-capturing for:', data.card_id);
                setCaptureStatus(`Capturing for: ${data.student_name || data.card_id}`);
                setFaceMatchResult(null);
                setFaceMatchPending(false);

                // Send captured image to server
                try {
                  await fetch(`${API_BASE}/api/capture/add-image`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                      card_id: data.card_id,
                      captured_image: capturedImage,
                      direction: 'out'
                    })
                  });
                  setLastCapture({
                    cardId: data.card_id,
                    studentName: data.student_name,
                    timestamp: new Date().toISOString(),
                    hasImage: true,
                    direction: 'out',
                    faceCheckSkipped: false
                  });
                  setCaptureStatus(`✅ Left: ${data.student_name || data.card_id}`);
                  await runFaceVerification(capturedImage, data.guardians, data.found, {
                    card_id: data.card_id,
                    student_name: data.student_name,
                    student_class: data.student_class
                  });
                } catch (err) {
                  console.error('[CaptureStation] Error sending image:', err);
                  setCaptureStatus(`❌ Failed to send image`);
                  setFaceMatchPending(false);
                }
              } else {
                setCaptureStatus(`⚠️ Camera not ready for capture`);
                setFaceMatchResult(null);
                setFaceMatchPending(false);
                if (data.found) {
                  setLastCapture({
                    cardId: data.card_id,
                    studentName: data.student_name,
                    timestamp: new Date().toISOString(),
                    hasImage: false,
                    direction: 'out',
                    faceCheckSkipped: true
                  });
                }
              }
            }
          } catch (err) {
            console.error('[CaptureStation] WebSocket parse error:', err);
          }
        };

        wsRef.current.onerror = () => setWsConnected(false);
        wsRef.current.onclose = (e) => {
          setWsConnected(false);
          if (mountedRef.current && e.code !== 1000) {
            reconnectTimeout = setTimeout(connectWebSocket, 3000);
          }
        };
      } catch (err) {
        console.error('[CaptureStation] WebSocket error:', err);
        setWsConnected(false);
        if (mountedRef.current) {
          reconnectTimeout = setTimeout(connectWebSocket, 3000);
        }
      }
    };

    connectWebSocket();
    return () => {
      if (reconnectTimeout) clearTimeout(reconnectTimeout);
      if (wsRef.current) wsRef.current.close(1000, 'Unmount');
    };
  }, [API_BASE, runFaceVerification]);

  // Handle keyboard-wedge scanner input
  const handleScan = async (cardId) => {
    const cleanedId = String(cardId || '').trim().toUpperCase();
    if (!cleanedId) return;

    const currentDirection = stationModeRef.current;
    const isCheckIn = currentDirection === 'in';
    if (
      !isCheckIn &&
      getFaceRecognitionEnabled() &&
      !areFaceModelsReady()
    ) {
      setCaptureStatus('⏳ Face recognition is still loading — please wait…');
      return;
    }

    setFaceMatchResult(null);
    setFaceMatchPending(false);

    const modeLabel = isCheckIn ? 'Arriving' : 'Leaving';
    console.log(`[CaptureStation] Manual scan (${modeLabel}):`, cleanedId);
    setCaptureStatus(`Scanning (${modeLabel}): ${cleanedId}`);

    // Mark this scan as locally initiated so the WebSocket handler
    // won't re-process the broadcast from the server (prevents double-processing
    // which caused check-in to fail on remote laptops).
    localScanDebounceRef.current.set(cleanedId, Date.now());
    // Clean up old entries
    for (const [key, ts] of localScanDebounceRef.current) {
      if (Date.now() - ts > 10000) localScanDebounceRef.current.delete(key);
    }

    // Only capture image in check-out mode
    let capturedImage = null;
    if (!isCheckIn && videoRef.current && canvasRef.current && streamRef.current) {
      const video = videoRef.current;
      const canvas = canvasRef.current;
      canvas.width = video.videoWidth || 640;
      canvas.height = video.videoHeight || 480;
      const ctx = canvas.getContext('2d');
      ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
      capturedImage = canvas.toDataURL('image/jpeg', 0.95);
    }

    try {
      const response = await fetch(`${API_BASE}/api/capture/scan`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          card_id: cleanedId,
          captured_image: capturedImage, // null in check-in mode
          direction: currentDirection
        })
      });
      
      const result = await response.json();
      
      if (result.success) {
        const actionLabel = isCheckIn ? 'Arrived' : 'Left';
        setLastCapture({
          cardId: cleanedId,
          studentName: result.student_name,
          timestamp: new Date().toISOString(),
          hasImage: !isCheckIn && !!capturedImage,
          direction: currentDirection,
          faceCheckSkipped: !isCheckIn && !!result.found && !capturedImage
        });
        setCaptureStatus(`✅ ${actionLabel}: ${result.student_name || cleanedId}`);
        if (!isCheckIn && capturedImage && result.found) {
          await runFaceVerification(capturedImage, result.guardians, true, {
            card_id: result.card_id || cleanedId,
            student_name: result.student_name,
            student_class: result.student_class
          });
        } else {
          setFaceMatchResult(null);
          setFaceNoMatchAlert(null);
          setFaceMatchPending(false);
        }
      } else {
        setCaptureStatus(`⚠️ ${result.message || 'Unknown card'}`);
        setFaceMatchResult(null);
        setFaceNoMatchAlert(null);
        setFaceMatchPending(false);
      }
    } catch (error) {
      console.error('[CaptureStation] Scan error:', error);
      setCaptureStatus(`❌ Error: ${error.message}`);
      setFaceNoMatchAlert(null);
      setFaceMatchPending(false);
    }
  };

  // Keep hidden input focused for keyboard-wedge scanners
  useEffect(() => {
    const focusScanInput = () => {
      if (scanInputRef.current) scanInputRef.current.focus();
    };
    focusScanInput();
    
    const onFocus = () => focusScanInput();
    const onVisibility = () => {
      if (document.visibilityState === 'visible') focusScanInput();
    };
    
    window.addEventListener('focus', onFocus);
    document.addEventListener('visibilitychange', onVisibility);
    
    return () => {
      window.removeEventListener('focus', onFocus);
      document.removeEventListener('visibilitychange', onVisibility);
    };
  }, []);

  // Global keyboard listener for keyboard-wedge scanners
  useEffect(() => {
    const onKeyDown = (e) => {
      const t = e.target;
      const tag = (t?.tagName || '').toLowerCase();
      const isTyping = tag === 'input' || tag === 'textarea' || tag === 'select' || t?.isContentEditable;
      if (isTyping && t !== scanInputRef.current) return;

      const now = Date.now();
      if (now - lastKeyAtRef.current > 120) {
        scanBufferRef.current = '';
        setScanDraft('');
      }
      lastKeyAtRef.current = now;

      if (e.key === 'Enter') {
        const raw = scanBufferRef.current;
        scanBufferRef.current = '';
        setScanDraft('');
        if (raw && raw.trim()) handleScan(raw);
        return;
      }

      if (['Shift', 'Alt', 'Control', 'Meta', 'CapsLock'].includes(e.key)) return;

      if (e.key && e.key.length === 1 && /[0-9A-Za-z]/.test(e.key)) {
        scanBufferRef.current += e.key;
        setScanDraft(scanBufferRef.current);
      }
    };

    window.addEventListener('keydown', onKeyDown, true);
    return () => window.removeEventListener('keydown', onKeyDown, true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div className="capture-station-page">
      {frsModelsLoadingGate && stationMode === 'out' && frsEnabled && (
        <div
          className="capture-frs-loading-modal"
          role="alertdialog"
          aria-modal="true"
          aria-labelledby="capture-frs-loading-title"
          aria-describedby="capture-frs-loading-desc"
        >
          <div className="capture-frs-loading-card">
            <div className="capture-frs-loading-spinner" aria-hidden="true" />
            <h2 id="capture-frs-loading-title" className="capture-frs-loading-title">
              Preparing face recognition
            </h2>
            <p id="capture-frs-loading-desc" className="capture-frs-loading-desc">
              Downloading models and warming up the engine — this only happens once after a page refresh.
              Scans are paused until everything is ready.
            </p>
          </div>
        </div>
      )}

      {stationMode === 'out' && (
        <FaceNoMatchBanner
          alert={faceNoMatchAlert}
          onDismiss={() => setFaceNoMatchAlert(null)}
        />
      )}

      {/* Hidden input for keyboard-wedge scanner */}
      <input
        ref={scanInputRef}
        value=""
        onChange={() => {}}
        autoFocus
        style={{ position: 'absolute', opacity: 0, pointerEvents: 'none', height: 0, width: 0 }}
      />

      <header className="capture-station-header">
        <h1>📷 Capture Station</h1>
        
        {/* Station Mode Toggle - Leaving / Arriving */}
        <div className="station-mode-toggle">
          <button 
            className={`mode-btn ${stationMode === 'out' ? 'active mode-out' : ''}`}
            onClick={() => handleModeChange('out')}
          >
            <span className="mode-icon">🚗</span>
            <span className="mode-label">Leaving School</span>
            <span className="mode-desc">Check-OUT</span>
          </button>
          <button 
            className={`mode-btn ${stationMode === 'in' ? 'active mode-in' : ''}`}
            onClick={() => handleModeChange('in')}
          >
            <span className="mode-icon">🏫</span>
            <span className="mode-label">Arriving at School</span>
            <span className="mode-desc">Check-IN</span>
          </button>
        </div>

        <div className="capture-station-status-row">
          <span className={`status-badge ${wsConnected ? 'connected' : 'disconnected'}`}>
            {wsConnected ? '✅ Server Connected' : '⏳ Connecting...'}
          </span>
          {/* Only show camera status in check-out mode */}
          {stationMode === 'out' && (
            <span className={`status-badge ${cameraActive ? 'camera-on' : 'camera-off'}`}>
              {cameraActive ? '📹 Camera Active' : '📷 Camera Starting...'}
            </span>
          )}
          <span className={`status-badge mode-indicator ${stationMode === 'in' ? 'mode-in' : 'mode-out'}`}>
            {stationMode === 'in' ? '📥 ARRIVING' : '📤 LEAVING'}
          </span>
        </div>
        {scanDraft && (
          <div className="scan-draft">Scanning: {scanDraft}</div>
        )}
      </header>

      <main className={`capture-station-main ${stationMode === 'in' ? 'checkin-mode' : ''}`}>
        {/* CHECK-IN MODE: Simple waiting for scan view */}
        {stationMode === 'in' && (
          <div className="checkin-waiting-section">
            <div className="checkin-waiting-box">
              <div className="checkin-icon">🏫</div>
              <h2>Waiting for Student Scan</h2>
              <p className="checkin-subtitle">Scan RFID card to mark student as arrived</p>
              
              <div className="checkin-status">
                {/* Only show scan-related status, not camera status */}
                {captureStatus.includes('Camera') || captureStatus.includes('camera') 
                  ? 'Waiting for student scan...' 
                  : captureStatus}
              </div>

              {lastCapture && lastCapture.direction === 'in' && (
                <div className="checkin-last-scan">
                  <h3>Last Arrival</h3>
                  <div className="checkin-student-info">
                    <p className="student-name">{lastCapture.studentName || 'Unknown'}</p>
                    <p className="scan-time">{new Date(lastCapture.timestamp).toLocaleTimeString()}</p>
                    <p className="scan-status">✅ Arrived Successfully</p>
                  </div>
                </div>
              )}
            </div>

            <div className="checkin-instructions">
              <h3>Arrival Mode</h3>
              <ul>
                <li>Camera is off in this mode</li>
                <li>Simply scan the student's RFID card</li>
                <li>Student will be marked as arrived at school</li>
              </ul>
            </div>
          </div>
        )}

        {/* CHECK-OUT MODE: Camera Preview */}
        {stationMode === 'out' && (
          <>
            <div className="capture-preview-section">
              <div className="capture-preview-header">
                <h2>Live Camera</h2>
                <div className="capture-preview-controls">
                  <select value={selectedCamera} onChange={handleCameraChange}>
                    <option value="">Default camera</option>
                    {cameras.length === 0 ? (
                      <option value="__detecting" disabled>Detecting cameras...</option>
                    ) : (
                      cameras.map((cam, idx) => (
                        <option key={cam.deviceId ? cam.deviceId : `cam-${idx}`} value={cam.deviceId || ''}>
                          {cam.label || `Camera ${idx + 1}`}
                        </option>
                      ))
                    )}
                  </select>
                </div>
              </div>

              <div className="capture-preview-video-container">
                <video
                  ref={videoRef}
                  autoPlay
                  playsInline
                  muted
                  className={`capture-preview-video ${cameraActive ? 'active' : ''}`}
                />
                {!cameraActive && (
                  <div className="capture-preview-placeholder">
                    <span>📷</span>
                    <p>{cameraError || 'Starting camera...'}</p>
                  </div>
                )}
                {cameraActive && (
                  <div className="capture-live-indicator">
                    <span className="live-dot"></span> LIVE
                  </div>
                )}
              </div>

              <div className="capture-status-inline">
                {captureStatus}
              </div>
            </div>

            {/* Status & Last Capture */}
            <div className="capture-info-section">
              {lastCapture && lastCapture.direction === 'out' && (
                <>
                  <div className="last-capture-box capture-out">
                    <h3>Last Departure</h3>
                    <div className="last-capture-info">
                      <p><strong>Card:</strong> {lastCapture.cardId}</p>
                      <p><strong>Student:</strong> {lastCapture.studentName || 'Unknown'}</p>
                      <p><strong>Time:</strong> {new Date(lastCapture.timestamp).toLocaleTimeString()}</p>
                      <p><strong>Image:</strong> {lastCapture.hasImage ? '✅ Captured' : '❌ No image'}</p>
                    </div>
                    {lastCapture.faceCheckSkipped && (
                      <p className="last-capture-face-hint">
                        ⚠️ No pickup photo — guardian face check was skipped. Wait until the camera shows LIVE, then scan again.
                      </p>
                    )}
                  </div>

                  {(lastCapture.faceCheckSkipped ||
                    (lastCapture.hasImage && (faceMatchPending || faceMatchResult))) && (
                    <div
                      className={`guardian-face-check-box face-match-panel ${
                        lastCapture.faceCheckSkipped
                          ? 'face-match-muted'
                          : faceMatchPending
                          ? 'face-match-pending-panel'
                          : faceMatchResult?.status === 'disabled'
                          ? 'face-match-muted'
                          : faceMatchResult?.status === 'ok'
                          ? faceMatchResult.yes
                            ? 'face-match-yes'
                            : 'face-match-no'
                          : 'face-match-muted'
                      }`}
                    >
                      <h3 className="guardian-face-check-heading">Guardian face check</h3>
                      {lastCapture.faceCheckSkipped && (
                        <>
                          <div className="face-match-verdict">Skipped — no photo</div>
                          <div className="face-match-detail">
                            The camera did not capture an image for this scan. Face matching needs a live photo at checkout.
                          </div>
                        </>
                      )}
                      {!lastCapture.faceCheckSkipped && faceMatchPending && (
                        <div className="face-match-pending-block">
                          <div className="face-match-pending-spinner" aria-hidden="true" />
                          <p className="face-match-pending-title">Analyzing face…</p>
                          <p className="face-match-pending-hint">
                            The first check can take 10–30 seconds while face models load in the browser.
                          </p>
                        </div>
                      )}
                      {!lastCapture.faceCheckSkipped &&
                        !faceMatchPending &&
                        faceMatchResult &&
                        faceMatchResult.status === 'disabled' && (
                        <>
                          <div className="face-match-verdict">Face recognition off</div>
                          <div className="face-match-detail">
                            {faceMatchResult.message ||
                              'Turn it on in Admin → Test Tools when you want guardian matching at checkout.'}
                          </div>
                        </>
                      )}
                      {!lastCapture.faceCheckSkipped &&
                        !faceMatchPending &&
                        faceMatchResult &&
                        faceMatchResult.status === 'ok' &&
                        faceMatchResult.yes && (
                        <div className="face-match-matched-row">
                          {faceMatchResult.matchedGuardian?.image ? (
                            <img
                              className="face-match-matched-photo"
                              src={faceMatchResult.matchedGuardian.image}
                              alt=""
                            />
                          ) : (
                            <div className="face-match-matched-photo face-match-matched-photo-placeholder">
                              👤
                            </div>
                          )}
                          <div className="face-match-matched-text">
                            <div className="face-match-verdict">YES — Match</div>
                            <div className="face-match-matched-name">
                              {faceMatchResult.matchedGuardian?.label ||
                                faceMatchResult.matchedGuardian?.name ||
                                faceMatchResult.bestLabel ||
                                'Matched guardian'}
                            </div>
                            {typeof faceMatchResult.confidence === 'number' && (
                              <div className="face-match-confidence">
                                {faceMatchResult.confidence}% confidence
                              </div>
                            )}
                          </div>
                        </div>
                      )}
                      {!lastCapture.faceCheckSkipped &&
                        !faceMatchPending &&
                        faceMatchResult &&
                        faceMatchResult.status === 'ok' &&
                        !faceMatchResult.yes && (
                        <>
                          <div className="face-match-verdict">NO — No match</div>
                          {faceMatchResult.matchedGuardian &&
                            (faceMatchResult.matchedGuardian.label || faceMatchResult.matchedGuardian.name) && (
                              <div className="face-match-detail face-match-closest">
                                Closest on file:{' '}
                                {faceMatchResult.matchedGuardian.label ||
                                  faceMatchResult.matchedGuardian.name}
                                {typeof faceMatchResult.confidence === 'number'
                                  ? ` (${faceMatchResult.confidence}%)`
                                  : ''}
                              </div>
                            )}
                        </>
                      )}
                      {!lastCapture.faceCheckSkipped &&
                        !faceMatchPending &&
                        faceMatchResult &&
                        faceMatchResult.status === 'no_face' && (
                        <div className="face-match-verdict">No face detected in capture</div>
                      )}
                      {!lastCapture.faceCheckSkipped &&
                        !faceMatchPending &&
                        faceMatchResult &&
                        faceMatchResult.status === 'no_refs' && (
                        <div className="face-match-verdict">No reference faces on file</div>
                      )}
                      {!lastCapture.faceCheckSkipped &&
                        !faceMatchPending &&
                        faceMatchResult &&
                        (faceMatchResult.status === 'error' || faceMatchResult.message) &&
                        faceMatchResult.status !== 'ok' &&
                        faceMatchResult.status !== 'no_face' &&
                        faceMatchResult.status !== 'no_refs' &&
                        faceMatchResult.status !== 'disabled' && (
                          <div className="face-match-detail">{faceMatchResult.message}</div>
                        )}
                    </div>
                  )}
                </>
              )}

              <div className="capture-instructions">
                <h3>Leaving Mode</h3>
                <ol>
                  <li>Camera captures photo on each scan</li>
                  <li>Scan student's RFID card</li>
                  <li>Photo is automatically captured</li>
                  <li>Record appears in Principal's Dashboard</li>
                </ol>
              </div>
            </div>
          </>
        )}
      </main>

      {/* Hidden canvas for capture */}
      <canvas ref={canvasRef} style={{ display: 'none' }} />

      <nav className="capture-station-nav">
        <Link to="/" className="nav-link">🏠 Home</Link>
        <Link to="/admin" className="nav-link">⚙️ Admin</Link>
      </nav>
    </div>
  );
}

export default CaptureStation;
