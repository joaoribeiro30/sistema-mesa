import { lazy, Suspense } from 'react';
import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom';
import { ProtectedRoute } from '@/components/auth/ProtectedRoute';
import { MainLayout } from '@/components/layout/MainLayout';
import { AuthProvider } from '@/contexts/AuthContext';
import { EventDetailPage } from '@/pages/EventDetailPage';
import { HomePage } from '@/pages/HomePage';
import { MyReservationsPage } from '@/pages/MyReservationsPage';
import { ForgotPasswordPage } from '@/pages/auth/ForgotPasswordPage';
import { GoogleCallbackPage } from '@/pages/auth/GoogleCallbackPage';
import { LoginPage } from '@/pages/auth/LoginPage';
import { RegisterPage } from '@/pages/auth/RegisterPage';
import { ResetPasswordPage } from '@/pages/auth/ResetPasswordPage';
import { VerifyEmailPage } from '@/pages/auth/VerifyEmailPage';

const AdminDashboardPage = lazy(async () => {
  const { AdminDashboardPage } = await import('@/pages/AdminDashboardPage');
  return { default: AdminDashboardPage };
});

export function App() {
  return (
    <AuthProvider>
      <BrowserRouter>
        <Routes>
          {/* Public Catalog & Authenticated Shell */}
          <Route
            path="/"
            element={
              <MainLayout>
                <HomePage />
              </MainLayout>
            }
          />
          <Route
            path="/eventos/:slug"
            element={
              <MainLayout>
                <EventDetailPage />
              </MainLayout>
            }
          />
          <Route
            path="/minhas-reservas"
            element={
              <MainLayout>
                <ProtectedRoute>
                  <MyReservationsPage />
                </ProtectedRoute>
              </MainLayout>
            }
          />
          <Route
            path="/admin"
            element={
              <MainLayout>
                <ProtectedRoute allowedRoles={['ADMIN']}>
                  <Suspense fallback={<p role="status" className="p-6 text-sm text-[var(--text-secondary)]">Carregando painel administrativo…</p>}>
                    <AdminDashboardPage />
                  </Suspense>
                </ProtectedRoute>
              </MainLayout>
            }
          />

          {/* Authentication Routes */}
          <Route path="/login" element={<LoginPage />} />
          <Route path="/cadastro" element={<RegisterPage />} />
          <Route path="/recuperar-senha" element={<ForgotPasswordPage />} />
          <Route path="/redefinir-senha" element={<ResetPasswordPage />} />
          <Route path="/verificar-email" element={<VerifyEmailPage />} />
          <Route path="/auth/callback" element={<GoogleCallbackPage />} />

          {/* Fallback */}
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </BrowserRouter>
    </AuthProvider>
  );
}
