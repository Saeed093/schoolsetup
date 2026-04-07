import React, { useEffect } from 'react';
import './Toast.css';

function Toast({ message, type = 'info', onClose, duration = 3000 }) {
  useEffect(() => {
    if (duration > 0) {
      const timer = setTimeout(() => {
        onClose();
      }, duration);
      return () => clearTimeout(timer);
    }
  }, [duration, onClose]);

  return (
    <div className={`toast toast-${type}`}>
      <div className="toast-content">
        {type === 'success' && '✅ '}
        {type === 'error' && '❌ '}
        {type === 'warning' && '⚠️ '}
        {type === 'info' && 'ℹ️ '}
        {message}
      </div>
      <button className="toast-close" onClick={onClose}>×</button>
    </div>
  );
}

export default Toast;
