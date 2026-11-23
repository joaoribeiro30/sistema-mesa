import type { ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { ArrowLeft, Moon, ShieldCheck, Sparkles, Sun, Ticket } from 'lucide-react';
import { BrandLogo } from '@/components/ui/BrandLogo';
import { useTheme } from '@/contexts/ThemeContext';

interface AuthLayoutProps {
  title: string;
  subtitle: string;
  children: ReactNode;
  footer?: ReactNode;
}

export function AuthLayout({ title, subtitle, children, footer }: AuthLayoutProps) {
  const { isDark, toggleTheme } = useTheme();

  return (
    <div className="relative min-h-screen bg-[var(--bg-canvas)] text-[var(--text-primary)] lg:grid lg:grid-cols-12">
      {/* Left editorial showcase (desktop) */}
      <aside className="relative hidden overflow-hidden border-r border-[var(--border-subtle)] bg-[#0b0b10] p-10 text-white lg:col-span-5 lg:flex lg:flex-col lg:justify-between xl:p-14">
        <div
          className="pointer-events-none absolute inset-0 opacity-80"
          style={{
            background:
              'radial-gradient(circle at 18% 20%, rgba(255,51,102,0.28), transparent 45%), radial-gradient(circle at 82% 78%, rgba(124,92,255,0.22), transparent 48%), linear-gradient(180deg, rgba(11,11,16,0.2) 0%, rgba(8,8,10,0.95) 100%)',
          }}
        />
        <div className="relative z-10 flex items-center justify-between">
          <Link to="/" className="group inline-flex items-center">
            <span className="inline-flex items-center gap-2.5">
              <span className="flex h-8 w-8 items-center justify-center rounded-xl bg-white text-[#08080a]">
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none">
                  <rect x="3" y="4" width="18" height="4.5" rx="2.25" fill="currentColor" />
                  <path d="M6.5 11.5H17.5" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" />
                  <path d="M7.5 11.5V19.5M16.5 11.5V19.5" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" />
                  <circle cx="19" cy="18" r="2.25" fill="#FF3366" />
                </svg>
              </span>
              <span className="font-display text-[17px] font-bold tracking-[0.14em] text-white">
                MESA
              </span>
            </span>
          </Link>

          <span className="inline-flex items-center gap-1.5 rounded-full border border-white/15 bg-white/5 px-3 py-1 text-[11px] font-medium tracking-wide text-white/80 backdrop-blur-md">
            <span className="h-1.5 w-1.5 rounded-full bg-[#10b981]" />
            Em tempo real
          </span>
        </div>

        <div className="relative z-10 my-auto max-w-md space-y-6">
          <p className="inline-flex items-center gap-2 text-xs font-semibold tracking-[0.18em] text-[#ff5c85] uppercase">
            <Sparkles className="h-3.5 w-3.5" />
            Experiências & Mesas VIP
          </p>
          <h2 className="font-display text-4xl leading-[1.08] font-bold tracking-tight text-white xl:text-[42px]">
            Escolha sua mesa no mapa. Sem filas, sem surpresas.
          </h2>
          <p className="text-sm leading-relaxed text-white/65">
            Descubra os melhores eventos da sua cidade, reserve mesas em tempo real com bloqueio seguro e acesse seu ingresso digital com QR Code instantâneo.
          </p>

          <div className="grid grid-cols-2 gap-3 pt-2">
            <div className="rounded-2xl border border-white/10 bg-white/[0.04] p-4 backdrop-blur-md">
              <Ticket className="mb-2.5 h-4 w-4 text-[#ff5c85]" />
              <p className="text-xs font-semibold text-white">Comprovante QR</p>
              <p className="mt-1 text-[11px] text-white/55">
                Check-in rápido direto na portaria do evento.
              </p>
            </div>
            <div className="rounded-2xl border border-white/10 bg-white/[0.04] p-4 backdrop-blur-md">
              <ShieldCheck className="mb-2.5 h-4 w-4 text-[#10b981]" />
              <p className="text-xs font-semibold text-white">Reserva protegida</p>
              <p className="mt-1 text-[11px] text-white/55">
                Bloqueio exclusivo por 10 min enquanto você conclui o Pix ou cartão.
              </p>
            </div>
          </div>
        </div>

        <p className="relative z-10 text-xs text-white/40">
          © {new Date().getFullYear()} Sistema Mesa · Plataforma de eventos e reservas
        </p>
      </aside>

      {/* Right form container */}
      <main className="flex min-h-screen flex-col justify-between px-5 py-6 sm:px-8 lg:col-span-7 lg:px-14 lg:py-10">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-4">
            <Link
              to="/"
              className="inline-flex items-center gap-2 rounded-full border border-[var(--border-subtle)] bg-[var(--bg-surface)] px-3.5 py-2 text-xs font-medium text-[var(--text-secondary)] transition-colors hover:border-[var(--border-strong)] hover:text-[var(--text-primary)]"
            >
              <ArrowLeft className="h-3.5 w-3.5" />
              Explorar eventos
            </Link>
            <Link to="/" className="group lg:hidden">
              <BrandLogo compact />
            </Link>
          </div>

          <button
            type="button"
            onClick={toggleTheme}
            aria-label={isDark ? 'Ativar tema claro' : 'Ativar tema escuro'}
            className="flex h-9 w-9 cursor-pointer items-center justify-center rounded-full border border-[var(--border-subtle)] bg-[var(--bg-surface)] text-[var(--text-secondary)] transition-colors hover:border-[var(--border-strong)] hover:text-[var(--text-primary)]"
          >
            {isDark ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />}
          </button>
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
