import { useState, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { AlertTriangle, X } from 'lucide-react';
import { Header } from '@/components/layout/Header';
import { BrandLogo } from '@/components/ui/BrandLogo';
import { useAuth } from '@/contexts/AuthContext';

export function MainLayout({ children }: { children: ReactNode }) {
  const { user } = useAuth();
  const [bannerDismissed, setBannerDismissed] = useState(false);

  const showVerifyBanner =
    Boolean(user && !user.emailVerifiedAt) && !bannerDismissed;

  return (
    <div className="flex min-h-screen flex-col bg-[var(--bg-canvas)] text-[var(--text-primary)]">
      <Header />

      {showVerifyBanner && user && (
        <div className="border-b border-[var(--warning)]/25 bg-[var(--warning)]/10">
          <div className="mx-auto flex max-w-7xl items-center justify-between gap-3 px-4 py-2.5 text-xs sm:px-6 lg:px-8">
            <div className="flex items-center gap-2 text-[var(--text-primary)]">
              <AlertTriangle className="h-4 w-4 shrink-0 text-[var(--warning)]" />
              <span>
                Seu e-mail ainda não foi verificado. Confirme sua conta para poder reservar mesas.
              </span>
              <Link
                to={`/verificar-email?email=${encodeURIComponent(user.email)}`}
                className="ml-1 font-semibold text-[var(--warning)] underline underline-offset-4 hover:opacity-80"
              >
                Verificar agora
              </Link>
            </div>
            <button
              type="button"
              onClick={() => setBannerDismissed(true)}
              aria-label="Fechar aviso"
              className="cursor-pointer rounded-lg p-1 text-[var(--text-secondary)] hover:text-[var(--text-primary)]"
            >
              <X className="h-3.5 w-3.5" />
            </button>
          </div>
        </div>
      )}

      <main className="flex-1">{children}</main>

      <footer className="mt-20 border-t border-[var(--border-subtle)] bg-[var(--bg-surface)]/50">
        <div className="mx-auto flex max-w-7xl flex-col gap-6 px-4 py-10 sm:flex-row sm:items-center sm:justify-between sm:px-6 lg:px-8">
          <div className="space-y-2">
            <BrandLogo />
            <p className="max-w-sm text-xs text-[var(--text-muted)]">
              Descubra eventos selecionados e garanta sua mesa em tempo real com checkout rápido e ingresso digital.
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-5 text-xs text-[var(--text-secondary)]">
            <Link to="/" className="transition-colors hover:text-[var(--text-primary)]">
              Eventos
            </Link>
            <Link
              to="/minhas-reservas"
              className="transition-colors hover:text-[var(--text-primary)]"
            >
              Minhas Reservas
            </Link>
            <Link to="/login" className="transition-colors hover:text-[var(--text-primary)]">
              Entrar
            </Link>
            <Link
              to="/cadastro"
              className="transition-colors hover:text-[var(--text-primary)]"
            >
              Cadastrar
            </Link>
          </div>
        </div>
      </footer>
    </div>
  );
}
