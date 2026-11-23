import { useEffect, useMemo, useState, type FormEvent } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import {
  AlertCircle,
  CheckCircle2,
  Eye,
  EyeOff,
  Loader2,
  Lock,
  Mail,
  RefreshCw,
  User as UserIcon,
} from 'lucide-react';
import { AuthLayout } from '@/components/auth/AuthLayout';
import { GoogleButton } from '@/components/ui/GoogleButton';
import { getDefaultRouteForRole, useAuth } from '@/contexts/AuthContext';
import { authApi, getFriendlyErrorMessage } from '@/lib/api';
import type { User } from '@/types/api';

function evaluatePasswordStrength(pw: string): {
  score: number;
  label: string;
  colorClass: string;
} {
  if (!pw) return { score: 0, label: '', colorClass: 'bg-[var(--border-subtle)]' };
  let score = 0;
  if (pw.length >= 8) score += 1;
  if (pw.length >= 12) score += 1;
  if (/[A-Z]/.test(pw) && /[a-z]/.test(pw)) score += 1;
  if (/\d/.test(pw) || /[^A-Za-z0-9]/.test(pw)) score += 1;

  if (score <= 1) return { score: 1, label: 'Fraca', colorClass: 'bg-[var(--danger)]' };
  if (score === 2) return { score: 2, label: 'Média', colorClass: 'bg-[var(--warning)]' };
  if (score === 3) return { score: 3, label: 'Boa', colorClass: 'bg-sky-500' };
  return { score: 4, label: 'Forte', colorClass: 'bg-[var(--success)]' };
}

