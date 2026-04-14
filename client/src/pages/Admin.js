import React, { useState, useEffect, useRef, useCallback } from 'react';
import { Link } from 'react-router-dom';
import './Admin.css';
import {
  getFaceMatchThreshold,
  setFaceMatchThreshold,
  FACE_MATCH_THRESHOLD_MIN,
  FACE_MATCH_THRESHOLD_MAX,
  getFaceRecognitionEnabled,
  setFaceRecognitionEnabled,
  FACE_SETTINGS_CHANGED_EVENT
} from '../utils/faceVerification';

const ADMIN_PASSWORD = 'system1234';
// Same-origin API (dev server proxies to backend; production runs on same host)
const API_BASE = '';

function FaceRecognitionSettings() {
  const [frsOn, setFrsOn] = useState(() => getFaceRecognitionEnabled());
  const [threshold, setThreshold] = useState(() => getFaceMatchThreshold());

  useEffect(() => {
    const sync = () => {
      setFrsOn(getFaceRecognitionEnabled());
      setThreshold(getFaceMatchThreshold());
    };
    window.addEventListener('storage', sync);
    window.addEventListener(FACE_SETTINGS_CHANGED_EVENT, sync);
    return () => {
      window.removeEventListener('storage', sync);
      window.removeEventListener(FACE_SETTINGS_CHANGED_EVENT, sync);
    };
  }, []);

  return (
    <section className="admin-section admin-face-recognition-section">
      <h2>Facial recognition (capture station)</h2>
      <p className="admin-desc">
        Guardian face matching when students leave. Pickup photos and RFID logs are still saved when this is off.
      </p>

      <div className="admin-frs-toggle-row">
        <div className="admin-frs-toggle-copy">
          <span className="admin-frs-toggle-label" id="admin-frs-toggle-label">
            Enable face recognition
          </span>
          <span className={`admin-frs-pill ${frsOn ? 'admin-frs-pill-on' : 'admin-frs-pill-off'}`}>
            {frsOn ? 'On' : 'Off'}
          </span>
        </div>
        <button
          type="button"
          className={`admin-switch ${frsOn ? 'admin-switch-on' : ''}`}
          role="switch"
          aria-checked={frsOn}
          aria-labelledby="admin-frs-toggle-label"
          onClick={() => {
            const next = setFaceRecognitionEnabled(!frsOn);
            setFrsOn(next);
          }}
        >
          <span className="admin-switch-knob" />
        </button>
      </div>

      <div className={`admin-face-accuracy-block ${!frsOn ? 'admin-face-accuracy-disabled' : ''}`}>
        <h3 className="admin-face-accuracy-title">Face verification accuracy</h3>
        <p className="admin-face-accuracy-help">
          Minimum match score required at the capture station. Lower is more permissive; higher reduces false acceptances.
        </p>
        <div className="admin-face-accuracy-row">
          <input
            type="range"
            min={FACE_MATCH_THRESHOLD_MIN}
            max={FACE_MATCH_THRESHOLD_MAX}
            step={1}
            value={threshold}
            disabled={!frsOn}
            onChange={(e) => {
              const v = setFaceMatchThreshold(Number(e.target.value));
              setThreshold(v);
            }}
            className="admin-face-accuracy-slider"
            aria-valuemin={FACE_MATCH_THRESHOLD_MIN}
            aria-valuemax={FACE_MATCH_THRESHOLD_MAX}
            aria-valuenow={threshold}
            aria-label="Face match minimum percent"
          />
          <span className="admin-face-accuracy-value">{threshold}%</span>
        </div>
      </div>
    </section>
  );
}

