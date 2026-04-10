import React from 'react';
import { Link } from 'react-router-dom';
import CardManager from '../components/CardManager';
import './ManagementView.css';

function ManagementView() {
  return (
    <div className="management-view">
      <header className="management-page-header">
        <div className="management-logos-row">
          <div className="management-logo-wrap management-logo-wrap-left">
            <img src="/images/log.png" alt="School Logo" className="page-logo" />
          </div>
          <div className="management-logo-wrap">
            <img
              src="/images/logo.png"
              alt="Beaconhouse School Logo"
              className="page-logo"
            />
          </div>
        </div>
        <div className="management-title-block">
          <h1>📋 Card Management</h1>
          <p className="header-subtitle">Add, edit, and manage RFID cards</p>
        </div>
        <div className="header-actions">
          <Link to="/scan" className="nav-link">📡 View Scan Display</Link>
          <Link to="/" className="nav-link">🏠 Home</Link>
        </div>
      </header>

      <main className="management-view-main">
        <CardManager />
      </main>
    </div>
  );
}

export default ManagementView;