export function RegisterPage() {
  const { user, register, startGoogleLogin, isInitializing } = useAuth();
  const navigate = useNavigate();

  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);

  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [createdUser, setCreatedUser] = useState<User | null>(null);
  const [resending, setResending] = useState(false);
  const [resentMessage, setResentMessage] = useState<string | null>(null);

  useEffect(() => {
    if (!isInitializing && user) {
      navigate(getDefaultRouteForRole(user.role), { replace: true });
    }
  }, [isInitializing, user, navigate]);

  const strength = useMemo(() => evaluatePasswordStrength(password), [password]);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);

    if (name.trim().length < 2) {
      setError('Informe seu nome completo.');
      return;
    }
    if (!email.trim() || !email.includes('@')) {
      setError('Informe um endereço de e-mail válido.');
      return;
    }
    if (password.length < 8) {
      setError('Use uma senha forte com pelo menos 8 caracteres.');
      return;
    }
    if (password !== confirmPassword) {
      setError('As senhas digitadas não coincidem.');
      return;
    }

    setSubmitting(true);
    try {
      const registered = await register({ name, email, password });
      setCreatedUser(registered);
    } catch (err) {
      setError(getFriendlyErrorMessage(err));
    } finally {
      setSubmitting(false);
    }
  }

  async function handleResend() {
    if (!createdUser) return;
    setResending(true);
    setResentMessage(null);
    setError(null);
    try {
      await authApi.resendVerification({ email: createdUser.email });
      setResentMessage('Enviamos um novo link de verificação para o seu e-mail.');
    } catch (err) {
      setError(getFriendlyErrorMessage(err));
    } finally {
      setResending(false);
    }
  }

  if (createdUser?.emailVerifiedAt) {
    return (
      <AuthLayout
        title="Conta criada"
        subtitle="Sua conta de demonstração já pode reservar mesas."
      >
        <Link
          to="/login"
          className="flex w-full items-center justify-center rounded-full bg-[var(--cta-bg)] px-6 py-3 text-sm font-semibold text-[var(--cta-text)] transition-colors hover:bg-[var(--cta-hover)]"
        >
          Ir para o login
        </Link>
      </AuthLayout>
    );
  }

  if (createdUser) {
    return (
      <AuthLayout
        title="Confirme seu e-mail"
        subtitle="Sua conta foi criada. Falta apenas um passo para liberar reservas de mesas."
      >
        <div className="space-y-5 text-center">
          <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-2xl border border-[var(--success)]/30 bg-[var(--success)]/12 text-[var(--success)]">
            <CheckCircle2 className="h-7 w-7" />
          </div>

          <div className="space-y-2">
            <p className="text-sm font-medium text-[var(--text-primary)]">
              Olá, {createdUser.name}!
            </p>
            <p className="text-xs leading-relaxed text-[var(--text-secondary)]">
              Enviamos uma mensagem de verificação para{' '}
              <span className="font-semibold text-[var(--text-primary)]">
                {createdUser.email}
              </span>
              . Somente contas com e-mail verificado podem reservar mesas nos eventos.
            </p>
          </div>

          {resentMessage && (
            <div className="rounded-2xl border border-[var(--success)]/30 bg-[var(--success)]/10 px-4 py-2.5 text-xs text-[var(--success)]">
              {resentMessage}
            </div>
          )}

          {error && (
            <div className="rounded-2xl border border-[var(--danger)]/35 bg-[var(--danger)]/10 px-4 py-2.5 text-xs text-[var(--danger)]">
              {error}
            </div>
          )}

          <div className="space-y-2.5 pt-2">
            <Link
              to={`/verificar-email?email=${encodeURIComponent(createdUser.email)}`}
              className="flex w-full items-center justify-center rounded-full bg-[var(--cta-bg)] px-6 py-3 text-sm font-semibold text-[var(--cta-text)] transition-colors hover:bg-[var(--cta-hover)]"
            >
              Inserir token de verificação
            </Link>

            <button
              type="button"
              onClick={handleResend}
              disabled={resending}
              className="flex w-full cursor-pointer items-center justify-center gap-2 rounded-full border border-[var(--border-strong)] bg-[var(--bg-elevated)] px-5 py-2.5 text-xs font-medium text-[var(--text-primary)] transition-colors hover:bg-[var(--bg-hover)] disabled:opacity-60"
            >
              <RefreshCw className={`h-3.5 w-3.5 ${resending ? 'animate-spin' : ''}`} />
              {resending ? 'Reenviando...' : 'Reenviar e-mail de verificação'}
            </button>

            <Link
              to="/login"
              className="block pt-2 text-xs font-medium text-[var(--text-secondary)] hover:text-[var(--text-primary)]"
            >
              Ir para o login
            </Link>
          </div>
        </div>
      </AuthLayout>
    );
  }

  return (
    <AuthLayout
      title="Crie sua conta"
      subtitle="Reserve mesas em segundos e acompanhe seus eventos favoritos."
      footer={
        <>
          Já possui uma conta?{' '}
          <Link
            to="/login"
            className="font-semibold text-[var(--text-primary)] underline decoration-[var(--border-strong)] underline-offset-4 transition-colors hover:text-[var(--accent)]"
          >
            Fazer login
          </Link>
        </>
      }
    >
      <div className="space-y-5">
        <GoogleButton onClick={startGoogleLogin} label="Continuar com o Google" />

        <div className="relative flex items-center py-1">
          <div className="flex-grow border-t border-[var(--border-subtle)]" />
          <span className="mx-3 shrink-0 text-[11px] font-medium tracking-wider text-[var(--text-muted)] uppercase">
            ou cadastre-se com e-mail
          </span>
          <div className="flex-grow border-t border-[var(--border-subtle)]" />
        </div>

        {error && (
          <div
            role="alert"
            className="flex items-start gap-2.5 rounded-2xl border border-[var(--danger)]/35 bg-[var(--danger)]/10 px-4 py-3 text-xs leading-relaxed text-[var(--danger)]"
          >
            <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
            <span>{error}</span>
          </div>
        )}

        <form onSubmit={handleSubmit} className="space-y-4" noValidate>
          <div className="space-y-1.5">
            <label
              htmlFor="register-name"
              className="block text-xs font-medium text-[var(--text-secondary)]"
            >
              Nome completo
            </label>
            <div className="relative">
              <UserIcon className="pointer-events-none absolute top-1/2 left-3.5 h-4 w-4 -translate-y-1/2 text-[var(--text-muted)]" />
              <input
                id="register-name"
                type="text"
                autoComplete="name"
                required
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="Ana Silva"
                className="w-full rounded-2xl border border-[var(--border-subtle)] bg-[var(--bg-elevated)] py-3 pr-4 pl-10 text-sm text-[var(--text-primary)] placeholder:text-[var(--text-muted)] transition-colors focus:border-[var(--text-secondary)] focus:outline-none"
              />
            </div>
          </div>

          <div className="space-y-1.5">
            <label
              htmlFor="register-email"
              className="block text-xs font-medium text-[var(--text-secondary)]"
            >
              E-mail
            </label>
            <div className="relative">
              <Mail className="pointer-events-none absolute top-1/2 left-3.5 h-4 w-4 -translate-y-1/2 text-[var(--text-muted)]" />
              <input
                id="register-email"
                type="email"
                autoComplete="email"
                required
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="ana@exemplo.com"
                className="w-full rounded-2xl border border-[var(--border-subtle)] bg-[var(--bg-elevated)] py-3 pr-4 pl-10 text-sm text-[var(--text-primary)] placeholder:text-[var(--text-muted)] transition-colors focus:border-[var(--text-secondary)] focus:outline-none"
              />
            </div>
          </div>

          <div className="space-y-1.5">
            <label
              htmlFor="register-password"
              className="block text-xs font-medium text-[var(--text-secondary)]"
            >
              Senha ou frase secreta
            </label>
            <div className="relative">
              <Lock className="pointer-events-none absolute top-1/2 left-3.5 h-4 w-4 -translate-y-1/2 text-[var(--text-muted)]" />
              <input
                id="register-password"
                type={showPassword ? 'text' : 'password'}
                autoComplete="new-password"
                required
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="Ex.: Uma frase longa e segura"
                className="w-full rounded-2xl border border-[var(--border-subtle)] bg-[var(--bg-elevated)] py-3 pr-11 pl-10 text-sm text-[var(--text-primary)] placeholder:text-[var(--text-muted)] transition-colors focus:border-[var(--text-secondary)] focus:outline-none"
              />
              <button
                type="button"
                onClick={() => setShowPassword((prev) => !prev)}
                aria-label={showPassword ? 'Ocultar senha' : 'Mostrar senha'}
                className="absolute top-1/2 right-3 -translate-y-1/2 cursor-pointer rounded-lg p-1 text-[var(--text-muted)] hover:text-[var(--text-primary)]"
              >
                {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
              </button>
            </div>
            {password && (
              <div className="space-y-1 pt-1">
                <div className="grid grid-cols-4 gap-1.5">
                  {[1, 2, 3, 4].map((step) => (
                    <div
                      key={step}
                      className={`h-1 rounded-full transition-colors ${
                        step <= strength.score
                          ? strength.colorClass
                          : 'bg-[var(--border-subtle)]'
                      }`}
                    />
                  ))}
                </div>
                <p className="text-[11px] text-[var(--text-muted)]">
                  Força da senha:{' '}
                  <span className="font-medium text-[var(--text-secondary)]">
                    {strength.label}
                  </span>
                </p>
              </div>
            )}
          </div>

          <div className="space-y-1.5">
            <label
              htmlFor="register-confirm"
              className="block text-xs font-medium text-[var(--text-secondary)]"
            >
              Confirmar senha
            </label>
            <div className="relative">
              <Lock className="pointer-events-none absolute top-1/2 left-3.5 h-4 w-4 -translate-y-1/2 text-[var(--text-muted)]" />
              <input
                id="register-confirm"
                type={showPassword ? 'text' : 'password'}
                autoComplete="new-password"
                required
                value={confirmPassword}
                onChange={(e) => setConfirmPassword(e.target.value)}
                placeholder="Repita sua senha"
                className="w-full rounded-2xl border border-[var(--border-subtle)] bg-[var(--bg-elevated)] py-3 pr-4 pl-10 text-sm text-[var(--text-primary)] placeholder:text-[var(--text-muted)] transition-colors focus:border-[var(--text-secondary)] focus:outline-none"
              />
            </div>
          </div>

          <button
            type="submit"
            disabled={submitting}
            className="mt-2 flex w-full cursor-pointer items-center justify-center gap-2 rounded-full bg-[var(--cta-bg)] px-6 py-3.5 text-sm font-semibold text-[var(--cta-text)] transition-all hover:bg-[var(--cta-hover)] active:scale-[0.99] disabled:cursor-not-allowed disabled:opacity-60"
          >
            {submitting ? (
              <>
                <Loader2 className="h-4 w-4 animate-spin" />
                Criando conta...
              </>
            ) : (
              'Criar conta'
            )}
          </button>
        </form>
      </div>
    </AuthLayout>
  );
}
