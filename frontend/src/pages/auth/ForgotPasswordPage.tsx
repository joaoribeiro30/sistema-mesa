import { useState, type FormEvent } from 'react';
import { Link } from 'react-router-dom';
import { AlertCircle, CheckCircle2, Loader2, Mail } from 'lucide-react';
import { AuthLayout } from '@/components/auth/AuthLayout';
import { authApi, getFriendlyErrorMessage } from '@/lib/api';

export function ForgotPasswordPage() {
  const [email, setEmail] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);

    if (!email.trim() || !email.includes('@')) {
      setError('Informe um e-mail válido para enviarmos as instruções.');
      return;
    }

    setSubmitting(true);
    try {
      await authApi.forgotPassword({ email: email.trim() });
      setSubmitted(true);
    } catch (err) {
      setError(getFriendlyErrorMessage(err));
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <AuthLayout
      title="Recuperar senha"
      subtitle="Informe o e-mail da sua conta para receber o link ou token de redefinição."
      footer={
        <>
          Lembrou a senha?{' '}
          <Link
            to="/login"
            className="font-semibold text-[var(--text-primary)] underline decoration-[var(--border-strong)] underline-offset-4 transition-colors hover:text-[var(--accent)]"
          >
            Voltar ao login
          </Link>
        </>
      }
    >
      {submitted ? (
        <div className="space-y-5 text-center">
          <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-2xl border border-[var(--success)]/30 bg-[var(--success)]/12 text-[var(--success)]">
            <CheckCircle2 className="h-7 w-7" />
          </div>
          <div className="space-y-2">
            <p className="text-sm font-semibold text-[var(--text-primary)]">
              Solicitação enviada
            </p>
            <p className="text-xs leading-relaxed text-[var(--text-secondary)]">
              Se existir uma conta vinculada a{' '}
              <span className="font-medium text-[var(--text-primary)]">{email}</span>,
              você receberá as instruções para redefinir sua senha em instantes.
            </p>
          </div>
          <div className="space-y-2.5 pt-2">
            <Link
              to="/redefinir-senha"
              className="flex w-full items-center justify-center rounded-full bg-[var(--cta-bg)] px-6 py-3 text-sm font-semibold text-[var(--cta-text)] transition-colors hover:bg-[var(--cta-hover)]"
            >
              Já tenho o token de recuperação
            </Link>
            <Link
              to="/login"
              className="block pt-1 text-xs font-medium text-[var(--text-secondary)] hover:text-[var(--text-primary)]"
            >
              Retornar ao login
            </Link>
          </div>
        </div>
      ) : (
        <form onSubmit={handleSubmit} className="space-y-4" noValidate>
          {error && (
            <div
              role="alert"
              className="flex items-start gap-2.5 rounded-2xl border border-[var(--danger)]/35 bg-[var(--danger)]/10 px-4 py-3 text-xs leading-relaxed text-[var(--danger)]"
            >
              <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
              <span>{error}</span>
            </div>
          )}

          <div className="space-y-1.5">
            <label
              htmlFor="forgot-email"
              className="block text-xs font-medium text-[var(--text-secondary)]"
            >
              E-mail cadastrado
            </label>
            <div className="relative">
              <Mail className="pointer-events-none absolute top-1/2 left-3.5 h-4 w-4 -translate-y-1/2 text-[var(--text-muted)]" />
              <input
                id="forgot-email"
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

          <button
            type="submit"
            disabled={submitting}
            className="mt-2 flex w-full cursor-pointer items-center justify-center gap-2 rounded-full bg-[var(--cta-bg)] px-6 py-3.5 text-sm font-semibold text-[var(--cta-text)] transition-all hover:bg-[var(--cta-hover)] active:scale-[0.99] disabled:cursor-not-allowed disabled:opacity-60"
          >
            {submitting ? (
              <>
                <Loader2 className="h-4 w-4 animate-spin" />
                Enviando...
              </>
            ) : (
              'Enviar instruções'
            )}
          </button>

          <div className="pt-1 text-center">
            <Link
              to="/redefinir-senha"
              className="text-xs text-[var(--text-muted)] hover:text-[var(--text-secondary)]"
            >
              Já possui um token? Redefinir senha agora
            </Link>
          </div>
        </form>
      )}
    </AuthLayout>
  );
}
