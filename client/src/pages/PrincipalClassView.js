import React, { useState, useEffect, useCallback } from 'react';
import { Link, useParams } from 'react-router-dom';
import './ClassView.css';
import './PrincipalClassView.css';
import FaceNoMatchBanner from '../components/FaceNoMatchBanner';

const API_BASE = '';
const imageSrc = (path) => path;

// WebSocket URL for real-time updates
const getWsUrl = () => {
  const host = window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1'
    ? 'localhost'
    : window.location.hostname;
  return `ws://${host}:5000/`;
};

function PrincipalClassView() {
  const { classId } = useParams();
  const [pickups, setPickups] = useState([]);
  const [classLabel, setClassLabel] = useState(classId || '');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [detailPopup, setDetailPopup] = useState(null);
  const [faceNoMatchAlert, setFaceNoMatchAlert] = useState(null);
  const [classAttendance, setClassAttendance] = useState([]);

  const labelMap = {
    '1': 'Class 1',
    '2': 'Class 2',
    '3': 'Class 3',
    '4': 'Class 4',
    '5': 'Class 5',
    prenursery: 'Prenursery',
    nursery: 'Nursery'
  };

  const fetchPickups = useCallback((cid) => {
    if (!cid) return;
    fetch(`${API_BASE}/api/principal/class/${encodeURIComponent(cid)}/pickups`)
      .then((res) => res.json())
      .then((data) => setPickups(data.pickups || []))
      .catch((err) => setError(err.message || 'Failed to load pickups'));
  }, []);

  const fetchClassAttendance = useCallback((cid) => {
    if (!cid) return;
    fetch(`${API_BASE}/api/attendance/class/${encodeURIComponent(cid)}`)
      .then((res) => res.json())
      .then((data) => setClassAttendance(data.attendance || []))
      .catch(() => {});
  }, []);

  useEffect(() => {
    const cid = (classId || '').trim();
    setClassLabel(labelMap[cid] || cid);
    let cancelled = false;
    fetch(`${API_BASE}/api/principal/class/${encodeURIComponent(cid)}/pickups`)
      .then((res) => res.json())
      .then((data) => {
        if (cancelled) return;
        setPickups(data.pickups || []);
      })
      .catch((err) => {
        if (!cancelled) setError(err.message || 'Failed to load pickups');
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    fetchClassAttendance(cid);
    const interval = setInterval(() => fetchPickups(cid), 1500);
    const attInterval = setInterval(() => fetchClassAttendance(cid), 5000);
    return () => {
      cancelled = true;
      clearInterval(interval);
      clearInterval(attInterval);
    };
  }, [classId, fetchPickups, fetchClassAttendance]);

  // WebSocket for real-time updates across the network
  useEffect(() => {
    let ws = null;
    let reconnectTimeout = null;
    let isMounted = true;
    const cid = (classId || '').trim();

    const connectWs = () => {
      try {
        ws = new WebSocket(getWsUrl());

        ws.onmessage = (event) => {
          try {
            const data = JSON.parse(event.data);
            // When a scan or update happens, refresh the pickups list immediately
            if (data.type === 'card_scan' || data.type === 'checkin_update' || data.type === 'pickup_image_update') {
              console.log('[PrincipalClassView] Received event, refreshing pickups:', data.type);
              fetchPickups(cid);
            }
            if (
              data.type === 'attendance_change' ||
              data.type === 'attendance_reset' ||
              data.type === 'attendance_mass_update'
            ) {
              fetchClassAttendance(cid);
            }
            if (data.type === 'face_no_match') {
              setFaceNoMatchAlert({
                student_name: data.student_name,
                student_class: data.student_class,
                card_id: data.card_id,
                confidence: data.confidence,
                best_label: data.best_label
              });
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
        console.error('[PrincipalClassView] WebSocket error:', err);
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
  }, [classId, fetchPickups]);

  const formatTime = (iso) => {
    if (!iso) return '';
    try {
      const d = new Date(iso);
      return d.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });
    } catch {
      return iso;
    }
  };

  return (
    <div className="principal-class-page class-view-page">
      <div className="class-view-logo-header class-view-logo-left">
        <img src="/images/log.png" alt="School Logo" className="page-logo" />
      </div>
      <div className="class-view-logo-header">
        <img src="/images/logo.png" alt="School Logo" className="page-logo" />
      </div>

      <FaceNoMatchBanner
        alert={faceNoMatchAlert}
        onDismiss={() => setFaceNoMatchAlert(null)}
      />

      <header className="class-view-header">
        <h1>{classLabel} — Pickups</h1>
        <p className="principal-subtitle">Guardian and time for each student who went out</p>
        {classAttendance.length > 0 && (
          <div className="class-attendance-bar">
            <span className="att-badge att-in">{classAttendance.filter((a) => a.status === 'in').length} IN</span>
            <span className="att-badge att-out">{classAttendance.filter((a) => a.status === 'out').length} OUT</span>
            <span className="att-badge att-total">{classAttendance.length} Tagged</span>
          </div>
        )}
      </header>

      <main className="principal-class-main">
        {loading && <div className="principal-loading">Loading pickups…</div>}
        {error && <div className="principal-error">{error}</div>}
        {!loading && !error && pickups.length === 0 && (
          <div className="principal-empty">No pickups recorded yet for this class.</div>
        )}
        {!loading && !error && pickups.length > 0 && (
          <div className="principal-pickup-list">
            {pickups.map((p) => (
              <PickupBox
                key={p.id}
                pickup={p}
                formatTime={formatTime}
                imageSrc={imageSrc}
                onDetailClick={(pickup) => setDetailPopup(pickup)}
              />
            ))}
          </div>
        )}
      </main>

      {/* Pickup Detail Modal */}
      {detailPopup && (
        <PickupDetailModal
          pickup={detailPopup}
          formatTime={formatTime}
          imageSrc={imageSrc}
          onClose={() => setDetailPopup(null)}
        />
      )}

      <nav className="class-view-nav-bottom">
        <Link to="/principal" className="nav-link">← Principal&apos;s Dashboard</Link>
        <Link to="/" className="nav-link">🏠 Home</Link>
      </nav>
    </div>
  );
}

function PickupDetailModal({ pickup, formatTime, imageSrc, onClose }) {
  const [pickupImgOk, setPickupImgOk] = useState(true);
  const [adultImgOk, setAdultImgOk] = useState(true);
  const [childImgOk, setChildImgOk] = useState(true);

  const hasPickupImage = !!pickup.pickup_image;
  const hasAdultImage = !!pickup.adult_image;
  const hasChildImage = !!pickup.child_image;

  return (
    <div
      className="principal-detail-overlay"
      onClick={onClose}
      role="button"
      tabIndex={0}
      onKeyDown={(e) => e.key === 'Escape' && onClose()}
      aria-label="Close"
    >
      <div
        className="principal-detail-content"
        onClick={(e) => e.stopPropagation()}
        role="presentation"
      >
        <button
          type="button"
          className="principal-detail-close-btn"
          onClick={onClose}
          aria-label="Close"
        >
          ✕
        </button>

        <h2 className="principal-detail-title">Pickup Details</h2>

        <div className="principal-detail-info">
          <div className="principal-detail-row">
            <span className="principal-detail-label">Student:</span>
            <span className="principal-detail-value">{pickup.student_name}</span>
          </div>
          <div className="principal-detail-row">
            <span className="principal-detail-label">Class:</span>
            <span className="principal-detail-value">{pickup.student_class || 'N/A'}</span>
          </div>
          <div className="principal-detail-row">
            <span className="principal-detail-label">Guardian:</span>
            <span className="principal-detail-value">{pickup.adult_name || 'Unknown'}</span>
          </div>
          <div className="principal-detail-row">
            <span className="principal-detail-label">Pickup Time:</span>
            <span className="principal-detail-value">{formatTime(pickup.timestamp)}</span>
          </div>
          {pickup.uhf_out_time && (
            <div className="principal-detail-row">
              <span className="principal-detail-label">🔖 UHF Out:</span>
              <span className="principal-detail-value">{formatTime(pickup.uhf_out_time)}</span>
            </div>
          )}
          <div className="principal-detail-row">
            <span className="principal-detail-label">Card ID:</span>
            <span className="principal-detail-value">{pickup.card_id}</span>
          </div>
        </div>

        <div className="principal-detail-images">
          {/* Captured Pickup Image - Most Important */}
          {hasPickupImage && (
            <div className="principal-detail-image-box principal-detail-pickup-image">
              <div className="principal-detail-image-label">📷 Photo at Pickup</div>
              {pickupImgOk ? (
                <img 
                  src={imageSrc(pickup.pickup_image)} 
                  alt="Captured at pickup" 
                  onError={() => setPickupImgOk(false)}
                />
              ) : (
                <div className="principal-detail-image-placeholder">Image unavailable</div>
              )}
            </div>
          )}

          {/* Registered Guardian Image */}
          {hasAdultImage && pickup.adult_image !== pickup.pickup_image && (
            <div className="principal-detail-image-box">
              <div className="principal-detail-image-label">👤 Registered Guardian</div>
              {adultImgOk ? (
                <img 
                  src={imageSrc(pickup.adult_image)} 
                  alt="Registered guardian" 
                  onError={() => setAdultImgOk(false)}
                />
              ) : (
                <div className="principal-detail-image-placeholder">Image unavailable</div>
              )}
            </div>
          )}

          {/* Student Image */}
          {hasChildImage && (
            <div className="principal-detail-image-box">
              <div className="principal-detail-image-label">🎒 Student</div>
              {childImgOk ? (
                <img 
                  src={imageSrc(pickup.child_image)} 
                  alt="Student" 
                  onError={() => setChildImgOk(false)}
                />
              ) : (
                <div className="principal-detail-image-placeholder">Image unavailable</div>
              )}
            </div>
          )}

          {!hasPickupImage && !hasAdultImage && !hasChildImage && (
            <div className="principal-detail-no-images">
              No images available for this pickup
            </div>
          )}
        </div>

        <div className="principal-detail-footer">
          <button onClick={onClose} className="principal-detail-done-btn">
            Done
          </button>
        </div>
      </div>
    </div>
  );
}

function PickupBox({ pickup, formatTime, imageSrc, onDetailClick }) {
  const [adultImgOk, setAdultImgOk] = useState(true);
  const [childImgOk, setChildImgOk] = useState(true);

  // Prioritize pickup_image (captured at pickup) over registered adult_image
  const displayImage = pickup.pickup_image || pickup.adult_image;

  return (
    <div 
      className="class-view-scan-box principal-pickup-box principal-pickup-clickable"
      onClick={() => onDetailClick && onDetailClick(pickup)}
      role="button"
      tabIndex={0}
      onKeyDown={(e) => e.key === 'Enter' && onDetailClick && onDetailClick(pickup)}
    >
      <div className="class-view-side class-view-adult-side">
        <div className="class-view-role-label">Guardian</div>
        <div className="class-view-avatar class-view-adult">
          {adultImgOk && displayImage ? (
            <img 
              src={imageSrc(displayImage)} 
              alt="Registered Guardian" 
              onError={() => setAdultImgOk(false)} 
            />
          ) : (
            <div className="class-view-avatar-placeholder">👤</div>
          )}
        </div>
        <div className="class-view-side-name">{pickup.adult_name || 'Guardian'}</div>
      </div>
      <div className="class-view-center">
        <div className="class-view-name">{pickup.student_name}</div>
        <div className="class-view-time">🕐 {formatTime(pickup.timestamp)}</div>
        {pickup.uhf_out_time && (
          <div className="class-view-uhf-time">🔖 UHF: {formatTime(pickup.uhf_out_time)}</div>
        )}
        <div className="class-view-tap-hint">Tap for details</div>
      </div>
      <div className="class-view-side class-view-child-side">
        <div className="class-view-role-label">Student</div>
        <div className="class-view-avatar class-view-child">
          {childImgOk && pickup.child_image ? (
            <img src={imageSrc(pickup.child_image)} alt="Student" onError={() => setChildImgOk(false)} />
          ) : (
            <div className="class-view-avatar-placeholder">🎒</div>
          )}
        </div>
        <div className="class-view-side-name">{pickup.student_name}</div>
      </div>
    </div>
  );
}

export default PrincipalClassView;
