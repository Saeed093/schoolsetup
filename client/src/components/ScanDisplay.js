import React, { useEffect, useState } from 'react';
import './ScanDisplay.css';

function ScanDisplay({ lastScan, readerStatus }) {
  const [scanHistory, setScanHistory] = useState([]);

  useEffect(() => {
    console.log('ScanDisplay: lastScan changed:', lastScan);
    if (lastScan) {
      console.log('Adding scan to history:', lastScan);
      setScanHistory((prev) => {
        // De-dupe identical consecutive scans (same card_id + timestamp)
        const prevTop = prev[0];
        if (prevTop && prevTop.card_id === lastScan.card_id && prevTop.timestamp === lastScan.timestamp) {
          return prev;
        }
        return [lastScan, ...prev.slice(0, 9)]; // Keep last 10 scans
      });
    }
  }, [lastScan]);

  const formatTime = (timestamp) => {
    const date = new Date(timestamp);
    return date.toLocaleTimeString();
  };

  return (
    <div className="scan-display">
      {scanHistory.length > 0 ? (
        <div className="scan-history">
          <h3>Recent Scans</h3>
          <div className="history-list">
            {scanHistory.map((scan, index) => (
              <div key={index} className={`history-item ${scan.found ? 'found' : 'not-found'}`}>
                <div className="history-name">
                  <span>{scan.student_name ?? scan.name}</span>
                  {!!(scan.student_class ?? '') && <span className="history-class">{scan.student_class}</span>}
                </div>
                <div className="history-details">
                  <span className="history-id">{scan.card_id}</span>
                  <span className="history-time">{formatTime(scan.timestamp)}</span>
                </div>
              </div>
            ))}
          </div>
        </div>
      ) : (
        <div className="scan-result">
          <div className="scan-icon">📡</div>
          <div className="scan-message">
            {readerStatus && !readerStatus.connected ? 'RFID Reader Disconnected' : 'Ready to Scan'}
          </div>
          <div className="scan-hint">
            {readerStatus && !readerStatus.connected 
              ? 'Please connect your USB RFID reader to start scanning cards'
              : 'Scan a card or manually enter a card ID'}
          </div>
        </div>
      )}
    </div>
  );
}

export default ScanDisplay;
