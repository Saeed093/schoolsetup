import React from 'react';
import './FaceNoMatchBanner.css';

/**
 * Shown when guardian face check fails at checkout (Capture Station + Principal views).
 * @param {object|null} alert - { student_name, student_class, card_id, confidence, best_label }
 * @param {function} onDismiss
 */
function FaceNoMatchBanner({ alert, onDismiss }) {
  if (!alert) return null;

  const namePart = (alert.student_name || '').trim();
  const classPart = (alert.student_class || '').trim();
  const subLine = [namePart || null, classPart ? `Class: ${classPart}` : null]
    .filter(Boolean)
    .join(' · ');

  return (
    <div className="face-no-match-banner" role="alert">
      <div className="face-no-match-banner-content">
        <span className="face-no-match-banner-icon" aria-hidden>
          ⚠️
        </span>
        <div className="face-no-match-banner-text">
          <strong className="face-no-match-banner-title">No match — please check</strong>
          {subLine && <div className="face-no-match-banner-sub">{subLine}</div>}
          {(alert.best_label || '').trim() !== '' && (
            <div className="face-no-match-banner-sub">
              Closest registered: {alert.best_label}
              {typeof alert.confidence === 'number' ? ` (${alert.confidence}% confidence)` : ''}
            </div>
          )}
        </div>
        {typeof onDismiss === 'function' && (
          <button
            type="button"
            className="face-no-match-banner-dismiss"
            onClick={onDismiss}
          >
            Dismiss
          </button>
        )}
      </div>
    </div>
  );
}

export default FaceNoMatchBanner;
