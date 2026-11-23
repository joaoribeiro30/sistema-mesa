import { useEffect, useState, type FormEvent } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { AlertCircle, Eye, EyeOff, Loader2, Lock, Mail } from 'lucide-react';
import { AuthLayout } from '@/components/auth/AuthLayout';
import { GoogleButton } from '@/components/ui/GoogleButton';
import { getDefaultRouteForRole, useAuth } from '@/contexts/AuthContext';
import { getFriendlyErrorMessage } from '@/lib/api';
import type { User } from '@/types/api';

function resolvePostLoginPath(user: User, redirectParam: string | null): string {
  if (
    redirectParam &&
    redirectParam.startsWith('/') &&
    !redirectParam.startsWith('//')
  ) {
    if (redirectParam.startsWith('/admin') && user.role !== 'ADMIN') {
      return getDefaultRouteForRole(user.role);
    }
    return redirectParam;
  }
  return getDefaultRouteForRole(user.role);
}

export function LoginPage() {
  const { user, login, startGoogleLogin, isInitializing } = useAuth();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const redirectParam = searchParams.get('redirect');

  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!isInitializing && user) {
      navigate(resolvePostLoginPath(user, redirectParam), { replace: true });
    }
  }, [isInitializing, user, navigate, redirectParam]);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);

    if (!email.trim() || !password) {
      setError('Preencha seu e-mail e senha para continuar.');
      return;
    }

    setSubmitting(true);
    try {
      const loggedUser = await login({ email, password });
      navigate(resolvePostLoginPath(loggedUser, redirectParam), { replace: true });
    } catch (err) {
      setError(getFriendlyErrorMessage(err));
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <AuthLayout
      title="Bem-vindo de volta"
      subtitle="Entre com sua conta para gerenciar reservas ou administrar seus eventos."
      footer={
        <>
          Ainda não tem conta?{' '}
          <Link
            to="/cadastro"
            className="font-semibold text-[var(--text-primary)] underline decoration-[var(--border-strong)] underline-offset-4 transition-colors hover:text-[var(--accent)]"
          >
            Criar cadastro
          </Link>
        </>
      }
    >
      <div className="space-y-5">
        <GoogleButton onClick={startGoogleLogin} label="Entrar com o Google" />

        <div className="relative flex items-center py-1">
          <div className="flex-grow border-t border-[var(--border-subtle)]" />
          <span className="mx-3 shrink-0 text-[11px] font-medium tracking-wider text-[var(--text-muted)] uppercase">
            ou com e-mail
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
              htmlFor="login-email"
              className="block text-xs font-medium text-[var(--text-secondary)]"
            >
              E-mail
            </label>
            <div className="relative">
              <Mail className="pointer-events-none absolute top-1/2 left-3.5 h-4 w-4 -translate-y-1/2 text-[var(--text-muted)]" />
              <input
                id="login-email"
                type="email"
                autoComplete="email"
                required
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="voce@exemplo.com"
                className="w-full rounded-2xl border border-[var(--border-subtle)] bg-[var(--bg-elevated)] py-3 pr-4 pl-10 text-sm text-[var(--text-primary)] placeholder:text-[var(--text-muted)] transition-colors focus:border-[var(--text-secondary)] focus:outline-none"
              />
            </div>
          </div>

          <div className="space-y-1.5">
            <div className="flex items-center justify-between">
              <label
                htmlFor="login-password"
                className="block text-xs font-medium text-[var(--text-secondary)]"
              >
                Senha
              </label>
              <Link
                to="/recuperar-senha"
                className="text-xs font-medium text-[var(--text-secondary)] transition-colors hover:text-[var(--text-primary)]"
              >
                Esqueceu a senha?
              </Link>
            </div>
            <div className="relative">
              <Lock className="pointer-events-none absolute top-1/2 left-3.5 h-4 w-4 -translate-y-1/2 text-[var(--text-muted)]" />
              <input
                id="login-password"
                type={showPassword ? 'text' : 'password'}
                autoComplete="current-password"
                required
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="Sua senha"
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
          </div>

          <button
            type="submit"
            disabled={submitting}
            className="mt-2 flex w-full cursor-pointer items-center justify-center gap-2 rounded-full bg-[var(--cta-bg)] px-6 py-3.5 text-sm font-semibold text-[var(--cta-text)] transition-all hover:bg-[var(--cta-hover)] active:scale-[0.99] disabled:cursor-not-allowed disabled:opacity-60"
          >
            {submitting ? (
              <>
                <Loader2 className="h-4 w-4 animate-spin" />
                Entrando...
              </>
            ) : (
              'Entrar'
            )}
          </button>
        </form>

        <div className="pt-1 text-center">
          <Link
            to="/verificar-email"
            className="text-xs text-[var(--text-muted)] transition-colors hover:text-[var(--text-secondary)]"
          >
            Precisa confirmar seu e-mail? Verificar conta
          </Link>
        </div>
      </div>
    </AuthLayout>
  );
}
