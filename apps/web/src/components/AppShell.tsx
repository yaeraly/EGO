import { NavLink, Outlet } from 'react-router-dom';
import { useAuth } from '../auth/AuthContext';
import { useUnreadCount } from '../hooks/useUnreadCount';

const ROLE_LABEL: Record<string, string> = {
  OWNER: 'Ээси',
  SALES_MANAGER: 'Менеджер',
  SELLER: 'Сатуучу',
  WAREHOUSE: 'Склад',
  ACCOUNTANT: 'Эсепчи',
};

export function AppShell() {
  const { user, logout } = useAuth();
  const unread = useUnreadCount();

  return (
    <>
      <header className="app-header">
        <h1>EGOMOT</h1>
        <div className="inline">
          <span className="who">
            {user?.full_name} · {ROLE_LABEL[user?.role ?? ''] ?? user?.role}
          </span>
          <button className="link" style={{ color: '#fff' }} onClick={logout}>
            Чыгуу
          </button>
        </div>
      </header>

      <Outlet />

      <nav className="bottom-nav">
        <NavLink to="/purchases">
          <span className="icon">📦</span>
          Сатып алуу
        </NavLink>
        <NavLink to="/receipts">
          <span className="icon">📥</span>
          Приход
        </NavLink>
        <NavLink to="/stock">
          <span className="icon">🏬</span>
          Склад
        </NavLink>
        <NavLink to="/notifications">
          <span className="icon">🔔</span>
          {unread > 0 ? <span className="badge">{unread}</span> : 'Эскертүү'}
        </NavLink>
        <NavLink to="/menu">
          <span className="icon">☰</span>
          Дагы
        </NavLink>
      </nav>
    </>
  );
}
