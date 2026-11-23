import type { ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { ArrowLeft, ShieldCheck, Sparkles, Ticket } from 'lucide-react';
import { BrandLogo } from '@/components/ui/BrandLogo';

interface AuthLayoutProps {
  title: string;
  subtitle: string;
  children: ReactNode;
  footer?: ReactNode;
}

export function AuthLayout({ title, subtitle, children, footer }: AuthLayoutProps) {
  return (
    <div className="relative min-h-screen bg-[var(--bg-canvas)] text-[var(--text-primary)] lg:grid lg:grid-cols-12">
      {/* Left editorial showcase (desktop) */}
      <aside className="relative hidden overflow-hidden border-r border-[var(--border-subtle)] bg-[var(--bg-surface)] p-10 lg:col-span-5 lg:flex lg:flex-col lg:justify-between xl:p-14">
        <div
          className="pointer-events-none absolute inset-0"
          style={{
            backgroundImage: 'radial-gradient(ellipse at 12% 18%, var(--accent-soft), transparent 60%)',
          }}
        />
        <div className="relative z-10 flex items-center justify-between">
          <Link to="/" className="group inline-flex items-center">
            <BrandLogo />
          </Link>

          <span className="inline-flex items-center gap-1.5 rounded-full border border-[var(--border-subtle)] bg-[var(--bg-surface)] px-3 py-1 text-[11px] font-medium tracking-wide text-[var(--text-secondary)]">
            <span className="h-1.5 w-1.5 rounded-full bg-[var(--success)]" />
            Em tempo real
          </span>
        </div>

        <div className="relative z-10 my-auto max-w-md space-y-6">
          <p className="inline-flex items-center gap-2 text-xs font-semibold tracking-[0.18em] text-[var(--accent)] uppercase">
            <Sparkles className="h-3.5 w-3.5" />
            Experiências & Mesas VIP
          </p>
          <h2 className="font-display text-4xl leading-[1.08] font-bold tracking-tight xl:text-[42px]">
            Escolha sua mesa no mapa. Sem filas, sem surpresas.
          </h2>
          <p className="text-sm leading-relaxed text-[var(--text-secondary)]">
            Descubra os melhores eventos da sua cidade, reserve mesas em tempo real com bloqueio seguro e acesse seu ingresso digital com QR Code instantâneo.
          </p>

          <div className="grid grid-cols-2 gap-3 pt-2">
            <div className="rounded-2xl border border-[var(--border-subtle)] bg-[var(--bg-surface)] p-4">
              <Ticket className="mb-2.5 h-4 w-4 text-[var(--accent)]" />
              <p className="text-xs font-semibold">Comprovante QR</p>
              <p className="mt-1 text-[11px] text-[var(--text-secondary)]">
                Check-in rápido direto na portaria do evento.
              </p>
            </div>
            <div className="rounded-2xl border border-[var(--border-subtle)] bg-[var(--bg-surface)] p-4">
              <ShieldCheck className="mb-2.5 h-4 w-4 text-[var(--success)]" />
              <p className="text-xs font-semibold">Reserva protegida</p>
              <p className="mt-1 text-[11px] text-[var(--text-secondary)]">
                Bloqueio exclusivo por 10 min enquanto você conclui o Pix ou cartão.
              </p>
            </div>
          </div>
        </div>

        <p className="relative z-10 text-xs text-[var(--text-muted)]">
          © {new Date().getFullYear()} Sistema Mesa · Plataforma de eventos e reservas
        </p>
      </aside>

      {/* Right form container */}
      <main className="flex min-h-screen flex-col justify-between px-5 py-6 sm:px-8 lg:col-span-7 lg:px-14 lg:py-10">
        <div className="flex items-center gap-4">
          <Link
            to="/"
            className="inline-flex items-center gap-2 rounded-full border border-[var(--border-subtle)] bg-[var(--bg-surface)] px-3.5 py-2 text-xs font-medium text-[var(--text-secondary)] transition-colors hover:border-[var(--border-strong)] hover:text-[var(--text-primary)]"
          >
            <ArrowLeft className="h-3.5 w-3.5" />
            Explorar eventos
          </Link>
          <Link to="/" aria-label="MESA" className="group lg:hidden">
            <BrandLogo compact />
          </Link>
        </div>

        <div className="mx-auto my-8 w-full max-w-[420px]">
          <div className="mb-7 space-y-2">
            <h1 className="font-display text-3xl font-bold tracking-tight text-[var(--text-primary)]">
              {title}
            </h1>
            <p className="text-sm text-[var(--text-secondary)]">{subtitle}</p>
          </div>

          <div className="rounded-3xl border border-[var(--border-subtle)] bg-[var(--bg-surface)] p-6 shadow-[var(--shadow-elevated)] sm:p-8">
            {children}
          </div>

          {footer && (
            <div className="mt-6 text-center text-sm text-[var(--text-secondary)]">
              {footer}
            </div>
          )}
        </div>

        <div className="text-center text-xs text-[var(--text-muted)] lg:text-left">
          Acesso seguro com criptografia e sessão protegida.
        </div>
      </main>
    </div>
  );
}
