import { Navigate, Route, Routes } from 'react-router-dom';
import { AuthProvider, useAuth } from './auth/AuthContext';
import { AppShell } from './components/AppShell';
import { AccountsPage } from './pages/AccountsPage';
import { CargoPage, CargoListPage } from './pages/CargoPage';
import { CargoPaymentPage } from './pages/CargoPaymentPage';
import { CurrencyExchangePage } from './pages/CurrencyExchangePage';
import { LoginPage } from './pages/LoginPage';
import { MenuPage } from './pages/MenuPage';
import { NotificationsPage } from './pages/NotificationsPage';
import { PurchaseCardPage } from './pages/PurchaseCardPage';
import { PurchaseListPage } from './pages/PurchaseListPage';
import { SupplierPage, SupplierListPage } from './pages/SupplierPage';
import { SupplierPaymentPage } from './pages/SupplierPaymentPage';
import { ClaimListPage, ClaimPage } from './pages/ClaimPage';
import { DiscrepanciesPage, DiscrepancyPage } from './pages/DiscrepanciesPage';
import { ReceiptListPage } from './pages/ReceiptListPage';
import { ReceiptWizardPage } from './pages/ReceiptWizardPage';
import { ProductStockPage, StockPage } from './pages/StockPage';
import { TransfersPage, WarehousesPage } from './pages/TransfersPage';

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
        <Route path="/receipts" element={<ReceiptListPage />} />
        <Route path="/receipts/:id" element={<ReceiptWizardPage />} />
        <Route path="/stock" element={<StockPage />} />
        <Route path="/stock/products/:id" element={<ProductStockPage />} />
        <Route path="/warehouses" element={<WarehousesPage />} />
        <Route path="/transfers" element={<TransfersPage />} />
        <Route path="/discrepancies" element={<DiscrepanciesPage />} />
        <Route path="/discrepancies/:id" element={<DiscrepancyPage />} />
        <Route path="/claims" element={<ClaimListPage />} />
        <Route path="/claims/:id" element={<ClaimPage />} />
        <Route path="/notifications" element={<NotificationsPage />} />
        <Route path="/menu" element={<MenuPage />} />
        <Route path="*" element={<Navigate to="/purchases" replace />} />
      </Route>
    </Routes>
  );
}
