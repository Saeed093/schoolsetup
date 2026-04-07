import React, { useState, useEffect, useRef } from 'react';
import { Link } from 'react-router-dom';
import './TimeToGoHome.css';
import { getWebSocketUrl } from '../utils/connection';

// Flip digit component for the clock
function FlipDigit({ digit, prevDigit }) {
  const [isFlipping, setIsFlipping] = useState(false);
  
  useEffect(() => {
    if (digit !== prevDigit) {
      setIsFlipping(true);
      const timer = setTimeout(() => setIsFlipping(false), 600);
      return () => clearTimeout(timer);
    }
  }, [digit, prevDigit]);

  return (
    <div className={`flip-digit ${isFlipping ? 'flipping' : ''}`}>
      <div className="flip-digit-inner">
        <div className="flip-digit-front">
          <span>{prevDigit}</span>
        </div>
        <div className="flip-digit-back">
          <span>{digit}</span>
        </div>
      </div>
      <div className="flip-digit-static">
        <span>{digit}</span>
      </div>
    </div>
  );
}

// Flip clock component
function FlipClock({ time }) {
  const [prevTime, setPrevTime] = useState(time);
  
  useEffect(() => {
    const timer = setTimeout(() => setPrevTime(time), 50);
    return () => clearTimeout(timer);
  }, [time]);

  const hours = time.toLocaleTimeString('en-US', { hour: '2-digit', hour12: true }).slice(0, 2);
  const minutes = time.toLocaleTimeString('en-US', { minute: '2-digit' }).padStart(2, '0');
  const seconds = time.toLocaleTimeString('en-US', { second: '2-digit' }).padStart(2, '0');
  const ampm = time.getHours() >= 12 ? 'PM' : 'AM';
  
  const prevHours = prevTime.toLocaleTimeString('en-US', { hour: '2-digit', hour12: true }).slice(0, 2);
  const prevMinutes = prevTime.toLocaleTimeString('en-US', { minute: '2-digit' }).padStart(2, '0');
  const prevSeconds = prevTime.toLocaleTimeString('en-US', { second: '2-digit' }).padStart(2, '0');

  // Get individual digits
  const h1 = hours[0], h2 = hours[1];
  const m1 = minutes[0], m2 = minutes[1];
  const s1 = seconds[0], s2 = seconds[1];
  
  const ph1 = prevHours[0], ph2 = prevHours[1];
  const pm1 = prevMinutes[0], pm2 = prevMinutes[1];
  const ps1 = prevSeconds[0], ps2 = prevSeconds[1];

  return (
    <div className="flip-clock">
      <div className="flip-clock-group">
        <FlipDigit digit={h1} prevDigit={ph1} />
        <FlipDigit digit={h2} prevDigit={ph2} />
      </div>
      <div className="flip-clock-separator">:</div>
      <div className="flip-clock-group">
        <FlipDigit digit={m1} prevDigit={pm1} />
        <FlipDigit digit={m2} prevDigit={pm2} />
      </div>
      <div className="flip-clock-separator">:</div>
      <div className="flip-clock-group">
        <FlipDigit digit={s1} prevDigit={ps1} />
        <FlipDigit digit={s2} prevDigit={ps2} />
      </div>
      <div className="flip-clock-ampm">{ampm}</div>
    </div>
  );
}