function Admin() {
  const [password, setPassword] = useState('');
  const [isLoggedIn, setIsLoggedIn] = useState(false);
  const [loginError, setLoginError] = useState('');
  const [cards, setCards] = useState([]);
  const [selectedCardId, setSelectedCardId] = useState('');
  const [selectedCheckinCardId, setSelectedCheckinCardId] = useState('');
  const [message, setMessage] = useState(null);
  const [loading, setLoading] = useState(false);

  // Camera state
  const [cameras, setCameras] = useState([]);
  const [selectedCamera, setSelectedCamera] = useState('');
  const [cameraActive, setCameraActive] = useState(false);
  const [useLiveCamera, setUseLiveCamera] = useState(false);
  const videoRef = useRef(null);
  const canvasRef = useRef(null);
  const streamRef = useRef(null);

  useEffect(() => {
    const stored = sessionStorage.getItem('admin_logged_in');
    if (stored === 'true') setIsLoggedIn(true);
  }, []);

  useEffect(() => {
    if (!isLoggedIn) return;
    fetch(`${API_BASE}/api/cards`)
      .then((res) => res.json())
      .then((data) => {
        const list = Array.isArray(data) ? data : [];
        setCards(list);
        if (list.length && !selectedCardId) setSelectedCardId(list[0].card_id || '');
        const checkinList = list.filter((c) => String(c.checkin_card_id || '').trim() !== '');
        if (checkinList.length && !selectedCheckinCardId) {
          setSelectedCheckinCardId(checkinList[0].checkin_card_id || '');
        }
      })
      .catch(() => setCards([]));
  }, [isLoggedIn, selectedCardId, selectedCheckinCardId]);

  // Get available cameras
  const loadCameras = useCallback(async () => {
    try {
      // Request permission first
      await navigator.mediaDevices.getUserMedia({ video: true });
      const devices = await navigator.mediaDevices.enumerateDevices();
      const videoDevices = devices.filter(d => d.kind === 'videoinput');
      setCameras(videoDevices);
      if (videoDevices.length > 0 && !selectedCamera) {
        setSelectedCamera(videoDevices[0].deviceId);
      }
    } catch (err) {
      console.error('Error loading cameras:', err);
      showMessage('Could not access cameras. Check permissions.', true);
    }
  }, [selectedCamera]);

  useEffect(() => {
    if (isLoggedIn) {
      loadCameras();
    }
  }, [isLoggedIn, loadCameras]);

  // Start camera stream
  const startCamera = async () => {
    if (!selectedCamera) {
      showMessage('No camera selected', true);
      return;
    }
    try {
      // Stop existing stream
      if (streamRef.current) {
        streamRef.current.getTracks().forEach(t => t.stop());
      }
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { deviceId: { exact: selectedCamera }, width: 640, height: 480 }
      });
      streamRef.current = stream;
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        videoRef.current.play();
      }
      setCameraActive(true);
    } catch (err) {
      console.error('Error starting camera:', err);
      showMessage('Failed to start camera', true);
    }
  };

  // Stop camera stream
  const stopCamera = () => {
    if (streamRef.current) {
      streamRef.current.getTracks().forEach(t => t.stop());
      streamRef.current = null;
    }
    if (videoRef.current) {
      videoRef.current.srcObject = null;
    }
    setCameraActive(false);
  };

  // Capture image from video
  const captureImage = () => {
    if (!videoRef.current || !canvasRef.current) {
      console.error('[Admin] captureImage: missing videoRef or canvasRef');
      return null;
    }
    const video = videoRef.current;
    const canvas = canvasRef.current;
    
    // Check if video has actual dimensions (is playing)
    if (!video.videoWidth || !video.videoHeight) {
      console.error('[Admin] captureImage: video not ready (no dimensions)');
      return null;
    }
    
    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
    const ctx = canvas.getContext('2d');
    ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
    const dataUrl = canvas.toDataURL('image/jpeg', 0.8);
    console.log('[Admin] captureImage: captured', canvas.width, 'x', canvas.height, 'bytes:', dataUrl.length);
    return dataUrl;
  };

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (streamRef.current) {
        streamRef.current.getTracks().forEach(t => t.stop());
      }
    };
  }, []);

  const handleLogin = (e) => {
    e.preventDefault();
    setLoginError('');
    if (password !== ADMIN_PASSWORD) {
      setLoginError('Invalid password');
      return;
    }
    sessionStorage.setItem('admin_logged_in', 'true');
    setIsLoggedIn(true);
    setPassword('');
  };

  const handleLogout = () => {
    stopCamera();
    sessionStorage.removeItem('admin_logged_in');
    setIsLoggedIn(false);
    setMessage(null);
  };

  const showMessage = (text, isError = false) => {
    setMessage({ text, isError });
    setTimeout(() => setMessage(null), 4000);
  };

  const simulateScan = async ({ cardId, direction }) => {
    const scanCardId = String(cardId || '').trim();
    const scanDirection = direction === 'in' ? 'in' : 'out';
    if (!scanCardId) {
      showMessage('No card selected. Add cards in Management View first.', true);
      return;
    }

    // Capture image if camera is active and live camera is enabled (only for leaving/checkout)
    let liveImage = null;
    if (scanDirection === 'out' && useLiveCamera && cameraActive) {
      console.log('[Admin] Attempting to capture image...');
      liveImage = captureImage();
      if (!liveImage) {
        showMessage('Camera not ready. Please wait a moment and try again.', true);
        return;
      }
      console.log('[Admin] Image captured successfully, size:', liveImage.length);
    }

    setLoading(true);
    setMessage(null);
    try {
      const body = { 
        password: ADMIN_PASSWORD, 
        card_id: scanCardId,
        direction: scanDirection // 'in' = arriving, 'out' = leaving
      };
      if (liveImage) {
        body.live_adult_image = liveImage;
      }
      const res = await fetch(`${API_BASE}/api/admin/simulate-scan`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body)
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        showMessage(data.error || 'Simulate scan failed', true);
        return;
      }
      const actionLabel = scanDirection === 'in' ? 'Arrived' : 'Left';
      const photoNote = liveImage ? ' (photo captured!)' : (useLiveCamera && cameraActive ? ' (camera was on but no photo - check console)' : '');
      showMessage(`${actionLabel}: ${data.card?.student_name || scanCardId}${photoNote}`);
    } catch (err) {
      showMessage('Network error. Is the server running?', true);
    } finally {
      setLoading(false);
    }
  };

  const clearDisplay = async () => {
    setLoading(true);
    setMessage(null);
    try {
      const res = await fetch(`${API_BASE}/api/admin/clear-display`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ password: ADMIN_PASSWORD })
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        showMessage(data.error || 'Clear failed', true);
        return;
      }
      showMessage('Display clear sent. Class view will reset.');
    } catch (err) {
      showMessage('Network error.', true);
    } finally {
      setLoading(false);
    }
  };

  if (!isLoggedIn) {
    return (
      <div className="admin-page">
        <div className="admin-login-box">
          <h1>Admin</h1>
          <p className="admin-login-hint">Enter password to access test tools</p>
          <form onSubmit={handleLogin} className="admin-form">
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="Password"
              autoFocus
              className="admin-input"
            />
            <button type="submit" className="admin-btn admin-btn-primary">Log in</button>
          </form>
          {loginError && <p className="admin-error">{loginError}</p>}
          <Link to="/" className="admin-back">← Back to Home</Link>
        </div>
      </div>
    );
  }

  return (
    <div className="admin-page">
      <div className="admin-header">
        <h1>Admin – Test Tools</h1>
        <div className="admin-header-actions">
          <Link to="/" className="admin-nav-link">🏠 Home</Link>
          <button type="button" onClick={handleLogout} className="admin-btn admin-btn-outline">Log out</button>
        </div>
      </div>

      <main className="admin-main">
        <FaceRecognitionSettings />

        {/* Camera Section */}
        <section className="admin-section admin-section-camera">
          <h2>📷 Live Camera Capture</h2>
          <p className="admin-desc">Capture guardian image when simulating a scan.</p>
          
          <div className="admin-form-row">
            <label htmlFor="camera-select">Select Camera</label>
            <select
              id="camera-select"
              value={selectedCamera}
              onChange={(e) => setSelectedCamera(e.target.value)}
              className="admin-select"
              disabled={cameraActive}
            >
              {cameras.length === 0 ? (
                <option value="">No cameras found</option>
              ) : (
                cameras.map((cam) => (
                  <option key={cam.deviceId} value={cam.deviceId}>
                    {cam.label || `Camera ${cameras.indexOf(cam) + 1}`}
                  </option>
                ))
              )}
            </select>
          </div>

          <div className="admin-camera-controls">
            {!cameraActive ? (
              <button
                type="button"
                onClick={startCamera}
                disabled={!selectedCamera || cameras.length === 0}
                className="admin-btn admin-btn-primary admin-btn-compact"
              >
                <span className="btn-icon" aria-hidden="true">🎥</span>
                <span className="btn-text">Capture Station</span>
              </button>
            ) : (
              <button
                type="button"
                onClick={stopCamera}
                className="admin-btn admin-btn-secondary admin-btn-compact"
              >
                <span className="btn-icon" aria-hidden="true">⏹</span>
                <span className="btn-text">Stop Station</span>
              </button>
            )}
            <button
              type="button"
              onClick={loadCameras}
              className="admin-btn admin-btn-outline-dark admin-btn-compact"
            >
              <span className="btn-icon" aria-hidden="true">↻</span>
              <span className="btn-text">Refresh</span>
            </button>
          </div>

          {cameraActive && (
            <div className="admin-camera-preview">
              <video ref={videoRef} autoPlay playsInline muted className="admin-video" />
              <div className="admin-camera-status">🔴 Camera Active</div>
            </div>
          )}
          <canvas ref={canvasRef} style={{ display: 'none' }} />

          <div className="admin-form-row admin-checkbox-row">
            <label className="admin-checkbox-label">
              <input
                type="checkbox"
                checked={useLiveCamera}
                onChange={(e) => setUseLiveCamera(e.target.checked)}
              />
              <span>Use live camera image for guardian (instead of stored image)</span>
            </label>
          </div>
        </section>

        {/* Simulate Scan Section */}
        <section className="admin-section">
          <h2>Simulate card scan</h2>
          <p className="admin-desc">
            Replicate a scanned card so Class View shows the pickup/arrival.
            {useLiveCamera && cameraActive && ' Guardian image will be captured from camera for check-out.'}
          </p>

          <div className="admin-form-row">
            <label htmlFor="admin-card-select">Check-OUT Card / Student</label>
            <select
              id="admin-card-select"
              value={selectedCardId}
              onChange={(e) => setSelectedCardId(e.target.value)}
              className="admin-select"
            >
              {cards.length === 0 ? (
                <option value="">No cards – add in Management View</option>
              ) : (
                cards.map((c) => (
                  <option key={c.id} value={c.card_id}>
                    {c.student_name} {c.student_class ? `(${c.student_class})` : ''} – {c.card_id}
                  </option>
                ))
              )}
            </select>
          </div>
          <button
            type="button"
            onClick={() => simulateScan({ cardId: selectedCardId || cards[0]?.card_id, direction: 'out' })}
            disabled={loading || cards.length === 0}
            className="admin-btn admin-btn-primary admin-btn-compact"
          >
            {loading ? (
              'Sending…'
            ) : (
              <>
                <span className="btn-icon" aria-hidden="true">{useLiveCamera && cameraActive ? '📷' : '🚗'}</span>
                <span className="btn-text">Leaving School</span>
              </>
            )}
          </button>

          <div className="admin-form-row" style={{ marginTop: 16 }}>
            <label htmlFor="admin-checkin-card-select">Check-IN Card / Student</label>
            <select
              id="admin-checkin-card-select"
              value={selectedCheckinCardId}
              onChange={(e) => setSelectedCheckinCardId(e.target.value)}
              className="admin-select"
            >
              {cards.filter((c) => String(c.checkin_card_id || '').trim() !== '').length === 0 ? (
                <option value="">No check-in cards – set “Check-IN Card (RFID)” in Management View</option>
              ) : (
                cards
                  .filter((c) => String(c.checkin_card_id || '').trim() !== '')
                  .map((c) => (
                    <option key={c.id} value={c.checkin_card_id}>
                      {c.student_name} {c.student_class ? `(${c.student_class})` : ''} – {c.checkin_card_id}
                    </option>
                  ))
              )}
            </select>
          </div>
          <button
            type="button"
            onClick={() => simulateScan({ cardId: selectedCheckinCardId, direction: 'in' })}
            disabled={loading || cards.filter((c) => String(c.checkin_card_id || '').trim() !== '').length === 0}
            className="admin-btn admin-btn-success admin-btn-compact"
          >
            {loading ? (
              'Sending…'
            ) : (
              <>
                <span className="btn-icon" aria-hidden="true">🏫</span>
                <span className="btn-text">Arriving at School</span>
              </>
            )}
          </button>
        </section>

        <section className="admin-section">
          <h2>Child went out</h2>
          <p className="admin-desc">Clear the Class View display so it goes back to "Scan a card to show pickup".</p>
          <button
            type="button"
            onClick={clearDisplay}
            disabled={loading}
            className="admin-btn admin-btn-secondary"
          >
            {loading ? 'Sending…' : 'Clear display'}
          </button>
        </section>

        <section className="admin-section">
          <h2>Bulk UHF times (all students)</h2>
          <p className="admin-desc">
            For every student who has a <strong>UHF tag</strong> on file, record one shared timestamp in the
            attendance log as either everyone arrived (IN) or everyone left (OUT). Dashboards and history update
            immediately. Does not change RFID pickup rows — use &quot;Reset pickups&quot; for that.
          </p>
          <div className="admin-bulk-attendance-row">
            <button
              type="button"
              onClick={async () => {
                if (!window.confirm('Record arrival (IN) for all students with UHF tags, at the current time?')) return;
                setLoading(true);
                setMessage(null);
                try {
                  const res = await fetch(`${API_BASE}/api/admin/set-all-attendance`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ password: ADMIN_PASSWORD, status: 'in' })
                  });
                  const data = await res.json().catch(() => ({}));
                  if (!res.ok) {
                    showMessage(data.error || 'Request failed', true);
                  } else {
                    showMessage(data.message || `Set ${data.updated ?? 0} to IN.`);
                  }
                } catch {
                  showMessage('Network error.', true);
                } finally {
                  setLoading(false);
                }
              }}
              disabled={loading}
              className="admin-btn admin-btn-success admin-btn-compact"
            >
              {loading ? 'Working…' : 'Set arrival time (all IN)'}
            </button>
            <button
              type="button"
              onClick={async () => {
                if (!window.confirm('Record departure (OUT) for all students with UHF tags, at the current time?')) return;
                setLoading(true);
                setMessage(null);
                try {
                  const res = await fetch(`${API_BASE}/api/admin/set-all-attendance`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ password: ADMIN_PASSWORD, status: 'out' })
                  });
                  const data = await res.json().catch(() => ({}));
                  if (!res.ok) {
                    showMessage(data.error || 'Request failed', true);
                  } else {
                    showMessage(data.message || `Set ${data.updated ?? 0} to OUT.`);
                  }
                } catch {
                  showMessage('Network error.', true);
                } finally {
                  setLoading(false);
                }
              }}
              disabled={loading}
              className="admin-btn admin-btn-secondary admin-btn-compact"
            >
              {loading ? 'Working…' : 'Set departure time (all OUT)'}
            </button>
          </div>
        </section>

        <section className="admin-section">
          <h2>Simulate morning (reset pickups)</h2>
          <p className="admin-desc">Clear all pickup records so every student is counted as &quot;in&quot; again. Use at start of day.</p>
          <button
            type="button"
            onClick={async () => {
              setLoading(true);
              setMessage(null);
              try {
                const res = await fetch(`${API_BASE}/api/admin/reset-pickups`, {
                  method: 'POST',
                  headers: { 'Content-Type': 'application/json' },
                  body: JSON.stringify({ password: ADMIN_PASSWORD })
                });
                const data = await res.json().catch(() => ({}));
                if (!res.ok) {
                  showMessage(data.error || 'Reset failed', true);
                } else {
                  showMessage(data.message || `Cleared ${data.cleared ?? 0} pickups. All students in.`);
                }
              } catch (err) {
                showMessage('Network error.', true);
              } finally {
                setLoading(false);
              }
            }}
            disabled={loading}
            className="admin-btn admin-btn-secondary"
          >
            {loading ? 'Resetting…' : 'Reset pickups (morning)'}
          </button>
        </section>

        {message && (
          <div className={`admin-message ${message.isError ? 'admin-message-error' : ''}`}>
            {message.text}
          </div>
        )}
      </main>
    </div>
  );
}

export default Admin;
