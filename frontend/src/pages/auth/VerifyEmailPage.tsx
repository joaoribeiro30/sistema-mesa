import { useEffect, useRef, useState, type FormEvent } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import {
  AlertCircle,
  CheckCircle2,
  KeyRound,
  Loader2,
  Mail,
  RefreshCw,
} from 'lucide-react';
import { AuthLayout } from '@/components/auth/AuthLayout';
import { useAuth } from '@/contexts/AuthContext';
import { authApi, getFriendlyErrorMessage } from '@/lib/api';

export function VerifyEmailPage() {
  const { user, refreshUser } = useAuth();
  const [searchParams] = useSearchParams();
  const initialToken = searchParams.get('token') ?? '';
  const initialEmail = searchParams.get('email') ?? user?.email ?? '';

  const [token, setToken] = useState(initialToken);
  const [email, setEmail] = useState(initialEmail);

  const [verifying, setVerifying] = useState(Boolean(initialToken));
  const [verified, setVerified] = useState(false);
  const [verifyError, setVerifyError] = useState<string | null>(null);

  const [resending, setResending] = useState(false);
  const [resendSuccess, setResendSuccess] = useState<string | null>(null);
  const [resendError, setResendError] = useState<string | null>(null);

  const autoTriggered = useRef(false);

  async function runVerification(rawToken: string) {
    setVerifyError(null);
    setVerifying(true);
    try {
      await authApi.verifyEmail({ token: rawToken.trim() });
      setVerified(true);
      if (user) {
        await refreshUser();
      }
    } catch (err) {
      setVerifyError(getFriendlyErrorMessage(err));
    } finally {
      setVerifying(false);
    }
  }

  useEffect(() => {
    if (initialToken && !autoTriggered.current) {
      autoTriggered.current = true;
      void runVerification(initialToken);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialToken]);

  async function handleVerifySubmit(e: FormEvent) {
    e.preventDefault();
    if (!token.trim()) {
      setVerifyError('Cole o token de verificação enviado para o seu e-mail.');
      return;
    }
    await runVerification(token);
  }

  async function handleResendSubmit(e: FormEvent) {
    e.preventDefault();
    setResendError(null);
    setResendSuccess(null);

    if (!email.trim() || !email.includes('@')) {
      setResendError('Informe um e-mail válido para reenvio.');
      return;
    }

    setResending(true);
    try {
      await authApi.resendVerification({ email: email.trim() });
      setResendSuccess(
        'Se o e-mail estiver pendente de confirmação, enviaremos um novo código em instantes.',
      );
    } catch (err) {
      setResendError(getFriendlyErrorMessage(err));
    } finally {
      setResending(false);
    }
  }

  return (
    <AuthLayout
      title="Verificar e-mail"
      subtitle="Confirme seu endereço de e-mail para liberar reservas de mesas nos eventos."
      footer={
        <>
          Já verificou sua conta?{' '}
          <Link
            to="/login"
            className="font-semibold text-[var(--text-primary)] underline decoration-[var(--border-strong)] underline-offset-4 transition-colors hover:text-[var(--accent)]"
          >
            Fazer login
          </Link>
        </>
      }
    >
      {verified ? (
        <div className="space-y-5 text-center">
          <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-2xl border border-[var(--success)]/30 bg-[var(--success)]/12 text-[var(--success)]">
            <CheckCircle2 className="h-7 w-7" />
          </div>
          <div className="space-y-2">
            <p className="text-sm font-semibold text-[var(--text-primary)]">
              E-mail confirmado com sucesso!
            </p>
            <p className="text-xs leading-relaxed text-[var(--text-secondary)]">
              Sua conta está verificada e pronta para reservar mesas em qualquer evento publicado.
            </p>
          </div>
          <Link
            to={user ? '/' : '/login'}
            className="flex w-full items-center justify-center rounded-full bg-[var(--cta-bg)] px-6 py-3 text-sm font-semibold text-[var(--cta-text)] transition-colors hover:bg-[var(--cta-hover)]"
          >
            {user ? 'Explorar eventos' : 'Entrar na conta'}
          </Link>
        </div>
      ) : (
        <div className="space-y-6">
          <form onSubmit={handleVerifySubmit} className="space-y-4" noValidate>
            {verifyError && (
              <div
                role="alert"
                className="flex items-start gap-2.5 rounded-2xl border border-[var(--danger)]/35 bg-[var(--danger)]/10 px-4 py-3 text-xs leading-relaxed text-[var(--danger)]"
              >
                <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
                <span>{verifyError}</span>
              </div>
            )}

            <div className="space-y-1.5">
              <label
                htmlFor="verify-token"
                className="block text-xs font-medium text-[var(--text-secondary)]"
              >
                Token de verificação
              </label>
              <div className="relative">
                <KeyRound className="pointer-events-none absolute top-1/2 left-3.5 h-4 w-4 -translate-y-1/2 text-[var(--text-muted)]" />
                <input
                  id="verify-token"
                  type="text"
                  required
                  value={token}
                  onChange={(e) => setToken(e.target.value)}
                  placeholder="Cole o token recebido no e-mail"
                  className="font-mono-num w-full rounded-2xl border border-[var(--border-subtle)] bg-[var(--bg-elevated)] py-3 pr-4 pl-10 text-xs text-[var(--text-primary)] placeholder:font-sans placeholder:text-sm placeholder:text-[var(--text-muted)] transition-colors focus:border-[var(--text-secondary)] focus:outline-none"
                />
              </div>
            </div>

            <button
              type="submit"
              disabled={verifying}
              className="flex w-full cursor-pointer items-center justify-center gap-2 rounded-full bg-[var(--cta-bg)] px-6 py-3 text-sm font-semibold text-[var(--cta-text)] transition-all hover:bg-[var(--cta-hover)] active:scale-[0.99] disabled:cursor-not-allowed disabled:opacity-60"
            >
              {verifying ? (
                <>
                  <Loader2 className="h-4 w-4 animate-spin" />
                  Validando token...
                </>
              ) : (
                'Confirmar e-mail'
              )}
            </button>
          </form>

          <div className="border-t border-[var(--border-subtle)] pt-5">
            <p className="mb-3 text-xs font-medium text-[var(--text-secondary)]">
              Não recebeu ou o link expirou? Reenviar confirmação:
            </p>
            <form onSubmit={handleResendSubmit} className="space-y-3" noValidate>
              {resendSuccess && (
                <div className="rounded-2xl border border-[var(--success)]/30 bg-[var(--success)]/10 px-3.5 py-2.5 text-xs text-[var(--success)]">
                  {resendSuccess}
                </div>
              )}
              {resendError && (
                <div className="rounded-2xl border border-[var(--danger)]/35 bg-[var(--danger)]/10 px-3.5 py-2.5 text-xs text-[var(--danger)]">
                  {resendError}
                </div>
              )}
              <div className="flex flex-col gap-2 sm:flex-row">
                <div className="relative flex-1">
                  <Mail className="pointer-events-none absolute top-1/2 left-3.5 h-4 w-4 -translate-y-1/2 text-[var(--text-muted)]" />
                  <input
                    type="email"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    placeholder="seu@email.com"
                    className="w-full rounded-full border border-[var(--border-subtle)] bg-[var(--bg-elevated)] py-2.5 pr-4 pl-10 text-xs text-[var(--text-primary)] placeholder:text-[var(--text-muted)] focus:border-[var(--text-secondary)] focus:outline-none"
                  />
                </div>
                <button
                  type="submit"
                  disabled={resending}
                  className="inline-flex cursor-pointer items-center justify-center gap-1.5 rounded-full border border-[var(--border-strong)] bg-[var(--bg-elevated)] px-4 py-2.5 text-xs font-medium text-[var(--text-primary)] transition-colors hover:bg-[var(--bg-hover)] disabled:opacity-60"
                >
                  <RefreshCw className={`h-3.5 w-3.5 ${resending ? 'animate-spin' : ''}`} />
                  Reenviar
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </AuthLayout>
  );
}
