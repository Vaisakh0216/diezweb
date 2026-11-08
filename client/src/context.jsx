import React, { createContext, useCallback, useContext, useEffect, useState } from 'react';
import { api, getToken, setToken } from './api.js';

const AuthCtx = createContext(null);
const ToastCtx = createContext(() => {});
const MetaCtx = createContext(null);

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null);
  const [meta, setMeta] = useState(null);
  const [loading, setLoading] = useState(!!getToken());

  useEffect(() => { api('/meta').then(setMeta).catch(() => {}); }, []);
  useEffect(() => {
    if (!getToken()) return;
    api('/auth/me').then(setUser).catch(() => setToken(null)).finally(() => setLoading(false));
  }, []);

  const login = async (email, password) => {
    const { token, user } = await api('/auth/login', { method: 'POST', body: { email, password } });
    setToken(token);
    setUser(user);
  };
  const logout = () => { setToken(null); setUser(null); };

  return (
    <MetaCtx.Provider value={meta}>
      <AuthCtx.Provider value={{ user, loading: loading || !meta, login, logout }}>{children}</AuthCtx.Provider>
    </MetaCtx.Provider>
  );
}

export function ToastProvider({ children }) {
  const [toasts, setToasts] = useState([]);
  const push = useCallback((msg, type = 'success') => {
    const id = Math.random();
    setToasts((t) => [...t, { id, msg, type }]);
    setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), 4000);
  }, []);
  return (
    <ToastCtx.Provider value={push}>
      {children}
      <div className="toasts">{toasts.map((t) => <div key={t.id} className={`toast ${t.type}`}>{t.msg}</div>)}</div>
    </ToastCtx.Provider>
  );
}

export const useAuth = () => useContext(AuthCtx);
export const useToast = () => useContext(ToastCtx);
export const useMeta = () => useContext(MetaCtx);
