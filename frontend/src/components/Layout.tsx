import { useEffect, useState } from 'react';
import { NavLink, Outlet, Navigate, useLocation } from 'react-router-dom';

import { api } from '../api/client';
import { useAuth } from '../context/AuthContext';
import { getQueuedSaleCount, syncQueuedSales } from '../services/offlineService';
import { Icon, type IconName } from './Icons';

interface NavItem {
  to: string;
  label: string;
  icon: IconName;
  adminOnly?: boolean;
}

const NAV_ITEMS: NavItem[] = [
  { to: '/', label: 'Dashboard', icon: 'dashboard' },
  { to: '/inventory', label: 'Inventory', icon: 'box' },
  { to: '/sales', label: 'Sell / POS', icon: 'cart' },
  { to: '/alerts', label: 'Low stock', icon: 'bell' },
  { to: '/forecast', label: 'Forecast', icon: 'trend' },
  { to: '/movements', label: 'Movements', icon: 'history' },
  { to: '/team', label: 'Team', icon: 'users', adminOnly: true },
];

export const Layout = () => {
  const { user, business, isAdmin, logout } = useAuth();
  const location = useLocation();
  const [menuOpen, setMenuOpen] = useState(false);
  const [online, setOnline] = useState(() => navigator.onLine);
  const [queued, setQueued] = useState(0);
  const [syncNote, setSyncNote] = useState('');

  useEffect(() => {
    setMenuOpen(false);
  }, [location.pathname]);

  const refreshQueue = async () => {
    setQueued(await getQueuedSaleCount());
  };

  useEffect(() => {
    void refreshQueue();

    const handleOnline = async () => {
      setOnline(true);
      const result = await syncQueuedSales((payload) => api.recordSale(payload));
      await refreshQueue();
      if (result.synced > 0) {
        setSyncNote(`${result.synced} offline sale${result.synced === 1 ? '' : 's'} synced`);
        window.dispatchEvent(new Event('sales:synced'));
      }
      if (result.failed > 0) {
        setSyncNote(`${result.failed} queued sale(s) could not be synced yet`);
      }
    };
    const handleOffline = () => setOnline(false);
    const handleQueueChange = () => void refreshQueue();
    const handleSynced = () => void refreshQueue();

    window.addEventListener('online', handleOnline);
    window.addEventListener('offline', handleOffline);
    window.addEventListener('sales:queued', handleQueueChange);
    window.addEventListener('sales:synced', handleSynced);

    if (navigator.onLine) {
      void syncQueuedSales((payload) => api.recordSale(payload)).then(async (result) => {
        await refreshQueue();
        if (result.synced > 0) {
          window.dispatchEvent(new Event('sales:synced'));
        }
      });
    }

    return () => {
      window.removeEventListener('online', handleOnline);
      window.removeEventListener('offline', handleOffline);
      window.removeEventListener('sales:queued', handleQueueChange);
      window.removeEventListener('sales:synced', handleSynced);
    };
  }, []);

  useEffect(() => {
    if (!syncNote) {
      return;
    }
    const timer = window.setTimeout(() => setSyncNote(''), 6000);
    return () => window.clearTimeout(timer);
  }, [syncNote]);

  const visibleItems = NAV_ITEMS.filter((item) => !item.adminOnly || isAdmin);

  return (
    <div className="app-shell">
      <aside className={`sidebar${menuOpen ? ' sidebar-open' : ''}`}>
        <div className="brand">
          <span className="brand-mark" aria-hidden="true">
            <span />
            <span />
            <span />
          </span>
          <div>
            <p className="brand-name">Stockroom</p>
            <p className="brand-sub">Inventory control</p>
          </div>
        </div>

        <nav className="nav" aria-label="Main navigation">
          {visibleItems.map((item) => (
            <NavLink
              key={item.to}
              to={item.to}
              end={item.to === '/'}
              className={({ isActive }) => `nav-link${isActive ? ' nav-link-active' : ''}`}
            >
              <Icon name={item.icon} />
              <span>{item.label}</span>
            </NavLink>
          ))}
        </nav>

        <div className="sidebar-foot">
          <div className="user-card">
            <span className="avatar" aria-hidden="true">
              {user?.name?.slice(0, 1).toUpperCase() ?? '?'}
            </span>
            <div className="user-meta">
              <strong>{user?.name}</strong>
              <span>{user?.role === 'admin' ? 'Administrator' : 'Staff'}</span>
            </div>
            <button type="button" className="icon-btn icon-btn-light" onClick={logout} aria-label="Sign out">
              <Icon name="logout" />
            </button>
          </div>
        </div>
      </aside>

      <div className="app-main">
        <header className="topbar">
          <button
            type="button"
            className="icon-btn menu-btn"
            onClick={() => setMenuOpen((open) => !open)}
            aria-label="Toggle navigation"
          >
            <Icon name={menuOpen ? 'close' : 'menu'} />
          </button>
          <div className="topbar-context">
            <span className="eyebrow">Workspace</span>
            <strong>{business?.name ?? 'Loading business…'}</strong>
          </div>
          <div className="topbar-status">
            <span className={`pill ${online ? 'pill-online' : 'pill-offline'}`}>
              <span className="dot" aria-hidden="true" />
              {online ? 'Online' : 'Offline'}
            </span>
            {queued > 0 ? (
              <span className="pill pill-queue" title="Sales waiting to sync">
                <Icon name="cloud" size={14} />
                {queued} queued
              </span>
            ) : null}
            <span className="pill pill-role">{user?.role}</span>
          </div>
        </header>

        {syncNote ? <div className="sync-note">{syncNote}</div> : null}

        <main className="page">
          <Outlet />
        </main>
      </div>
    </div>
  );
};

export const FullScreenLoader = ({ label = 'Preparing your workspace…' }: { label?: string }) => (
  <div className="boot-screen">
    <div className="boot-mark">
      <span />
      <span />
      <span />
    </div>
    <p>{label}</p>
  </div>
);

export const ProtectedRoute = ({ adminOnly = false }: { adminOnly?: boolean }) => {
  const { user, loading, isAdmin } = useAuth();
  const location = useLocation();

  if (loading) {
    return <FullScreenLoader />;
  }

  if (!user) {
    return <Navigate to="/login" replace state={{ from: location.pathname }} />;
  }

  if (adminOnly && !isAdmin) {
    return <Navigate to="/" replace />;
  }

  return <Outlet />;
};
