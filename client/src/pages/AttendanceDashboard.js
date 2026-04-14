import React, { useState, useEffect, useCallback } from 'react';
import { Link } from 'react-router-dom';
import './AttendanceDashboard.css';

const API_BASE = '';

const getWsUrl = () => {
  const host = window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1'
    ? 'localhost'
    : window.location.hostname;
  return `ws://${host}:5000/`;
};

function AttendanceDashboard() {
  const [attendance, setAttendance] = useState([]);
  const [summary, setSummary] = useState({ total: 0, total_in: 0, total_out: 0, by_class: [] });
  const [readerStatus, setReaderStatus] = useState({});
  const [settings, setSettings] = useState({});
  const [log, setLog] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [filterClass, setFilterClass] = useState('');
  const [searchName, setSearchName] = useState('');
  const [activeTab, setActiveTab] = useState('live');
  const [connectForm, setConnectForm] = useState({ sdkUrl: '', comPort: '' });
  const [simulateEpc, setSimulateEpc] = useState('');
  const [actionMsg, setActionMsg] = useState('');
  const [sdkProbe, setSdkProbe] = useState(null);
  const [liveTagFeed, setLiveTagFeed] = useState([]);

  const fetchAttendance = useCallback(async () => {
    try {
      const res = await fetch(`${API_BASE}/api/attendance`);
      const data = await res.json();
      setAttendance(data.attendance || []);
    } catch { /* ignore */ }
  }, []);

  const fetchSummary = useCallback(async () => {
    try {
      const res = await fetch(`${API_BASE}/api/attendance/summary`);
      const data = await res.json();
      setSummary(data);
    } catch { /* ignore */ }
  }, []);

  const fetchStatus = useCallback(async () => {
    try {
      const res = await fetch(`${API_BASE}/api/uhf/status`);
      const data = await res.json();
      setReaderStatus(data);
    } catch { /* ignore */ }
  }, []);

  const fetchSettings = useCallback(async () => {
    try {
      const res = await fetch(`${API_BASE}/api/attendance/settings`);
      const data = await res.json();
      setSettings(data.settings || {});
      setConnectForm((prev) => ({
        sdkUrl: prev.sdkUrl || data.settings?.sdk_url || 'http://localhost:8888',
        comPort: prev.comPort || data.settings?.com_port || ''
      }));
    } catch { /* ignore */ }
  }, []);

  const fetchLog = useCallback(async () => {
    try {
      const res = await fetch(`${API_BASE}/api/attendance/log?limit=100`);
      const data = await res.json();
      setLog(data.log || []);
    } catch { /* ignore */ }
  }, []);

  useEffect(() => {
    const init = async () => {
      setLoading(true);
      await Promise.all([fetchAttendance(), fetchSummary(), fetchStatus(), fetchSettings()]);
      setLoading(false);
    };
    init();
    const interval = setInterval(() => {
      fetchAttendance();
      fetchSummary();
    }, 3000);
    return () => clearInterval(interval);
  }, [fetchAttendance, fetchSummary, fetchStatus, fetchSettings]);

  useEffect(() => {
    if (activeTab === 'log') fetchLog();
  }, [activeTab, fetchLog]);

  // WebSocket for live updates
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
            if (data.type === 'attendance_change') {
              fetchAttendance();
              fetchSummary();
              if (activeTab === 'log') fetchLog();
              setLiveTagFeed((prev) => [{
                id: Date.now(),
                epc: data.uhf_tag_id,
                student: data.student_name,
                studentClass: data.student_class,
                direction: data.new_status,
                time: data.timestamp || new Date().toISOString(),
                known: true
              }, ...prev].slice(0, 50));
            } else if (data.type === 'attendance_reset' || data.type === 'attendance_mass_update') {
              fetchAttendance();
              fetchSummary();
              if (activeTab === 'log') fetchLog();
            } else if (data.type === 'uhf_unknown_tag') {
              setLiveTagFeed((prev) => [{
                id: Date.now(),
                epc: data.epc,
                student: null,
                studentClass: null,
                direction: null,
                time: data.timestamp || new Date().toISOString(),
                known: false
              }, ...prev].slice(0, 50));
            }
          } catch { /* ignore */ }
        };
        ws.onclose = () => { if (isMounted) reconnectTimeout = setTimeout(connectWs, 3000); };
        ws.onerror = () => { ws?.close(); };
      } catch {
        if (isMounted) reconnectTimeout = setTimeout(connectWs, 3000);
      }
    };
    connectWs();
    return () => { isMounted = false; clearTimeout(reconnectTimeout); ws?.close(); };
  }, [fetchAttendance, fetchSummary, fetchLog, activeTab]);

  const handleConnect = async () => {
    setError('');
    setActionMsg('');
    try {
      const res = await fetch(`${API_BASE}/api/uhf/connect`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(connectForm)
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      setReaderStatus(data.status || {});
      setActionMsg('Connected to UHF reader');
    } catch (err) {
      setError(err.message);
    }
  };

  const handleDisconnect = async () => {
    try {
      await fetch(`${API_BASE}/api/uhf/disconnect`, { method: 'POST' });
      fetchStatus();
      setActionMsg('Disconnected from UHF reader');
    } catch (err) {
      setError(err.message);
    }
  };

  const handleStartScan = async () => {
    try {
      const res = await fetch(`${API_BASE}/api/uhf/start`, { method: 'POST' });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      setReaderStatus(data.status || {});
      setActionMsg('Scanning started');
    } catch (err) {
      setError(err.message);
    }
  };

  const handleStopScan = async () => {
    try {
      await fetch(`${API_BASE}/api/uhf/stop`, { method: 'POST' });
      fetchStatus();
      setActionMsg('Scanning stopped');
    } catch (err) {
      setError(err.message);
    }
  };

  const handleReset = async () => {
    if (!window.confirm('Reset all attendance to OUT? This cannot be undone.')) return;
    try {
      await fetch(`${API_BASE}/api/attendance/reset`, { method: 'POST' });
      fetchAttendance();
      fetchSummary();
      setActionMsg('All attendance reset to OUT');
    } catch (err) {
      setError(err.message);
    }
  };

  const handleSaveDebounce = async (newVal) => {
    try {
      await fetch(`${API_BASE}/api/attendance/settings`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ settings: { debounce_seconds: newVal } })
      });
      fetchSettings();
    } catch (err) {
      setError(err.message);
    }
  };

  const handleSimulateTag = async () => {
    if (!simulateEpc.trim()) return;
    try {
      await fetch(`${API_BASE}/api/uhf/simulate-tag`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ epc: simulateEpc.trim() })
      });
      setSimulateEpc('');
      setActionMsg(`Simulated tag: ${simulateEpc.trim().toUpperCase()}`);
    } catch (err) {
      setError(err.message);
    }
  };

  const filtered = attendance.filter((a) => {
    if (filterClass && (a.student_class || '').toLowerCase() !== filterClass.toLowerCase()) return false;
    if (searchName && !(a.student_name || '').toLowerCase().includes(searchName.toLowerCase())) return false;
    return true;
  });

  const uniqueClasses = [...new Set(attendance.map((a) => a.student_class).filter(Boolean))].sort();

  const formatTime = (iso) => {
    if (!iso) return '-';
    try {
      return new Date(iso).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit', second: '2-digit' });
    } catch { return iso; }
  };

  const formatDateTime = (iso) => {
    if (!iso) return '-';
    try {
      const d = new Date(iso);
      return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' }) + ' ' +
        d.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit', second: '2-digit' });
    } catch { return iso; }
  };

  if (loading) {
    return (
      <div className="attendance-page">
        <div className="attendance-loading">Loading attendance data...</div>
      </div>
    );
  }

  return (
    <div className="attendance-page">
      <header className="attendance-header">
        <h1>Child Attendance Tracker</h1>
        <div className="attendance-reader-indicator">
          <span className={`reader-dot ${readerStatus.connected ? (readerStatus.scanning ? 'scanning' : 'connected') : 'disconnected'}`} />
          <span className="reader-label">
            {readerStatus.scanning ? 'Scanning' : readerStatus.connected ? 'Connected' : 'Disconnected'}
          </span>
        </div>
      </header>

      {/* Summary Cards */}
      <div className="attendance-summary-bar">
        <div className="summary-card summary-total">
          <div className="summary-value">{summary.total}</div>
          <div className="summary-title">Total Tagged</div>
        </div>
        <div className="summary-card summary-in">
          <div className="summary-value">{summary.total_in}</div>
          <div className="summary-title">IN (School)</div>
        </div>
        <div className="summary-card summary-out">
          <div className="summary-value">{summary.total_out}</div>
          <div className="summary-title">OUT</div>
        </div>
      </div>

      {error && <div className="attendance-error">{error} <button onClick={() => setError('')}>Dismiss</button></div>}
      {actionMsg && <div className="attendance-action-msg">{actionMsg} <button onClick={() => setActionMsg('')}>OK</button></div>}

      {/* Tab navigation */}
      <div className="attendance-tabs">
        <button className={`tab-btn ${activeTab === 'live' ? 'active' : ''}`} onClick={() => setActiveTab('live')}>Live Status</button>
        <button className={`tab-btn ${activeTab === 'log' ? 'active' : ''}`} onClick={() => setActiveTab('log')}>History Log</button>
        <button className={`tab-btn ${activeTab === 'settings' ? 'active' : ''}`} onClick={() => setActiveTab('settings')}>Reader Settings</button>
      </div>

      {/* LIVE TAB */}
      {activeTab === 'live' && (
        <div className="attendance-live-tab">

          {/* Live EPC Tag Feed */}
          <div className="live-tag-feed-section">
            <div className="live-tag-feed-header">
              <h3>Live Tag Feed</h3>
              {liveTagFeed.length > 0 && (
                <button className="btn-clear-feed" onClick={() => setLiveTagFeed([])}>Clear</button>
              )}
            </div>
            {liveTagFeed.length === 0 ? (
              <div className="live-tag-feed-empty">
                {readerStatus.scanning
                  ? 'Waiting for tags... Scan a UHF tag near the reader.'
                  : 'Reader not scanning. Start scanning from Reader Settings to see live tags.'}
              </div>
            ) : (
              <div className="live-tag-feed-list">
                {liveTagFeed.map((t) => (
                  <div key={t.id} className={`live-tag-entry ${t.known ? (t.direction === 'in' ? 'tag-in' : 'tag-out') : 'tag-unknown'}`}>
                    <span className="live-tag-epc">{t.epc}</span>
                    {t.known ? (
                      <>
                        <span className="live-tag-student">{t.student}</span>
                        <span className={`live-tag-dir ${t.direction}`}>{t.direction === 'in' ? 'IN' : 'OUT'}</span>
                      </>
                    ) : (
                      <span className="live-tag-unknown-label">Unknown tag — not assigned</span>
                    )}
                    <span className="live-tag-time">{formatTime(t.time)}</span>
                  </div>
                ))}
              </div>
            )}
          </div>

          <div className="attendance-filters">
            <input
              type="text"
              placeholder="Search by name..."
              value={searchName}
              onChange={(e) => setSearchName(e.target.value)}
              className="attendance-search"
            />
            <select value={filterClass} onChange={(e) => setFilterClass(e.target.value)} className="attendance-filter-select">
              <option value="">All Classes</option>
              {uniqueClasses.map((c) => <option key={c} value={c}>{c}</option>)}
            </select>
          </div>

          {filtered.length === 0 ? (
            <div className="attendance-empty">
              No children with UHF tags assigned. Add UHF Tag IDs in the Management page.
            </div>
          ) : (
            <div className="attendance-grid">
              {filtered.map((a) => (
                <div key={a.card_id} className={`attendance-card ${a.status === 'in' ? 'status-in' : 'status-out'}`}>
                  <div className="attendance-card-status">
                    <span className={`status-badge ${a.status}`}>{a.status === 'in' ? 'IN' : 'OUT'}</span>
                  </div>
                  <div className="attendance-card-avatar">
                    {a.child_image ? (
                      <img src={a.child_image} alt={a.student_name} onError={(e) => { e.target.style.display = 'none'; }} />
                    ) : (
                      <div className="avatar-placeholder">🎒</div>
                    )}
                  </div>
                  <div className="attendance-card-info">
                    <div className="attendance-card-name">{a.student_name}</div>
                    <div className="attendance-card-class">{a.student_class || 'N/A'}</div>
                    <div className="attendance-card-time">{a.last_changed_at ? formatTime(a.last_changed_at) : '-'}</div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* LOG TAB */}
      {activeTab === 'log' && (
        <div className="attendance-log-tab">
          <button onClick={fetchLog} className="btn-refresh-log">Refresh</button>
          {log.length === 0 ? (
            <div className="attendance-empty">No attendance log entries yet.</div>
          ) : (
            <table className="attendance-log-table">
              <thead>
                <tr>
                  <th>Time</th>
                  <th>Student</th>
                  <th>Class</th>
                  <th>Direction</th>
                  <th>Tag</th>
                </tr>
              </thead>
              <tbody>
                {log.map((entry) => (
                  <tr key={entry.id} className={entry.direction === 'in' ? 'log-in' : 'log-out'}>
                    <td>{formatDateTime(entry.timestamp)}</td>
                    <td>{entry.student_name}</td>
                    <td>{entry.student_class || '-'}</td>
                    <td><span className={`log-direction ${entry.direction}`}>{entry.direction === 'in' ? 'IN' : 'OUT'}</span></td>
                    <td className="log-tag">{entry.uhf_tag_id}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      )}

      {/* SETTINGS TAB */}
      {activeTab === 'settings' && (
        <div className="attendance-settings-tab">
          <div className="settings-section settings-help-box">
            <h3>Why &quot;Cannot reach UHF SDK&quot;?</h3>
            <p className="settings-hint">
              The school app talks to a <strong>small Python web server</strong> (the UHF bridge) on port <strong>8888</strong>.
              That server is <strong>not</strong> started by <code>npm run dev</code> — you must run it in a <strong>second terminal</strong>.
            </p>
            <ol className="uhf-setup-steps">
              <li>Open PowerShell or Command Prompt in your project folder.</li>
              <li>
                <code>cd server\uhf-bridge</code>
              </li>
              <li>
                <code>pip install -r requirements.txt</code> (once)
              </li>
              <li>
                <code>python app.py</code> — you should see <em>Running on http://127.0.0.1:8888</em>
              </li>
              <li>Return here and click <strong>Connect Reader</strong>.</li>
            </ol>
            <p className="settings-hint">
              Or from the project root: <code>npm run uhf-bridge</code> (same thing).
              If the bridge runs on another PC, set <strong>SDK Server URL</strong> to <code>http://THAT_PC_IP:8888</code>.
            </p>
          </div>

          <div className="settings-section">
            <h3>UHF Reader Connection</h3>
            <p className="settings-hint">
              SDK status (saved URL):{' '}
              {readerStatus.sdkReachable ? (
                <span className="sdk-ok">reachable</span>
              ) : (
                <span className="sdk-bad">not reachable — start the Python bridge (see above)</span>
              )}
            </p>
            <div className="settings-actions" style={{ marginBottom: '12px' }}>
              <button
                type="button"
                className="btn-refresh-log"
                onClick={async () => {
                  setSdkProbe(null);
                  try {
                    const u = encodeURIComponent(connectForm.sdkUrl || 'http://localhost:8888');
                    const res = await fetch(`${API_BASE}/api/uhf/status?sdkUrl=${u}`);
                    const data = await res.json();
                    if (data.probeReachable === true) {
                      setSdkProbe({ ok: true, msg: `OK — bridge responds at ${data.probeUrl || connectForm.sdkUrl}` });
                    } else {
                      setSdkProbe({ ok: false, msg: `No response from ${connectForm.sdkUrl}. Start python app.py or check firewall / URL.` });
                    }
                  } catch {
                    setSdkProbe({ ok: false, msg: 'Could not test URL (server error).' });
                  }
                }}
              >
                Test SDK URL (form field)
              </button>
            </div>
            {sdkProbe && (
              <div className={sdkProbe.ok ? 'sdk-probe-ok' : 'sdk-probe-bad'}>{sdkProbe.msg}</div>
            )}
            <div className="settings-row">
              <label>SDK Server URL</label>
              <input
                type="text"
                value={connectForm.sdkUrl}
                onChange={(e) => setConnectForm({ ...connectForm, sdkUrl: e.target.value })}
                placeholder="http://localhost:8888"
              />
            </div>
            <div className="settings-row">
              <label>COM Port (leave blank for auto-detect)</label>
              <input
                type="text"
                value={connectForm.comPort}
                onChange={(e) => setConnectForm({ ...connectForm, comPort: e.target.value })}
                placeholder="COM3"
              />
            </div>
            <div className="settings-actions">
              {!readerStatus.connected ? (
                <button onClick={handleConnect} className="btn-connect">Connect Reader</button>
              ) : (
                <button onClick={handleDisconnect} className="btn-disconnect">Disconnect</button>
              )}
              {readerStatus.connected && !readerStatus.scanning && (
                <button onClick={handleStartScan} className="btn-start">Start Scanning</button>
              )}
              {readerStatus.scanning && (
                <button onClick={handleStopScan} className="btn-stop">Stop Scanning</button>
              )}
            </div>
          </div>

          <div className="settings-section">
            <h3>Debounce Time</h3>
            <p className="settings-hint">How long to ignore repeated reads of the same tag (prevents accidental double-toggles).</p>
            <div className="settings-row">
              <select
                value={settings.debounce_seconds || '300'}
                onChange={(e) => handleSaveDebounce(e.target.value)}
              >
                <option value="30">30 seconds</option>
                <option value="60">1 minute</option>
                <option value="120">2 minutes</option>
                <option value="300">5 minutes</option>
                <option value="600">10 minutes</option>
                <option value="900">15 minutes</option>
                <option value="1800">30 minutes</option>
              </select>
            </div>
          </div>

          <div className="settings-section">
            <h3>Reset Attendance</h3>
            <p className="settings-hint">Reset all children to OUT status (start of day).</p>
            <button onClick={handleReset} className="btn-reset">Reset All to OUT</button>
          </div>

          <div className="settings-section">
            <h3>Test / Simulate Tag</h3>
            <p className="settings-hint">Manually simulate a UHF tag scan for testing.</p>
            <div className="settings-row simulate-row">
              <input
                type="text"
                value={simulateEpc}
                onChange={(e) => setSimulateEpc(e.target.value.toUpperCase())}
                placeholder="Enter tag EPC"
              />
              <button onClick={handleSimulateTag} className="btn-simulate">Simulate</button>
            </div>
          </div>
        </div>
      )}

      <nav className="attendance-nav">
        <Link to="/" className="nav-link">Home</Link>
        <Link to="/manage" className="nav-link">Management</Link>
        <Link to="/principal" className="nav-link">Principal</Link>
      </nav>
    </div>
  );
}

export default AttendanceDashboard;
