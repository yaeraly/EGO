import { Navigate, Route, Routes } from 'react-router-dom';
import { AuthProvider, useAuth } from './auth/AuthContext';
import { AppShell } from './components/AppShell';
import { AccountsPage } from './pages/AccountsPage';
import { CargoPage, CargoListPage } from './pages/CargoPage';
import { CargoPaymentPage } from './pages/CargoPaymentPage';
import { CurrencyExchangePage } from './pages/CurrencyExchangePage';
import { LoginPage } from './pages/LoginPage';
import { NotificationsPage } from './pages/NotificationsPage';
import { PurchaseCardPage } from './pages/PurchaseCardPage';
import { PurchaseListPage } from './pages/PurchaseListPage';
import { SupplierPage, SupplierListPage } from './pages/SupplierPage';
import { SupplierPaymentPage } from './pages/SupplierPaymentPage';

export function App() {
  return (
    <AuthProvider>
      <Router />
    </AuthProvider>
  );
}

function Router() {
  const { user } = useAuth();

  if (!user) {
    return <LoginPage />;
  }

  return (
    <Routes>
      <Route element={<AppShell />}>
        <Route path="/" element={<Navigate to="/purchases" replace />} />
        <Route path="/purchases" element={<PurchaseListPage />} />
        <Route path="/purchases/:id" element={<PurchaseCardPage />} />
        <Route path="/suppliers" element={<SupplierListPage />} />
        <Route path="/suppliers/:id" element={<SupplierPage />} />
        <Route path="/supplier-payments/new" element={<SupplierPaymentPage />} />
        <Route path="/cargo" element={<CargoListPage />} />
        <Route path="/cargo/:id" element={<CargoPage />} />
        <Route path="/cargo-payments/new" element={<CargoPaymentPage />} />
        <Route path="/accounts" element={<AccountsPage />} />
        <Route path="/currency-exchange" element={<CurrencyExchangePage />} />
        <Route path="/notifications" element={<NotificationsPage />} />
        <Route path="*" element={<Navigate to="/purchases" replace />} />
      </Route>
    </Routes>
  );
}
