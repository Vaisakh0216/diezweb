import React from 'react';
import ReactDOM from 'react-dom/client';
import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom';
import './index.css';
import { AuthProvider, ToastProvider, useAuth } from './context.jsx';
import Layout from './components/Layout.jsx';
import Login from './pages/Login.jsx';
import Users from './pages/Users.jsx';
import EddOverview from './pages/EddOverview.jsx';
import MyCases from './pages/MyCases.jsx';
import BulkUpload from './pages/BulkUpload.jsx';
import MasterData from './pages/MasterData.jsx';
import ComingSoon from './pages/ComingSoon.jsx';

function Protected({ children, admin }) {
  const { user, loading } = useAuth();
  if (loading) return <div className="empty">Loading…</div>;
  if (!user) return <Navigate to="/login" replace />;
  if (admin && user.role !== 'admin') return <Navigate to="/edd" replace />;
  return children;
}

function App() {
  return (
    <Routes>
      <Route path="/login" element={<Login />} />
      <Route element={<Protected><Layout /></Protected>}>
        <Route index element={<Navigate to="/edd" replace />} />
        <Route path="/edd" element={<EddOverview />} />
        <Route path="/edd/cases" element={<MyCases />} />
        <Route path="/edd/upload" element={<BulkUpload />} />
        <Route path="/edd/master" element={<MasterData />} />
        <Route path="/users" element={<Protected admin><Users /></Protected>} />
        <Route path="/module/:slug" element={<ComingSoon />} />
      </Route>
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}

ReactDOM.createRoot(document.getElementById('root')).render(
  <BrowserRouter>
    <ToastProvider>
      <AuthProvider>
        <App />
      </AuthProvider>
    </ToastProvider>
  </BrowserRouter>
);
