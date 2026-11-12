import React from 'react';
import ReactDOM from 'react-dom/client';
import { BrowserRouter, Navigate, Route, Routes, useParams } from 'react-router-dom';
import './index.css';
import { applyTheme } from './theme.jsx';
import { startI18n } from './i18n.js';

applyTheme();
import { AuthProvider, ToastProvider, useAuth } from './context.jsx';
import Layout from './components/Layout.jsx';
import Login from './pages/Login.jsx';
import Users from './pages/Users.jsx';
import EddOverview from './pages/EddOverview.jsx';
import MyCases from './pages/MyCases.jsx';
import BulkUpload from './pages/BulkUpload.jsx';
import MasterData from './pages/MasterData.jsx';
import Cases from './pages/Cases.jsx';
import Glossary from './pages/Glossary.jsx';
import Reports from './pages/Reports.jsx';
import ComingSoon from './pages/ComingSoon.jsx';

function Protected({ children, admin }) {
  const { user, loading } = useAuth();
  if (loading) return <div className="empty">Loading…</div>;
  if (!user) return <Navigate to="/login" replace />;
  if (admin && user.role !== 'admin') return <Navigate to="/edd" replace />;
  return children;
}

/** My Work is for officers; admins work from Master Data */
function OfficerOnly({ children }) {
  const { user } = useAuth();
  return user.role === 'admin' ? <Navigate to="/edd/master" replace /> : children;
}

/** Old /module/:slug links (bookmarks) now live under /cases/:slug */
function LegacyModuleRedirect() {
  const { slug } = useParams();
  return <Navigate to={`/cases/${slug}`} replace />;
}

function App() {
  return (
    <Routes>
      <Route path="/login" element={<Login />} />
      <Route element={<Protected><Layout /></Protected>}>
        <Route index element={<Navigate to="/edd" replace />} />
        <Route path="/edd" element={<EddOverview />} />
        <Route path="/edd/cases" element={<OfficerOnly><MyCases /></OfficerOnly>} />
        <Route path="/edd/upload" element={<BulkUpload />} />
        <Route path="/edd/master" element={<MasterData />} />
        <Route path="/users" element={<Protected admin><Users /></Protected>} />
        <Route path="/cases" element={<Cases />} />
        <Route path="/cases/:view" element={<Cases />} />
        <Route path="/module/:slug" element={<LegacyModuleRedirect />} />
        <Route path="/glossary" element={<Glossary />} />
        <Route path="/dashboard" element={<ComingSoon crumb="Dashboard" title="Dashboard">A single view of EDD and case activity across the team.</ComingSoon>} />
        <Route path="/reports" element={<Reports />} />
        <Route path="/reports/:report" element={<Reports />} />
      </Route>
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}

startI18n();

ReactDOM.createRoot(document.getElementById('root')).render(
  <BrowserRouter>
    <ToastProvider>
      <AuthProvider>
        <App />
      </AuthProvider>
    </ToastProvider>
  </BrowserRouter>
);
