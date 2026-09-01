import { Navigate, Route, Routes } from 'react-router-dom';
import { AuthProvider, useAuth } from './auth/AuthContext';
import { AppShell } from './components/AppShell';
import { AccountsPage } from './pages/AccountsPage';
import { CargoPage, CargoListPage } from './pages/CargoPage';
import { CargoPaymentPage } from './pages/CargoPaymentPage';
import { BonusesPage } from './pages/BonusesPage';
import { CorrectionsPage } from './pages/CorrectionsPage';
import { DayClosePage } from './pages/DayClosePage';
import { AnalyticsPage } from './pages/AnalyticsPage';
import { DashboardPage } from './pages/DashboardPage';
import { PerformancePage } from './pages/PerformancePage';
import { ReportsPage } from './pages/ReportsPage';
import { CurrencyExchangePage } from './pages/CurrencyExchangePage';
import { LoginPage } from './pages/LoginPage';
import { CustomerListPage, CustomerPage } from './pages/CustomersPage';
import { CustomerPaymentPage } from './pages/CustomerPaymentPage';
import { MenuPage } from './pages/MenuPage';
import { ApprovalsPage, MySalesPage } from './pages/MySalesPage';
import { SaleCheckoutPage } from './pages/SaleCheckoutPage';
import { SellPage } from './pages/SellPage';
import { NotificationsPage } from './pages/NotificationsPage';
import { PurchaseCardPage } from './pages/PurchaseCardPage';
import { PurchaseListPage } from './pages/PurchaseListPage';
import { SupplierPage, SupplierListPage } from './pages/SupplierPage';
import { SupplierPaymentPage } from './pages/SupplierPaymentPage';
import { ClaimListPage, ClaimPage } from './pages/ClaimPage';
import { DiscrepanciesPage, DiscrepancyPage } from './pages/DiscrepanciesPage';
import { ReceiptListPage } from './pages/ReceiptListPage';
import { ReceiptWizardPage } from './pages/ReceiptWizardPage';
import { CategoriesPage } from './pages/CategoriesPage';
import { ProductFormPage } from './pages/ProductFormPage';
import { ProductPage } from './pages/ProductPage';
import { DefectsPage, WriteOffsPage } from './pages/DefectsPage';
import { ExpensesPage } from './pages/ExpensesPage';
import { SalariesPage } from './pages/SalariesPage';
import { HandoverPage, HandoversPage } from './pages/HandoversPage';
import { InventoriesPage } from './pages/InventoriesPage';
import { InventoryPage } from './pages/InventoryPage';
import { ProductsPage } from './pages/ProductsPage';
import { ReturnFormPage, ReturnsPage } from './pages/ReturnsPage';
import { ReservationPage } from './pages/ReservationPage';
import {
  ReservationFormPage,
  ReservationsPage,
} from './pages/ReservationsPage';
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

  // §32: "OWNER системага киргенде негизги абалды бир экрандан көрүшү керек".
  // Everyone else lands where their work is — the counter (§1).
  const home = user.role === 'OWNER' ? '/dashboard' : '/sell';

  return (
    <Routes>
      <Route element={<AppShell />}>
        <Route path="/" element={<Navigate to={home} replace />} />
        <Route path="/sell" element={<SellPage />} />
        <Route path="/sell/:id" element={<SaleCheckoutPage />} />
        <Route path="/sales" element={<MySalesPage />} />
        <Route path="/approvals" element={<ApprovalsPage />} />
        <Route path="/customers" element={<CustomerListPage />} />
        <Route path="/customers/:id" element={<CustomerPage />} />
        <Route path="/customer-payments/new" element={<CustomerPaymentPage />} />
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
        <Route path="/products" element={<ProductsPage />} />
        <Route path="/products/new" element={<ProductFormPage />} />
        <Route path="/products/:id" element={<ProductPage />} />
        <Route path="/products/:id/edit" element={<ProductFormPage />} />
        <Route path="/categories" element={<CategoriesPage />} />
        <Route path="/reservations" element={<ReservationsPage />} />
        <Route path="/reservations/new" element={<ReservationFormPage />} />
        <Route path="/reservations/:id" element={<ReservationPage />} />
        <Route path="/inventories" element={<InventoriesPage />} />
        <Route path="/inventories/:id" element={<InventoryPage />} />
        <Route path="/handovers" element={<HandoversPage />} />
        <Route path="/handovers/:id" element={<HandoverPage />} />
        <Route path="/returns" element={<ReturnsPage />} />
        <Route path="/returns/new" element={<ReturnFormPage />} />
        <Route path="/defects" element={<DefectsPage />} />
        <Route path="/write-offs" element={<WriteOffsPage />} />
        <Route path="/expenses" element={<ExpensesPage />} />
        <Route path="/salaries" element={<SalariesPage />} />
        <Route path="/bonuses" element={<BonusesPage />} />
        <Route path="/corrections" element={<CorrectionsPage />} />
        <Route path="/day-close" element={<DayClosePage />} />
        <Route path="/reports" element={<ReportsPage />} />
        <Route path="/analytics" element={<AnalyticsPage />} />
        <Route path="/dashboard" element={<DashboardPage />} />
        <Route path="/performance" element={<PerformancePage />} />
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
        <Route path="*" element={<Navigate to={home} replace />} />
      </Route>
    </Routes>
  );
}
