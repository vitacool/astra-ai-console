import { Navigate, Outlet, Route, Routes, useLocation } from 'react-router-dom';
import { AppShell } from './components/AppShell';
import { LogoMark } from './components/Logo';
import { useAuth } from './context/AuthContext';
import { LoginPage } from './pages/LoginPage';
import { DashboardPage } from './pages/DashboardPage';
import { ChatPage } from './pages/ChatPage';
import { AssistantsPage } from './pages/AssistantsPage';
import { KnowledgePage } from './pages/KnowledgePage';
import { ProvidersPage } from './pages/ProvidersPage';
import { UsagePage } from './pages/UsagePage';
import { TeamPage } from './pages/TeamPage';
import { AuditPage } from './pages/AuditPage';
import { SettingsPage } from './pages/SettingsPage';

function Splash() {
  return (
    <div className="splash">
      <LogoMark size={54} />
      <div className="splash-word">ASTRA</div>
      <div className="splash-line">
        <span />
      </div>
    </div>
  );
}

function ProtectedRoute() {
  const { user, loading } = useAuth();
  const location = useLocation();
  if (loading) return <Splash />;
  if (!user) {
    return <Navigate to="/login" replace state={{ from: location }} />;
  }
  return <Outlet />;
}

function LoginRoute() {
  const { user, loading } = useAuth();
  if (loading) return <Splash />;
  if (user) return <Navigate to="/" replace />;
  return <LoginPage />;
}

export function App() {
  return (
    <Routes>
      <Route path="/login" element={<LoginRoute />} />
      <Route element={<ProtectedRoute />}>
        <Route element={<AppShell />}>
          <Route index element={<DashboardPage />} />
          <Route path="chat" element={<ChatPage />} />
          <Route path="assistants" element={<AssistantsPage />} />
          <Route path="knowledge" element={<KnowledgePage />} />
          <Route path="providers" element={<ProvidersPage />} />
          <Route path="usage" element={<UsagePage />} />
          <Route path="team" element={<TeamPage />} />
          <Route path="audit" element={<AuditPage />} />
          <Route path="settings" element={<SettingsPage />} />
        </Route>
      </Route>
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}
