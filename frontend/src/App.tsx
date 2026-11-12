import { Navigate, Route, Routes } from 'react-router-dom';

import './App.css';
import { Layout, ProtectedRoute } from './components/Layout';
import { LoginPage, RegisterPage } from './pages/AuthPages';
import { DashboardPage } from './pages/DashboardPage';
import { InventoryPage } from './pages/InventoryPage';
import { SalesPage } from './pages/SalesPage';
import { AlertsPage } from './pages/AlertsPage';
import { ForecastPage } from './pages/ForecastPage';
import { MovementsPage } from './pages/MovementsPage';
import { TeamPage } from './pages/TeamPage';

const App = () => (
  <Routes>
    <Route path="/login" element={<LoginPage />} />
    <Route path="/register" element={<RegisterPage />} />

    <Route element={<ProtectedRoute />}>
      <Route element={<Layout />}>
        <Route index element={<DashboardPage />} />
        <Route path="inventory" element={<InventoryPage />} />
        <Route path="sales" element={<SalesPage />} />
        <Route path="alerts" element={<AlertsPage />} />
        <Route path="forecast" element={<ForecastPage />} />
        <Route path="movements" element={<MovementsPage />} />
        <Route element={<ProtectedRoute adminOnly />}>
          <Route path="team" element={<TeamPage />} />
        </Route>
      </Route>
    </Route>

    <Route path="*" element={<Navigate to="/" replace />} />
  </Routes>
);

export default App;
