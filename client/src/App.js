import React from 'react';
import { BrowserRouter as Router, Routes, Route, Navigate } from 'react-router-dom';
import './App.css';
import ScanView from './pages/ScanView';
import ManagementView from './pages/ManagementView';
import Home from './pages/Home';
import TimeToGoHome from './pages/TimeToGoHome';
import ClassSelection from './pages/ClassSelection';
import ClassView from './pages/ClassView';
import PrinciplesView from './pages/PrinciplesView';
import PrincipalClassView from './pages/PrincipalClassView';
import Admin from './pages/Admin';
import CaptureStation from './pages/CaptureStation';

function App() {
  return (
    <Router>
      <div className="App">
        <Routes>
          <Route path="/" element={<Home />} />
          <Route path="/admin" element={<Admin />} />
          <Route path="/capture" element={<CaptureStation />} />
          <Route path="/class-selection" element={<ClassSelection />} />
          <Route path="/class/:classId" element={<ClassView />} />
          <Route path="/principal" element={<PrinciplesView />} />
          <Route path="/principal/class/:classId" element={<PrincipalClassView />} />
          <Route path="/scan" element={<ScanView />} />
          <Route path="/manage" element={<ManagementView />} />
          <Route path="/time-to-go-home" element={<TimeToGoHome />} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </div>
    </Router>
  );
}

export default App;
