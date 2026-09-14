import { Routes, Route, Navigate } from 'react-router-dom';
import { LoginPage } from './pages/LoginPage.tsx';
import { UsersPage } from './pages/UsersPage.tsx';
import { ProtectedRoute } from './components/ProtectedRoute.tsx';
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
            <UsersPage />
          </ProtectedRoute>
        }
      />
      <Route path="/admin" element={<RootRedirect />} />
      <Route path="/" element={<RootRedirect />} />
      <Route path="*" element={<RootRedirect />} />
    </Routes>
  );
}
