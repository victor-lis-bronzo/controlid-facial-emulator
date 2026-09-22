import { Routes, Route, Navigate } from 'react-router-dom';
import { LoginPage } from './pages/LoginPage.tsx';
import { UsersPage } from './pages/UsersPage.tsx';
import { GroupsPage } from './pages/GroupsPage.tsx';
import { TimeZonesPage } from './pages/TimeZonesPage.tsx';
import { PortalsPage } from './pages/PortalsPage.tsx';
import { ProtectedRoute } from './components/ProtectedRoute.tsx';
import { WebGuiLayout } from './components/WebGuiLayout.tsx';
import { useAuth } from './context/AuthContext.tsx';

function RootRedirect() {
  const { isAuthenticated } = useAuth();
  return <Navigate to={isAuthenticated ? '/admin/users' : '/admin/login'} replace />;
}

export function AppRouter() {
  return (
    <Routes>
      <Route path="/admin/login" element={<LoginPage />} />
      <Route
        path="/admin/users"
        element={
          <ProtectedRoute>
            <WebGuiLayout>
              <UsersPage />
            </WebGuiLayout>
          </ProtectedRoute>
        }
      />
      <Route
        path="/admin/groups"
        element={
          <ProtectedRoute>
            <WebGuiLayout>
              <GroupsPage />
            </WebGuiLayout>
          </ProtectedRoute>
        }
      />
      <Route
        path="/admin/time-zones"
        element={
          <ProtectedRoute>
            <WebGuiLayout>
              <TimeZonesPage />
            </WebGuiLayout>
          </ProtectedRoute>
        }
      />
      <Route
        path="/admin/portals"
        element={
          <ProtectedRoute>
            <WebGuiLayout>
              <PortalsPage />
            </WebGuiLayout>
          </ProtectedRoute>
        }
      />
      <Route path="/admin" element={<RootRedirect />} />
      <Route path="/" element={<RootRedirect />} />
      <Route path="*" element={<RootRedirect />} />
    </Routes>
  );
}
