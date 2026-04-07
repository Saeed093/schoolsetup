import React from 'react';
import './ReaderStatus.css';

function ReaderStatus({ status, onRefresh }) {
  return (
    <div className="reader-status">
      <div className={`status-indicator ${status.connected ? 'connected' : 'disconnected'}`}>
        <span className="status-dot"></span>
        <span className="status-text">
          {status.connected ? 'RFID Reader Connected' : 'RFID Reader Disconnected'}
        </span>
      </div>
      {status.connected && (
        <div className={`status-indicator ${status.active ? 'active' : 'inactive'}`}>
          <span className="status-dot"></span>
          <span className="status-text">
            {status.active ? 'Active' : 'Inactive'}
          </span>
        </div>
      )}
      {status.port && (
        <div className="status-port">Port: {status.port}</div>
      )}
      <button onClick={onRefresh} className="refresh-btn" title="Refresh status">
        🔄
      </button>
    </div>
  );
}

export default ReaderStatus;