function TimeToGoHome() {
  const [currentTime, setCurrentTime] = useState(new Date());
  const [lastScan, setLastScan] = useState(null);
  const [scanHistory, setScanHistory] = useState([
    // 3 columns with 5 rows each - initialized with null
    [null, null, null, null, null], // Column 1
    [null, null, null, null, null], // Column 2
    [null, null, null, null, null]  // Column 3
  ]);
  const timeoutRefs = useRef(new Map()); // Track timeouts for auto-removal
  const processingRef = useRef(false); // Prevent concurrent processing
  const wsDebounceRef = useRef(new Map()); // WebSocket message debounce
  const processedScansRef = useRef(new Set()); // Track which scans have been added to history
  
  // Hidden input for keyboard-wedge RFID scanners
  const scanInputRef = useRef(null);
  const scanBufferRef = useRef('');
  const lastKeyAtRef = useRef(0);

  // Update time every second
  useEffect(() => {
    const timer = setInterval(() => {
      setCurrentTime(new Date());
    }, 1000);

    return () => clearInterval(timer);
  }, []);

  // Handle scan history updates - 3 columns with shifting pattern
  useEffect(() => {
    if (!lastScan || !lastScan.found || processingRef.current) {
      return; // Skip if no scan, not found, or already processing
    }
    
    // Create unique key for this scan
    const scanKey = `${lastScan.card_id}-${lastScan.timestamp}`;
    
    // Check if this exact scan was already processed
    if (processedScansRef.current.has(scanKey)) {
      console.log('Scan already processed:', scanKey);
      return;
    }
    
    // Mark as processed
    processedScansRef.current.add(scanKey);
    processingRef.current = true;
    
    // Clean up old entries (keep only last 50)
    if (processedScansRef.current.size > 50) {
      const entries = Array.from(processedScansRef.current);
      entries.slice(0, entries.length - 50).forEach(e => processedScansRef.current.delete(e));
    }
    
    // Add scan directly to columns - ONE box per card, updates color on rescan
    setScanHistory((prev) => {
        // Find if this card already exists and get its current duplicate count
        let existingItem = null;
        prev.forEach(col => {
          col.forEach(item => {
            if (item && item.card_id === lastScan.card_id) {
              existingItem = item;
            }
          });
        });
        
        // Calculate new duplicate count (1 = first/green, 2 = second/yellow, 3+ = third/red)
        const newDuplicateCount = existingItem ? (existingItem.duplicateCount || 1) + 1 : 1;
        
        // Flatten all items, remove the existing entry for this card, then rebuild
        const allItems = [];
        prev.forEach(col => {
          col.forEach(item => {
            // Skip the existing entry for this card (we'll add updated version at top)
            if (item && item.card_id !== lastScan.card_id) {
              allItems.push(item);
            }
          });
        });
        
        // Add the new/updated scan at the beginning
        const updatedScan = { ...lastScan, duplicateCount: newDuplicateCount, timestamp: new Date().toISOString() };
        allItems.unshift(updatedScan);
        
        // Keep only first 15 items (3 columns x 5 rows)
        const trimmedItems = allItems.slice(0, 15);
        
        // Create new history array from flattened items
        const newHistory = [
          [null, null, null, null, null],
          [null, null, null, null, null],
          [null, null, null, null, null]
        ];
        
        // Fill columns: items flow down column 1, then column 2, then column 3
        trimmedItems.forEach((item, index) => {
          const col = Math.floor(index / 5);
          const row = index % 5;
          if (col < 3) {
            newHistory[col][row] = item;
          }
        });
        
        // Schedule removal after 5 minutes for this card
        if (lastScan.card_id) {
          // Clear existing timeout for this card
          const existing = timeoutRefs.current.get(lastScan.card_id);
          if (existing) clearTimeout(existing);
          
          const timeout = setTimeout(() => {
            setScanHistory(currentHistory => {
              // Remove this card from history
              const updated = currentHistory.map(col => 
                col.map(item => {
                  if (item && item.card_id === lastScan.card_id) {
                    return null;
                  }
                  return item;
                })
              );
              return updated;
            });
            timeoutRefs.current.delete(lastScan.card_id);
          }, 5 * 60 * 1000); // 5 minutes
          
          timeoutRefs.current.set(lastScan.card_id, timeout);
        }
        
        processingRef.current = false;
        return newHistory;
      });
    
  }, [lastScan]);
  
  // Cleanup timeouts on unmount
  useEffect(() => {
    return () => {
      timeoutRefs.current.forEach(timeout => clearTimeout(timeout));
      timeoutRefs.current.clear();
    };
  }, []);

  // Connect to WebSocket for RFID scan updates
  useEffect(() => {
    let ws = null;
    let reconnectTimeout = null;

    const connectWebSocket = () => {
      try {
        if (ws && ws.readyState === WebSocket.OPEN) {
          ws.close();
        }
        // Connect to backend WebSocket (configurable for other-laptop setups)
        const wsUrl = getWebSocketUrl('/');
        ws = new WebSocket(wsUrl);
        
        ws.onopen = () => {
          console.log('WebSocket connected for TimeToGoHome');
          if (reconnectTimeout) {
            clearTimeout(reconnectTimeout);
            reconnectTimeout = null;
          }
        };

        ws.onmessage = (event) => {
          try {
            const data = JSON.parse(event.data);
            if (data.type === 'card_scan') {
              // Debounce: Ignore if same card_id received within 1 second
              const now = Date.now();
              const cardId = data.card_id;
              const lastReceived = wsDebounceRef.current.get(cardId);
              
              if (lastReceived && (now - lastReceived) < 1000) {
                console.log('Duplicate WebSocket message ignored:', cardId);
                return;
              }
              
              wsDebounceRef.current.set(cardId, now);
              console.log('Card scan received:', data);
              setLastScan(data);
            }
          } catch (error) {
            console.error('Error parsing WebSocket message:', error);
          }
        };

        ws.onerror = (error) => {
          console.error('WebSocket error:', error);
        };

        ws.onclose = () => {
          console.log('WebSocket disconnected, reconnecting...');
          reconnectTimeout = setTimeout(connectWebSocket, 3000);
        };
      } catch (error) {
        console.error('Error connecting WebSocket:', error);
        reconnectTimeout = setTimeout(connectWebSocket, 3000);
      }
    };

    connectWebSocket();

    return () => {
      if (reconnectTimeout) {
        clearTimeout(reconnectTimeout);
      }
      if (ws) {
        ws.close();
      }
    };
  }, []);

  // Handle keyboard-wedge scanner input (like ScanView)
  const onScanKeyDown = async (e) => {
    const now = Date.now();
    if (e.key === 'Enter' || e.key === 'Return') {
      e.preventDefault();
      const cardId = scanBufferRef.current.trim();
      if (cardId && cardId.length > 0) {
        console.log('Manual scan from keyboard:', cardId);
        try {
          const response = await fetch(`/api/rfid/scan`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ card_id: cardId }),
          });
          const result = await response.json();
          setLastScan({ type: 'card_scan', ...result });
        } catch (error) {
          console.error('Error testing scan:', error);
        }
      }
      scanBufferRef.current = '';
      return;
    }

    if (e.key && e.key.length === 1 && /[0-9A-Za-z]/.test(e.key)) {
      scanBufferRef.current += e.key;
      lastKeyAtRef.current = now;
    }
  };

  // Global keyboard handler for scanners
  useEffect(() => {
    const onGlobalKeyDown = (e) => {
      if (document.activeElement?.tagName === 'INPUT' || 
          document.activeElement?.tagName === 'TEXTAREA' ||
          document.activeElement?.isContentEditable) {
        return;
      }
      if (e.key && e.key.length === 1) {
        const ch = e.key;
        if (/[0-9A-Za-z]/.test(ch)) {
          scanBufferRef.current += ch;
        }
      }
    };

    window.addEventListener('keydown', onGlobalKeyDown, true);
    return () => window.removeEventListener('keydown', onGlobalKeyDown, true);
  }, []);

  const formatTime = (date) => {
    return date.toLocaleTimeString('en-US', {
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      hour12: true
    });
  };

  const formatScanTime = (timestamp) => {
    const date = new Date(timestamp);
    return date.toLocaleTimeString('en-US', {
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      hour12: true
    });
  };

  return (
    <div 
      className="time-to-go-home"
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

      {/* Header with Time, Heading, and Logo inline */}
      <div className="time-to-go-home-header">
        <div className="time-display">
          <FlipClock time={currentTime} />
        </div>
        <h1 className="main-heading">Time to go home</h1>
        <div className="logo-container">
          <img 
            src="/images/logo.png" 
            alt="Beaconhouse School Logo" 
            className="school-logo"
          />
        </div>
      </div>

      {/* Main Content - Scan Display */}
      <div className="time-to-go-home-content">
        {/* Recent Scans Section - 3 Columns */}
        <div className="scan-history">
          <h3>Recent Scans</h3>
          <div className="history-columns">
            {scanHistory.map((column, colIndex) => (
              <div key={colIndex} className="history-column">
                {column.filter(scan => scan !== null && scan !== undefined).map((scan, rowIndex) => (
                  <div key={`${scan.card_id}-${scan.timestamp}-${rowIndex}`} className={`history-item ${scan.found ? 'found' : 'not-found'} ${scan.duplicateCount === 2 ? 'duplicate-warning' : ''} ${scan.duplicateCount >= 3 ? 'duplicate-alert' : ''}`}>
                    <div className="history-name">
                      <span>{scan.student_name ?? scan.name}</span>
                      {!!(scan.student_class ?? '') && <span className="history-class">{scan.student_class}</span>}
                    </div>
                    <div className="history-details">
                      <span className="history-id">{scan.card_id}</span>
                      <span className="history-time">{formatScanTime(scan.timestamp)}</span>
                    </div>
                  </div>
                ))}
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* Home Button - Bottom Right */}
      <Link to="/" className="home-button">
        🏠 Home
      </Link>
    </div>
  );
}

export default TimeToGoHome;
