import React, { useState, useEffect, useRef } from 'react';
import { Link } from 'react-router-dom';
import ScanDisplay from '../components/ScanDisplay';
import ReaderStatus from '../components/ReaderStatus';
import Toast from '../components/Toast';
import './ScanView.css';
import { getWebSocketUrl } from '../utils/connection';

function ScanView() {
  const [lastScan, setLastScan] = useState(null);
  const [readerStatus, setReaderStatus] = useState({ connected: false, active: true });
  const [wsConnected, setWsConnected] = useState(false);
  const [arduinoConnected, setArduinoConnected] = useState(false);
  const [arduinoCount, setArduinoCount] = useState(0);
  const [toast, setToast] = useState(null);
  const [manualEntryOpen, setManualEntryOpen] = useState(false);
  const [manualCardId, setManualCardId] = useState('');
  const [scanDraft, setScanDraft] = useState('');
  
  // Search state
  const [searchOpen, setSearchOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [allCards, setAllCards] = useState([]);
  const [searchResults, setSearchResults] = useState([]);
  const [callingStudent, setCallingStudent] = useState(null);

  // Keyboard-wedge (HID) scanners type into the focused element.
  // Keep a hidden input focused so the Scan View is always ready.
  const scanInputRef = useRef(null);
  const scanBufferRef = useRef('');
  const lastKeyAtRef = useRef(0);

  useEffect(() => {
    // Fetch reader status on mount
    fetchReaderStatus();
    
    let ws = null;
    let reconnectTimeout = null;
    let isMounted = true;

    const connectWebSocket = () => {
      try {
        // Close existing connection if any
        if (ws && ws.readyState === WebSocket.OPEN) {
          ws.close();
        }
        // Connect to backend WebSocket (configurable for other-laptop setups)
        const wsUrl = getWebSocketUrl('/');
        ws = new WebSocket(wsUrl);
        
        ws.onopen = () => {
          console.log('WebSocket connected');
          setWsConnected(true);
          if (reconnectTimeout) {
            clearTimeout(reconnectTimeout);
            reconnectTimeout = null;
          }
        };

        ws.onmessage = (event) => {
          try {
            const data = JSON.parse(event.data);
            console.log('WebSocket message received:', data);
            
            if (data.type === 'connection') {
              console.log('Connection confirmed:', data.message);
            } else if (data.type === 'arduino_status') {
              console.log('Arduino status:', data);
              const connected = !!data.connected;
              setArduinoConnected(connected);
              setArduinoCount(Number.isFinite(data.count) ? data.count : 0);
            } else if (data.type === 'card_scan') {
              console.log('Card scan received:', data);
              console.log('Updating lastScan state with:', data);
              setLastScan(data);
              console.log('State updated - scan should appear now');
              
              // Show non-intrusive toast notification
              const studentName = data.student_name ?? data.name;
              const toastMessage = data.found 
                ? `Card scanned: ${studentName}${data.student_class ? ` (${data.student_class})` : ''}` 
                : `Unknown card: ${data.card_id}`;
              setToast({
                message: toastMessage,
                type: data.found ? 'success' : 'warning'
              });
              
              // Play a subtle sound notification (optional)
              playScanSound(data.found);
            } else if (data.type === 'arduino_connected') {
              console.log('Arduino connected:', data);
              setArduinoConnected(true);
              setArduinoCount(Number.isFinite(data.count) ? data.count : 1);
            } else if (data.type === 'arduino_disconnected') {
              console.log('Arduino disconnected:', data);
              const count = Number.isFinite(data.count) ? data.count : 0;
              setArduinoCount(count);
              setArduinoConnected(count > 0);
            } else {
              console.log('Unknown message type:', data.type);
            }
          } catch (error) {
            console.error('Error parsing WebSocket message:', error, event.data);
          }
        };

        ws.onerror = (error) => {
          console.error('WebSocket error:', error);
          setWsConnected(false);
        };

        ws.onclose = (event) => {
          console.log('WebSocket disconnected', event.code, event.reason);
          setWsConnected(false);
          
          // Only reconnect if component is still mounted and it wasn't a clean close
          if (isMounted && event.code !== 1000) {
            console.log('Attempting to reconnect WebSocket in 3 seconds...');
            reconnectTimeout = setTimeout(() => {
              if (isMounted) {
                connectWebSocket();
              }
            }, 3000);
          }
        };
      } catch (error) {
        console.error('Error creating WebSocket:', error);
        setWsConnected(false);
        // Retry connection after delay
        if (isMounted) {
          reconnectTimeout = setTimeout(() => {
            if (isMounted) {
              connectWebSocket();
            }
          }, 3000);
        }
      }
    };

    // Initial connection
    connectWebSocket();

    // Cleanup function
    return () => {
      isMounted = false;
      if (reconnectTimeout) {
        clearTimeout(reconnectTimeout);
      }
      if (ws) {
        ws.close(1000, 'Component unmounting');
      }
    };
  }, []);

  useEffect(() => {
    // Keep the hidden scan input focused so keyboard-wedge scanners work without popups.
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

  useEffect(() => {
    // Firefox F11 fullscreen can disrupt focused element. Capture scanner input at window level too.
    // This lets scans work even if the hidden input loses focus.
    const onGlobalKeyDown = (e) => {
      // Don't intercept when user is typing in an input/textarea/select or contentEditable.
      const t = e.target;
      const tag = (t?.tagName || '').toLowerCase();
      const isTypingField =
        tag === 'input' ||
        tag === 'textarea' ||
        tag === 'select' ||
        t?.isContentEditable;

      // If the manual entry panel is open, allow typing there normally.
      if (isTypingField) return;

      // Heuristic: scanners type fast. If there's a long gap, start a new buffer.
      const now = Date.now();
      if (now - lastKeyAtRef.current > 120) {
        scanBufferRef.current = '';
        setScanDraft('');
      }
      lastKeyAtRef.current = now;

      // Many scanners send Enter at the end of the scan.
      if (e.key === 'Enter') {
        const raw = scanBufferRef.current;
        scanBufferRef.current = '';
        setScanDraft('');
        if (raw && raw.trim()) {
          submitKeyboardWedgeScan(raw);
        }
        return;
      }

      // Ignore modifier keys
      if (
        e.key === 'Shift' ||
        e.key === 'Alt' ||
        e.key === 'Control' ||
        e.key === 'Meta' ||
        e.key === 'CapsLock'
      ) {
        return;
      }

      // Capture printable alphanumeric characters
      if (e.key && e.key.length === 1) {
        const ch = e.key;
        if (/[0-9A-Za-z]/.test(ch)) {
          scanBufferRef.current += ch;
          setScanDraft(scanBufferRef.current);
        }
      }
    };

    window.addEventListener('keydown', onGlobalKeyDown, true);
    return () => window.removeEventListener('keydown', onGlobalKeyDown, true);
  }, []);

  const fetchReaderStatus = async () => {
    try {
      const response = await fetch(`/api/rfid/status`);
      const status = await response.json();
      setReaderStatus(status);
    } catch (error) {
      console.error('Error fetching reader status:', error);
    }
  };

  // Fetch cards with alarm enabled for search
  const fetchAllCards = async () => {
    try {
      const response = await fetch(`/api/cards`);
      const cards = await response.json();
      // Only show students with alarm/buzzer enabled
      const cardsWithAlarm = cards.filter(card => card.alarm_enabled === 1);
      setAllCards(cardsWithAlarm);
      setSearchResults(cardsWithAlarm);
    } catch (error) {
      console.error('Error fetching cards:', error);
      setToast({ message: 'Error loading students', type: 'error' });
    }
  };

  // Filter cards based on search query
  useEffect(() => {
    if (!searchQuery.trim()) {
      setSearchResults(allCards);
    } else {
      const query = searchQuery.toLowerCase();
      const filtered = allCards.filter(card => 
        (card.student_name || '').toLowerCase().includes(query) ||
        (card.student_class || '').toLowerCase().includes(query) ||
        (card.card_id || '').toLowerCase().includes(query)
      );
      setSearchResults(filtered);
    }
  }, [searchQuery, allCards]);

  // Call student - trigger alarm on ESP32
  const callStudent = async (student) => {
    setCallingStudent(student.id);
    try {
      const response = await fetch(`/api/rfid/test-alarm`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' }
      });
      const result = await response.json();
      
      if (result.success) {
        setToast({ 
          message: `📢 Calling ${student.student_name}${student.student_class ? ` (${student.student_class})` : ''}!`, 
          type: 'success' 
        });
        // Also show in the scan display
        setLastScan({
          type: 'card_scan',
          card_id: student.card_id,
          student_name: student.student_name,
          student_class: student.student_class,
          found: true,
          timestamp: new Date().toISOString(),
          called: true // Mark as manually called
        });
      } else {
        setToast({ message: 'Failed to trigger alarm', type: 'error' });
      }
    } catch (error) {
      console.error('Error calling student:', error);
      setToast({ message: 'Error triggering alarm', type: 'error' });
    } finally {
      setTimeout(() => setCallingStudent(null), 1000);
    }
  };

  const testScan = async (cardId) => {
    try {
      const response = await fetch(`/api/rfid/scan`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ card_id: cardId }),
      });
      const result = await response.json();
      console.log('Test scan result:', result);

      // IMPORTANT: /api/rfid/scan also broadcasts via WebSocket.
      // If we setLastScan() here as well, the UI will log duplicates.
      // Only fallback to local update if WS is disconnected.
      if (!wsConnected) {
        setLastScan({ type: 'card_scan', ...result });

        const studentName = result.student_name ?? result.name;
        const toastMessage = result.found
          ? `Card scanned: ${studentName}${result.student_class ? ` (${result.student_class})` : ''}`
          : `Unknown card: ${result.card_id}`;
        setToast({
          message: toastMessage,
          type: result.found ? 'success' : 'warning'
        });
      }
    } catch (error) {
      console.error('Error testing scan:', error);
      setToast({
        message: 'Error testing scan',
        type: 'error'
      });
    }
  };

  const submitKeyboardWedgeScan = async (rawId) => {
    const cleaned = String(rawId || '').trim();
    if (!cleaned) return;
    await testScan(cleaned);
  };

  const onScanKeyDown = async (e) => {
    // Many scanners send an Enter suffix to finish the scan.
    if (e.key === 'Enter') {
      e.preventDefault();
      const raw = scanBufferRef.current;
      scanBufferRef.current = '';
      setScanDraft('');
      await submitKeyboardWedgeScan(raw);
      return;
    }

    // Ignore modifier keys
    if (e.key === 'Shift' || e.key === 'Alt' || e.key === 'Control' || e.key === 'Meta' || e.key === 'CapsLock') {
      return;
    }

    // Backspace support (rarely used by scanners, but helps during manual typing)
    if (e.key === 'Backspace') {
      scanBufferRef.current = scanBufferRef.current.slice(0, -1);
      setScanDraft(scanBufferRef.current);
      return;
    }

    // Capture printable characters
    if (e.key && e.key.length === 1) {
      const ch = e.key;
      if (/[0-9A-Za-z]/.test(ch)) {
        scanBufferRef.current += ch;
        setScanDraft(scanBufferRef.current);
      }
    }
  };

  // Play a subtle beep sound when card is scanned
  const playScanSound = (found = false) => {
    try {
      // Create a simple beep using Web Audio API
      const audioContext = new (window.AudioContext || window.webkitAudioContext)();
      const oscillator = audioContext.createOscillator();
      const gainNode = audioContext.createGain();
      
      oscillator.connect(gainNode);
      gainNode.connect(audioContext.destination);
      
      oscillator.frequency.value = found ? 800 : 600; // Higher pitch for found cards
      oscillator.type = 'sine';
      
      gainNode.gain.setValueAtTime(0.1, audioContext.currentTime);
      gainNode.gain.exponentialRampToValueAtTime(0.01, audioContext.currentTime + 0.1);
      
      oscillator.start(audioContext.currentTime);
      oscillator.stop(audioContext.currentTime + 0.1);
    } catch (error) {
      // Silently fail if audio is not available
      console.log('Audio notification not available');
    }
  };

  return (
    <div
      className="scan-view"
      onMouseDown={() => {
        // Clicking anywhere on the page should re-focus the hidden scan input.
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

      <div className="logo-header logo-header-left">
        <img src="/images/log.png" alt="School Logo" className="page-logo" />
      </div>
      <div className="logo-header">
        <img 
          src="/images/logo.png" 
          alt="Beaconhouse School Logo" 
          className="page-logo"
        />
      </div>
      <header className="scan-view-header">
        <div className="header-content">
          <h1>📡 Scan Display</h1>
          <ReaderStatus status={readerStatus} onRefresh={fetchReaderStatus} />
          <div style={{ marginTop: '10px', display: 'flex', gap: '10px', alignItems: 'center', flexWrap: 'wrap' }}>
            {wsConnected ? (
              <div style={{ 
                color: '#4caf50', 
                fontSize: '0.9rem', 
                padding: '8px 12px',
                background: 'rgba(76, 175, 80, 0.1)',
                borderRadius: '8px',
                display: 'inline-block'
              }}>
                ✅ WebSocket Connected
              </div>
            ) : (
              <div style={{ 
                color: '#ff9800', 
                fontSize: '0.9rem', 
                padding: '8px 12px',
                background: 'rgba(255, 152, 0, 0.1)',
                borderRadius: '8px',
                display: 'inline-block'
              }}>
                ⚠️ Reconnecting to server...
              </div>
            )}
            {readerStatus.connected && (
              <div style={{ 
                color: '#4caf50', 
                fontSize: '0.9rem', 
                padding: '8px 12px',
                background: 'rgba(76, 175, 80, 0.1)',
                borderRadius: '8px',
                display: 'inline-block'
              }}>
                ✅ Reader Connected ({readerStatus.port})
              </div>
            )}
            {arduinoConnected && (
              <div style={{ 
                color: '#4caf50',
                fontSize: '0.9rem', 
                padding: '8px 12px',
                background: 'rgba(76, 175, 80, 0.1)',
                borderRadius: '8px',
                display: 'inline-block'
              }}>
                ✅ Arduino Connected{` (${arduinoCount})`}
              </div>
            )}
            <div style={{ 
              color: 'white',
              fontSize: '0.9rem', 
              padding: '8px 12px',
              background: 'rgba(255, 255, 255, 0.12)',
              borderRadius: '8px',
              display: 'inline-block'
            }}>
              Ready to scan {scanDraft ? `(capturing: ${scanDraft})` : ''}
            </div>
          </div>
        </div>
        <div style={{ display: 'flex', gap: '10px', alignItems: 'center', marginRight: '80px' }}>
          <button 
            onClick={() => {
              setSearchOpen((v) => {
                if (!v) fetchAllCards(); // Fetch cards when opening
                return !v;
              });
              setManualEntryOpen(false);
            }}
            style={{
              padding: '8px 16px',
              background: searchOpen ? 'rgba(76, 175, 80, 0.4)' : 'rgba(76, 175, 80, 0.25)',
              border: '2px solid rgba(76, 175, 80, 0.5)',
              borderRadius: '8px',
              color: 'white',
              cursor: 'pointer',
              fontWeight: '600'
            }}
            title="Search for a student and call them"
          >
            🔍 Search & Call
          </button>
          <button 
            onClick={() => {
              setManualEntryOpen((v) => !v);
              setSearchOpen(false);
            }}
            style={{
              padding: '8px 16px',
              background: 'rgba(255, 255, 255, 0.2)',
              border: '2px solid rgba(255, 255, 255, 0.3)',
              borderRadius: '8px',
              color: 'white',
              cursor: 'pointer',
              fontWeight: '600'
            }}
            title="Manually enter a card ID (for testing)"
          >
            🧪 Manual Entry
          </button>
          <Link to="/" className="nav-link">🏠 Home</Link>
        </div>
      </header>

      {/* Search & Call Panel */}
      {searchOpen && (
        <div style={{
          margin: '0 auto 16px',
          maxWidth: '1200px',
          background: 'rgba(76, 175, 80, 0.15)',
          border: '1px solid rgba(76, 175, 80, 0.3)',
          borderRadius: '12px',
          padding: '16px',
          color: 'white'
        }}>
          <div style={{ display: 'flex', gap: '10px', alignItems: 'center', marginBottom: '12px' }}>
            <div style={{ fontWeight: 600, fontSize: '1.1rem' }}>🔍 Search Student:</div>
            <input
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Type student name, class, or card ID..."
              autoFocus
              style={{
                padding: '10px 14px',
                borderRadius: '10px',
                border: 'none',
                flex: 1,
                minWidth: '200px',
                fontSize: '1rem'
              }}
            />
            <button
              onClick={() => {
                setSearchQuery('');
                setSearchOpen(false);
                if (scanInputRef.current) scanInputRef.current.focus();
              }}
              style={{
                padding: '10px 14px',
                borderRadius: '10px',
                border: 'none',
                background: 'rgba(0,0,0,0.2)',
                color: 'white',
                cursor: 'pointer',
                fontWeight: 600
              }}
            >
              Close
            </button>
          </div>
          
          {/* Search Results */}
          <div style={{
            maxHeight: '300px',
            overflowY: 'auto',
            background: 'rgba(0,0,0,0.2)',
            borderRadius: '8px',
            padding: searchResults.length > 0 ? '8px' : '20px',
            textAlign: searchResults.length > 0 ? 'left' : 'center'
          }}>
            {searchResults.length === 0 ? (
              <div style={{ color: 'rgba(255,255,255,0.7)' }}>
                {allCards.length === 0 ? 'Loading students with buzzer enabled...' : 'No matching students found'}
              </div>
            ) : (
              searchResults.map(student => (
                <div
                  key={student.id}
                  style={{
                    display: 'flex',
                    justifyContent: 'space-between',
                    alignItems: 'center',
                    padding: '12px 16px',
                    background: 'rgba(255,255,255,0.1)',
                    borderRadius: '8px',
                    marginBottom: '8px',
                    transition: 'all 0.2s'
                  }}
                >
                  <div>
                    <div style={{ fontWeight: 600, fontSize: '1.1rem' }}>
                      {student.student_name}
                      {student.student_class && (
                        <span style={{ 
                          marginLeft: '10px', 
                          opacity: 0.8,
                          fontSize: '1rem',
                          fontWeight: 500
                        }}>
                          {student.student_class}
                        </span>
                      )}
                    </div>
                    <div style={{ fontSize: '0.85rem', opacity: 0.7, marginTop: '4px' }}>
                      Card: {student.card_id}
                    </div>
                  </div>
                  <button
                    onClick={() => callStudent(student)}
                    disabled={callingStudent === student.id}
                    style={{
                      padding: '10px 20px',
                      borderRadius: '8px',
                      border: 'none',
                      background: callingStudent === student.id 
                        ? 'rgba(255,152,0,0.8)' 
                        : 'linear-gradient(135deg, #f44336 0%, #d32f2f 100%)',
                      color: 'white',
                      cursor: callingStudent === student.id ? 'wait' : 'pointer',
                      fontWeight: 700,
                      fontSize: '1rem',
                      boxShadow: '0 2px 8px rgba(244, 67, 54, 0.4)',
                      transition: 'all 0.2s'
                    }}
                  >
                    {callingStudent === student.id ? '📢 Calling...' : '📢 CALL'}
                  </button>
                </div>
              ))
            )}
          </div>
          
          <div style={{ marginTop: '10px', fontSize: '0.85rem', opacity: 0.8 }}>
            💡 Only students with buzzer enabled are shown. Click "CALL" to trigger the alarm.
          </div>
        </div>
      )}

      {manualEntryOpen && (
        <div style={{
          margin: '0 auto 16px',
          maxWidth: '1200px',
          background: 'rgba(255,255,255,0.12)',
          border: '1px solid rgba(255,255,255,0.22)',
          borderRadius: '12px',
          padding: '12px',
          color: 'white',
          display: 'flex',
          gap: '10px',
          alignItems: 'center',
          flexWrap: 'wrap'
        }}>
          <div style={{ fontWeight: 600 }}>Manual scan:</div>
          <input
            value={manualCardId}
            onChange={(e) => setManualCardId(e.target.value)}
            placeholder="Type card ID and press Enter"
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault();
                if (manualCardId.trim()) testScan(manualCardId.trim());
              }
            }}
            style={{
              padding: '10px 12px',
              borderRadius: '10px',
              border: 'none',
              minWidth: '240px'
            }}
          />
          <button
            onClick={() => manualCardId.trim() && testScan(manualCardId.trim())}
            style={{
              padding: '10px 14px',
              borderRadius: '10px',
              border: 'none',
              background: 'rgba(255,255,255,0.25)',
              color: 'white',
              cursor: 'pointer',
              fontWeight: 600
            }}
          >
            Send
          </button>
          <button
            onClick={() => {
              setManualCardId('');
              setManualEntryOpen(false);
              if (scanInputRef.current) scanInputRef.current.focus();
            }}
            style={{
              padding: '10px 14px',
              borderRadius: '10px',
              border: 'none',
              background: 'rgba(0,0,0,0.18)',
              color: 'white',
              cursor: 'pointer',
              fontWeight: 600
            }}
          >
            Close
          </button>
          <div style={{ opacity: 0.9, fontSize: '0.9rem' }}>
            Tip: don't leave DevTools Console focused, or the scanner will type there instead.
          </div>
        </div>
      )}

      <main className="scan-view-main">
        <ScanDisplay lastScan={lastScan} readerStatus={readerStatus} />
      </main>
      
      {toast && (
        <Toast
          message={toast.message}
          type={toast.type}
          onClose={() => setToast(null)}
          duration={3000}
        />
      )}
    </div>
  );
}

export default ScanView;
