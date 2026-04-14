import React, { useState, useEffect, useRef, useCallback } from 'react';
import { Link, useParams } from 'react-router-dom';
import './ClassView.css';

// API base - use direct backend URL for external access
const getApiBase = () => {
  if (window.location.hostname !== 'localhost' && window.location.hostname !== '127.0.0.1') {
    return `http://${window.location.hostname}:5000`;
  }
  return '';
};
const API_BASE = getApiBase();

// WebSocket URL for real-time updates
const getWsUrl = () => {
  const host = window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1'
    ? 'localhost'
    : window.location.hostname;
  return `ws://${host}:5000/`;
};

function ClassView() {
  const { classId } = useParams();
  const [currentScan, setCurrentScan] = useState(null);
  const [connected, setConnected] = useState(false);
  const [adultImgOk, setAdultImgOk] = useState(true);
  const [childImgOk, setChildImgOk] = useState(true);
  const [scanDraft, setScanDraft] = useState('');
  const [attendanceSummary, setAttendanceSummary] = useState({ total: 0, in: 0, out: 0 });
  const [attendanceRecords, setAttendanceRecords] = useState([]);
  const lastPickupIdRef = useRef(null);
  const clearedAtRef = useRef(null); // Track when display was cleared
  const autoClearDisplayRef = useRef(null);

  // Keyboard-wedge (HID) scanners type into the focused element.
  // Keep a hidden input focused so the Class View is always ready.
  const scanInputRef = useRef(null);
  const scanBufferRef = useRef('');
  const lastKeyAtRef = useRef(0);

  const classLabel = classId === '1' ? 'Class 1' : classId === '2' ? 'Class 2' : classId === '3' ? 'Class 3' : classId === '4' ? 'Class 4' : classId === '5' ? 'Class 5' : classId === 'prenursery' ? 'Prenursery' : classId === 'nursery' ? 'Nursery' : classId;

  // Fetch attendance summary (and raw records) for this class
  const fetchClassAttendance = useCallback(async () => {
    try {
      const res = await fetch(`${API_BASE}/api/attendance/class/${encodeURIComponent(classId)}`);
      if (!res.ok) return;
      const data = await res.json();
      const list = data.attendance || [];
      setAttendanceRecords(list);
      setAttendanceSummary({
        total: list.length,
        in: list.filter((a) => a.status === 'in').length,
        out: list.filter((a) => a.status === 'out').length
      });
    } catch { /* ignore */ }
  }, [classId]);

  useEffect(() => {
    fetchClassAttendance();
    const interval = setInterval(fetchClassAttendance, 5000);
    return () => clearInterval(interval);
  }, [fetchClassAttendance]);

  // After 5 minutes showing a pickup, hide the child/guardian display (same as idle screen)
  useEffect(() => {
    if (autoClearDisplayRef.current) {
      clearTimeout(autoClearDisplayRef.current);
      autoClearDisplayRef.current = null;
    }
    if (!currentScan) return undefined;
    autoClearDisplayRef.current = setTimeout(() => {
      autoClearDisplayRef.current = null;
      setCurrentScan(null);
      // Keep lastPickupIdRef so polling does not immediately re-show the same pickup row
    }, 5 * 60 * 1000);
    return () => {
      if (autoClearDisplayRef.current) {
        clearTimeout(autoClearDisplayRef.current);
        autoClearDisplayRef.current = null;
      }
    };
  }, [currentScan]);

  // Submit a keyboard-wedge scan to the server
  const submitScan = useCallback(async (cardId) => {
    const cleaned = String(cardId || '').trim();
    if (!cleaned) return;
    
    try {
      const response = await fetch(`${API_BASE}/api/rfid/scan`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ card_id: cleaned }),
      });
      const result = await response.json();
      console.log('[ClassView] Manual scan result:', result);
      // Polling will pick up the new scan
    } catch (error) {
      console.error('[ClassView] Error submitting scan:', error);
    }
  }, []);

  // WebSocket connection for real-time events (clear display, etc.)
  useEffect(() => {
    let ws = null;
    let reconnectTimeout = null;
    let isMounted = true;

    const connectWs = () => {
      try {
        ws = new WebSocket(getWsUrl());
        
        ws.onopen = () => {
          console.log('[ClassView] WebSocket connected');
        };

        ws.onmessage = (event) => {
          try {
            const data = JSON.parse(event.data);
            
            // Handle clear display command from Admin
            if (data.type === 'clear_class_display') {
              console.log('[ClassView] Received clear_class_display');
              setCurrentScan(null);
              lastPickupIdRef.current = null;
              clearedAtRef.current = new Date().toISOString(); // Ignore pickups before this time
            }

            // Handle card_scan events (from admin simulate or physical RFID)
            // Only show check-OUT (pickup) events; arrivals don't display on ClassView
            if (data.type === 'card_scan' && data.card_id && data.student_class && data.direction !== 'in') {
              const scanClass = (data.student_class || '').toString().trim().toLowerCase().replace(/^(class|grade)\s+/, '').trim();
              const viewClass = (classId || '').toString().trim().toLowerCase().replace(/^(class|grade)\s+/, '').trim();
              
              if (scanClass === viewClass || scanClass.endsWith(viewClass) || viewClass.endsWith(scanClass)) {
                console.log('[ClassView] Received card_scan for this class:', data.student_name, data.direction);
                const guardianImage = data.pickup_image || data.adult_image || '';
                setCurrentScan({
                  card_id: data.card_id,
                  student_name: data.student_name || data.name || 'Unknown',
                  adult_name: data.adult_name || '',
                  adult_image: guardianImage,
                  child_image: data.child_image || '',
                  timestamp: data.timestamp || new Date().toISOString(),
                  direction: data.direction || 'out',
                  found: data.found !== false
                });
                setAdultImgOk(true);
                setChildImgOk(true);
                clearedAtRef.current = null; // Reset clear since we have a new scan
              }
            }

            // Handle attendance changes from UHF reader or admin bulk set
            if (
              data.type === 'attendance_change' ||
              data.type === 'attendance_reset' ||
              data.type === 'attendance_mass_update'
            ) {
              fetchClassAttendance();
            }

            // Handle checkin_update - ignore (arrivals don't display on ClassView)
            // Handle pickup_image_update - show (it's a checkout image update)
            if (data.type === 'pickup_image_update' && data.student_class) {
              const scanClass = (data.student_class || '').toString().trim().toLowerCase().replace(/^(class|grade)\s+/, '').trim();
              const viewClass = (classId || '').toString().trim().toLowerCase().replace(/^(class|grade)\s+/, '').trim();
              
              if (scanClass === viewClass || scanClass.endsWith(viewClass) || viewClass.endsWith(scanClass)) {
                console.log('[ClassView] Received pickup_image_update for this class:', data.student_name);
                const guardianImage = data.pickup_image || data.captured_image || data.adult_image || '';
                setCurrentScan({
                  card_id: data.card_id,
                  student_name: data.student_name || 'Unknown',
                  adult_name: data.adult_name || '',
                  adult_image: guardianImage,
                  child_image: data.child_image || '',
                  timestamp: data.timestamp || new Date().toISOString(),
                  direction: data.direction || 'out',
                  found: true
                });
                setAdultImgOk(true);
                setChildImgOk(true);
                clearedAtRef.current = null;
              }
            }
          } catch (e) {
            // Ignore non-JSON messages
          }
        };

        ws.onclose = () => {
          if (isMounted) {
            reconnectTimeout = setTimeout(connectWs, 3000);
          }
        };

        ws.onerror = () => {
          ws?.close();
        };
      } catch (err) {
        console.error('[ClassView] WebSocket error:', err);
        if (isMounted) {
          reconnectTimeout = setTimeout(connectWs, 3000);
        }
      }
    };

    connectWs();

    return () => {
      isMounted = false;
      if (reconnectTimeout) clearTimeout(reconnectTimeout);
      if (ws) ws.close();
    };
  }, []);

  // HTTP polling for latest pickup (works across network without WebSocket issues)
  useEffect(() => {
    let isMounted = true;
    
    const fetchLatestPickup = async () => {
      try {
        const res = await fetch(`${API_BASE}/api/principal/class/${encodeURIComponent(classId)}/latest`);
        if (!res.ok) return;
        const contentType = res.headers.get('content-type');
        if (!contentType || !contentType.includes('application/json')) return;
        
        const data = await res.json();
        if (!isMounted) return;
        
        setConnected(true);
        
        if (data.pickup && data.pickup.id !== lastPickupIdRef.current) {
          // Skip arrivals (check-in) - ClassView only shows pickups (check-out)
          if (data.pickup.direction === 'in') return;

          // Check if pickup is after the last clear (if any)
          const pickupTime = data.pickup.timestamp ? new Date(data.pickup.timestamp) : new Date(0);
          const clearedTime = clearedAtRef.current ? new Date(clearedAtRef.current) : new Date(0);
          
          if (pickupTime > clearedTime) {
            // New pickup detected (after last clear)
            lastPickupIdRef.current = data.pickup.id;
            // Prioritize pickup_image (live capture) if available, fall back to stored adult_image
            const guardianImage = data.pickup.pickup_image || data.pickup.adult_image || '';
            setCurrentScan({
              card_id: data.pickup.card_id,
              student_name: data.pickup.student_name || 'Unknown',
              adult_name: data.pickup.adult_name || '',
              adult_image: guardianImage,
              child_image: data.pickup.child_image || '',
              timestamp: data.pickup.timestamp || new Date().toISOString(),
              found: true
            });
            setAdultImgOk(true);
            setChildImgOk(true);
          }
        }
      } catch (err) {
        console.error('[ClassView] Polling error:', err);
        if (isMounted) setConnected(false);
      }
    };

    // Initial fetch
    fetchLatestPickup();
    
    // Poll every 1 second for responsive updates
    const interval = setInterval(fetchLatestPickup, 1000);
    
    return () => {
      isMounted = false;
      clearInterval(interval);
    };
  }, [classId]);

  // Keep the hidden scan input focused for keyboard-wedge scanners
  useEffect(() => {
    const focusScanInput = () => {
      if (scanInputRef.current) {
        scanInputRef.current.focus();
      }
    };

    focusScanInput();

    const onWindowFocus = () => focusScanInput();
    const onVisibilityChange = () => {
      if (document.visibilityState === 'visible') focusScanInput();
    };

    window.addEventListener('focus', onWindowFocus);
    document.addEventListener('visibilitychange', onVisibilityChange);

    return () => {
      window.removeEventListener('focus', onWindowFocus);
      document.removeEventListener('visibilitychange', onVisibilityChange);
    };
  }, []);

  // Global keyboard listener for keyboard-wedge scanners
  useEffect(() => {
    const onGlobalKeyDown = (e) => {
      // Don't intercept when user is typing in an input/textarea
      const t = e.target;
      const tag = (t?.tagName || '').toLowerCase();
      const isTypingField = tag === 'input' || tag === 'textarea' || tag === 'select' || t?.isContentEditable;
      if (isTypingField) return;

      // Heuristic: scanners type fast. If there's a long gap, start a new buffer.
      const now = Date.now();
      if (now - lastKeyAtRef.current > 120) {
        scanBufferRef.current = '';
        setScanDraft('');
      }
      lastKeyAtRef.current = now;

      // Many scanners send Enter at the end of the scan
      if (e.key === 'Enter') {
        const raw = scanBufferRef.current;
        scanBufferRef.current = '';
        setScanDraft('');
        if (raw && raw.trim()) {
          submitScan(raw);
        }
        return;
      }

      // Ignore modifier keys
      if (['Shift', 'Alt', 'Control', 'Meta', 'CapsLock'].includes(e.key)) {
        return;
      }

      // Capture printable alphanumeric characters
      if (e.key && e.key.length === 1 && /[0-9A-Za-z]/.test(e.key)) {
        scanBufferRef.current += e.key;
        setScanDraft(scanBufferRef.current);
      }
    };

    window.addEventListener('keydown', onGlobalKeyDown, true);
    return () => window.removeEventListener('keydown', onGlobalKeyDown, true);
  }, [submitScan]);

  // Handler for hidden input keydown
  const onScanKeyDown = async (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      const raw = scanBufferRef.current;
      scanBufferRef.current = '';
      setScanDraft('');
      await submitScan(raw);
      return;
    }

    if (['Shift', 'Alt', 'Control', 'Meta', 'CapsLock'].includes(e.key)) return;

    if (e.key === 'Backspace') {
      scanBufferRef.current = scanBufferRef.current.slice(0, -1);
      setScanDraft(scanBufferRef.current);
      return;
    }

    if (e.key && e.key.length === 1 && /[0-9A-Za-z]/.test(e.key)) {
      scanBufferRef.current += e.key;
      setScanDraft(scanBufferRef.current);
    }
  };

  const formatTime = (iso) => {
    if (!iso) return '';
    try {
      const d = new Date(iso);
      return d.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });
    } catch {
      return iso;
    }
  };

  const backgroundUrl = `${process.env.PUBLIC_URL || ''}/images/background.png`;
  const imageSrc = (path) => path;

  return (
    <div 
      className="class-view-page" 
      style={{ backgroundImage: `url(${backgroundUrl})` }}
      onMouseDown={() => {
        // Clicking anywhere should re-focus the hidden scan input
        if (scanInputRef.current) scanInputRef.current.focus();
      }}
    >
      {/* Hidden always-focused input for keyboard-wedge RFID scanners */}
      <input
        ref={scanInputRef}
        value=""
        onChange={() => {}}
        onKeyDown={onScanKeyDown}
        autoFocus
        inputMode="numeric"
        aria-label="Hidden RFID scan input"
        style={{
          position: 'absolute',
          opacity: 0,
          pointerEvents: 'none',
          height: 0,
          width: 0,
          left: -9999,
          top: -9999
        }}
      />

      <div className="class-view-logo-header class-view-logo-left">
        <img src="/images/log.png" alt="School Logo" className="page-logo" />
      </div>
      <div className="class-view-logo-header">
        <img src="/images/logo.png" alt="School Logo" className="page-logo" />
      </div>

      <header className="class-view-header">
        <h1>{classLabel}</h1>
        <div className="ws-status">
          {connected ? '✅ System Ready' : '⏳ Connecting...'}
          {scanDraft && <span style={{ marginLeft: '10px', opacity: 0.8 }}>(Scanning: {scanDraft})</span>}
        </div>
        {attendanceSummary.total > 0 && (
          <div className="class-attendance-bar">
            <span className="att-badge att-in">{attendanceSummary.in} IN</span>
            <span className="att-badge att-out">{attendanceSummary.out} OUT</span>
            <span className="att-badge att-total">{attendanceSummary.total} Tagged</span>
          </div>
        )}
      </header>

      <main className="class-view-main">
        <div className="class-view-scan-box">
          {currentScan ? (
            <>
              <div className="class-view-side class-view-adult-side">
                <div className="class-view-role-label">Guardian</div>
                <div className="class-view-avatar class-view-adult">
                  {adultImgOk && currentScan.adult_image ? (
                    <img src={imageSrc(currentScan.adult_image)} alt="Guardian" onError={() => setAdultImgOk(false)} />
                  ) : (
                    <div className="class-view-avatar-placeholder">👤</div>
                  )}
                </div>
                <div className="class-view-side-name">{currentScan.adult_name || 'Guardian'}</div>
              </div>
              <div className="class-view-center">
                <div className="class-view-name">{currentScan.student_name}</div>
                <div className="class-view-time">🕐 {formatTime(currentScan.timestamp)}</div>
                {(() => {
                  const rec = attendanceRecords.find(
                    (a) => a.card_id === currentScan.card_id && a.status === 'out' && a.last_changed_at
                  );
                  return rec ? (
                    <div className="class-view-time class-view-gate-out-time">
                      🚪 Gate out time · {formatTime(rec.last_changed_at)}
                    </div>
                  ) : null;
                })()}
                <div className="class-view-auto-clear-hint">Display clears automatically after 5 minutes</div>
              </div>
              <div className="class-view-side class-view-child-side">
                <div className="class-view-role-label">Student</div>
                <div className="class-view-avatar class-view-child">
                  {childImgOk && currentScan.child_image ? (
                    <img src={imageSrc(currentScan.child_image)} alt="Student" onError={() => setChildImgOk(false)} />
                  ) : (
                    <div className="class-view-avatar-placeholder">🎒</div>
                  )}
                </div>
                <div className="class-view-side-name">{currentScan.student_name}</div>
              </div>
            </>
          ) : (
            <div className="class-view-waiting">
              <div className="class-view-waiting-icon">📡</div>
              <span className="class-view-waiting-text">Ready for Student Pickup</span>
              <span className="class-view-waiting-hint">Scan a card to display pickup information</span>
            </div>
          )}
        </div>
      </main>

      <nav className="class-view-nav-bottom">
        <Link to="/class-selection" className="nav-link">← Class Selection</Link>
        <Link to="/" className="nav-link">🏠 Home</Link>
      </nav>

      {!connected && (
        <div className="class-view-ws-warning">Connecting to server…</div>
      )}
    </div>
  );
}

export default ClassView;
