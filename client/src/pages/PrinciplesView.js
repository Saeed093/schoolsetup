import React, { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import './PrinciplesView.css';
import FaceNoMatchBanner from '../components/FaceNoMatchBanner';

// Use same-origin API so data loads on any device/resolution (proxy in dev, same host in prod)
const API_BASE = '';

// WebSocket URL for real-time updates (connect to backend on port 5000)
const getWsUrl = () => {
  const host = window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1'
    ? 'localhost'
    : window.location.hostname;
  return `ws://${host}:5000/`;
};

// Aesthetic Clock Component
function DashboardClock() {
  const [time, setTime] = useState(new Date());

  useEffect(() => {
    const timer = setInterval(() => setTime(new Date()), 1000);
    return () => clearInterval(timer);
  }, []);

  const hours = time.getHours();
  const minutes = time.getMinutes();
  const seconds = time.getSeconds();
  const ampm = hours >= 12 ? 'PM' : 'AM';
  const displayHours = hours % 12 || 12;

  const dateStr = time.toLocaleDateString('en-US', {
    weekday: 'long',
    year: 'numeric',
    month: 'long',
    day: 'numeric'
  });

  return (
    <div className="dashboard-clock">
      <div className="clock-time">
        <span className="clock-digits">{String(displayHours).padStart(2, '0')}</span>
        <span className="clock-separator">:</span>
        <span className="clock-digits">{String(minutes).padStart(2, '0')}</span>
        <span className="clock-separator clock-seconds-sep">:</span>
        <span className="clock-digits clock-seconds">{String(seconds).padStart(2, '0')}</span>
        <span className="clock-ampm">{ampm}</span>
      </div>
      <div className="clock-date">{dateStr}</div>
    </div>
  );
}

function PrinciplesView() {
  const [classes, setClasses] = useState([]);
  const [loading, setLoading] = useState(true);
  const [faceNoMatchAlert, setFaceNoMatchAlert] = useState(null);

  const fetchClasses = async () => {
    try {
      const res = await fetch(`${API_BASE}/api/principal/classes`);
      if (!res.ok) return;
      const contentType = res.headers.get('content-type');
      if (!contentType || !contentType.includes('application/json')) return;
      const data = await res.json();
      setClasses(data.classes || []);
    } catch (err) {
      console.error('Failed to fetch classes:', err);
    }
  };

  useEffect(() => {
    let cancelled = false;
    
    const initialFetch = async () => {
      try {
        const res = await fetch(`${API_BASE}/api/principal/classes`);
        if (!res.ok) throw new Error('Connection issue');
        const contentType = res.headers.get('content-type');
        if (!contentType || !contentType.includes('application/json')) {
          throw new Error('Connection issue');
        }
        const data = await res.json();
        if (!cancelled) {
          setClasses(data.classes || []);
        }
      } catch (err) {
        console.error('Initial fetch failed:', err);
      } finally {
        if (!cancelled) setLoading(false);
      }
    };
    
    initialFetch();
    const interval = setInterval(fetchClasses, 1500);
    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, []);

  // WebSocket for real-time updates (especially important on mobile)
  useEffect(() => {
    let ws = null;
    let reconnectTimeout = null;
    let isMounted = true;

    const connectWs = () => {
      try {
        ws = new WebSocket(getWsUrl());
        
        ws.onmessage = (event) => {
          try {
            const data = JSON.parse(event.data);
            // When a scan happens, refresh the data immediately
            if (data.type === 'card_scan' || data.type === 'checkin_update' || data.type === 'pickup_image_update') {
              console.log('[PrinciplesView] Received scan event, refreshing data...');
              fetchClasses();
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
        console.error('[PrinciplesView] WebSocket error:', err);
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

  // Calculate totals for summary
  const totalStudents = classes.reduce((sum, cls) => sum + (cls.total || 0), 0);
  const totalRemaining = classes.reduce((sum, cls) => sum + (cls.remaining || 0), 0);
  const totalPickedUp = totalStudents - totalRemaining;

  return (
    <div className="principles-view-page" style={{ backgroundImage: 'url(/images/123.jpg)' }}>
      <div className="principles-logo-header principles-logo-left">
        <img src="/images/log.png" alt="School Logo" className="page-logo" />
      </div>
      <div className="principles-logo-header">
        <img src="/images/logo.png" alt="School Logo" className="page-logo" />
      </div>

      <FaceNoMatchBanner
        alert={faceNoMatchAlert}
        onDismiss={() => setFaceNoMatchAlert(null)}
      />
      
      <header className="principles-header">
        <h1>Principal&apos;s Dashboard</h1>
        <DashboardClock />
      </header>

      {/* Unified Summary Card */}
      <div className="unified-summary-card">
        <div className="summary-row">
          <div className="summary-item total-item">
            <div className="summary-icon-circle total-circle">
              <span>👨‍👩‍👧‍👦</span>
            </div>
            <div className="summary-text">
              <span className="summary-number">{totalStudents}</span>
              <span className="summary-label">Total Students</span>
            </div>
          </div>
        </div>
        
        <div className="summary-row two-col">
          <div className="summary-item welcome-item">
            <div className="summary-icon-circle welcome-circle">
              <span>🌅</span>
            </div>
            <div className="summary-text">
              <span className="summary-number">{totalRemaining}</span>
              <span className="summary-label">Welcome</span>
              <span className="summary-sublabel">In School</span>
            </div>
          </div>
          
          <div className="summary-item goodbye-item">
            <div className="summary-icon-circle goodbye-circle">
              <span>👋</span>
            </div>
            <div className="summary-text">
              <span className="summary-number">{totalPickedUp}</span>
              <span className="summary-label">Goodbye</span>
              <span className="summary-sublabel">Picked Up</span>
            </div>
          </div>
        </div>
      </div>

      {loading && <div className="principles-loading">Loading…</div>}

      <h2 className="section-title">Select Class for Details</h2>
      
      <div className="principles-scroll-area">
      <div className="principles-class-grid">
        {classes.map((cls) => {
          const isActive = cls.id === '1' || cls.id === '2';
          const allGone = cls.total > 0 && cls.remaining === 0;
          const content = (
            <>
              <span className="principles-class-label">{cls.label}</span>
              <span className="principles-class-students">
                Students : {cls.remaining}/{cls.total}
              </span>
            </>
          );
          const cardClass = `principles-class-card${allGone ? ' principles-class-card-all-gone' : ''}`;
          return isActive ? (
            <Link
              key={cls.id}
              to={`/principal/class/${encodeURIComponent(cls.id)}`}
              className={cardClass}
            >
              {content}
            </Link>
          ) : (
            <span key={cls.id} className={`principles-class-card principles-class-card-disabled${allGone ? ' principles-class-card-all-gone' : ''}`}>
              {content}
            </span>
          );
        })}
      </div>
      </div>

      <div className="principles-actions">
        <Link to="/" className="principles-back-link">← Back to Home</Link>
      </div>
    </div>
  );
}

export default PrinciplesView;
