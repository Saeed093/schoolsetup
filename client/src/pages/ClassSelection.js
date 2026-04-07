import React from 'react';
import { Link } from 'react-router-dom';
import './ClassSelection.css';

const CLASSES = [
  { id: 'prenursery', label: 'Prenursery' },
  { id: 'nursery', label: 'Nursery' },
  { id: '1', label: 'Class 1' },
  { id: '2', label: 'Class 2' },
  { id: '3', label: 'Class 3' },
  { id: '4', label: 'Class 4' },
  { id: '5', label: 'Class 5' },
];

function ClassSelection() {
  return (
    <div className="class-selection-page">
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
      <header className="class-selection-header">
        <h1>Select Class</h1>
        <p className="subtitle">Choose a class to view or manage</p>
      </header>

      <div className="class-options">
        {CLASSES.map((cls) => {
          const isActive = cls.id === '1' || cls.id === '2';
          return (
            <div key={cls.id} className="class-card-wrapper">
              {isActive ? (
                <Link
                  to={`/class/${encodeURIComponent(cls.id)}`}
                  className="class-card"
                >
                  <span className="class-label">{cls.label}</span>
                </Link>
              ) : (
                <span className="class-card class-card-disabled">
                  <span className="class-label">{cls.label}</span>
                </span>
              )}
            </div>
          );
        })}
      </div>

      <div className="class-selection-actions">
        <Link to="/" className="back-link">← Back to Home</Link>
      </div>
    </div>
  );
}

export default ClassSelection;
