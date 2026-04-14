import React from 'react';
import { Link } from 'react-router-dom';
import './Home.css';

function Home() {
  return (
    <div className="home-page">
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
      <header className="home-header">
        <h1>🏫 School Pickup RFID System</h1>
        <p className="subtitle">Choose a view to get started</p>
      </header>
      
      <div className="home-options">
        <Link to="/class-selection" className="option-card class-card-home">
          <div className="card-icon">📚</div>
          <h2>Class Selection</h2>
          <p>Select a class (1–5, Prenursery, Nursery)</p>
          <p className="card-hint">Filter by class</p>
        </Link>

        <Link to="/principal" className="option-card principles-card-home">
          <div className="card-icon">👩‍💼</div>
          <h2>Principal&apos;s Dashboard</h2>
          <p>Students remaining by class — view pickups and times</p>
          <p className="card-hint">Guardian photos and pickup times</p>
        </Link>

        <Link to="/scan" className="option-card scan-card">
          <div className="card-icon">📡</div>
          <h2>Scan View</h2>
          <p>Live display for card scanning</p>
          <p className="card-hint">Perfect for display screens</p>
        </Link>
        
        <Link to="/manage" className="option-card manage-card">
          <div className="card-icon">📋</div>
          <h2>Management View</h2>
          <p>Add, edit, and manage cards</p>
          <p className="card-hint">For administration</p>
        </Link>
        
        <Link to="/time-to-go-home" className="option-card time-card">
          <div className="card-icon">🏠</div>
          <h2>Time to Go Home</h2>
          <p>Display for dismissal</p>
          <p className="card-hint">Student pickup display</p>
        </Link>

        <Link to="/capture" className="option-card capture-card-home">
          <div className="card-icon">📷</div>
          <h2>Capture Station</h2>
          <p>Camera + RFID pickup point</p>
          <p className="card-hint">Run on server machine</p>
        </Link>

        <Link to="/attendance" className="option-card attendance-card-home">
          <div className="card-icon">📶</div>
          <h2>Child Attendance</h2>
          <p>UHF tag-based in/out tracking</p>
          <p className="card-hint">Real-time attendance dashboard</p>
        </Link>

        <Link to="/admin" className="option-card admin-card-home">
          <div className="card-icon">🔐</div>
          <h2>Admin</h2>
          <p>Test tools: simulate scan, clear display</p>
          <p className="card-hint">Password protected</p>
        </Link>
      </div>

      <div className="home-info">
        <p>💡 Tip: You can open both views in separate browser windows or tabs</p>
      </div>
    </div>
  );
}

export default Home;
