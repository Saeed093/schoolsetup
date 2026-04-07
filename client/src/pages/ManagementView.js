import React from 'react';
import { Link } from 'react-router-dom';
import CardManager from '../components/CardManager';
import './ManagementView.css';

function ManagementView() {
  return (
    <div className="management-view">
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
      <header className="management-view-header">
        <div className="header-content">
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
