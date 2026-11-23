import { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { AlertCircle, Loader2 } from 'lucide-react';
import { AuthLayout } from '@/components/auth/AuthLayout';
import { getDefaultRouteForRole, useAuth } from '@/contexts/AuthContext';

export function GoogleCallbackPage() {
  const { refreshUser } = useAuth();
  const navigate = useNavigate();
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let active = true;

    async function completeOAuth() {
      const user = await refreshUser();
      if (!active) return;

      if (user) {
        navigate(getDefaultRouteForRole(user.role), { replace: true });
      } else {
        setFailed(true);
      }
    }

    void completeOAuth();
    return () => {
      active = false;
    };
  }, [refreshUser, navigate]);

  return (
    <AuthLayout
      title={failed ? 'Sessão não encontrada' : 'Finalizando login com Google'}
      subtitle={
        failed
          ? 'Não foi possível validar sua sessão do Google neste momento.'
          : 'Verificando suas credenciais e redirecionando para a sua conta.'
      }
    >
      {failed ? (
        <div className="space-y-5 text-center">
          <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-2xl border border-[var(--danger)]/30 bg-[var(--danger)]/10 text-[var(--danger)]">
            <AlertCircle className="h-6 w-6" />
          </div>
          <p className="text-xs leading-relaxed text-[var(--text-secondary)]">
            Verifique se os cookies do navegador estão habilitados e tente entrar novamente.
          </p>
          <Link
            to="/login"
            className="flex w-full items-center justify-center rounded-full bg-[var(--cta-bg)] px-6 py-3 text-sm font-semibold text-[var(--cta-text)] transition-colors hover:bg-[var(--cta-hover)]"
          >
            Voltar ao login
          </Link>
        </div>
      ) : (
        <div className="flex flex-col items-center gap-4 py-6">
          <Loader2 className="h-7 w-7 animate-spin text-[var(--accent)]" />
          <p className="text-sm text-[var(--text-secondary)]">
            Sincronizando sua sessão...
          </p>
        </div>
      )}
    </AuthLayout>
  );
}
