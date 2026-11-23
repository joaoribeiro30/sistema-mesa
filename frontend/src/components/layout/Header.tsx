import { useEffect, useRef, useState, type FormEvent } from 'react';
import {
  Link,
  NavLink,
  useLocation,
  useNavigate,
  useSearchParams,
} from 'react-router-dom';
import {
  Calendar,
  LogOut,
  Menu,
  Search,
  Shield,
  Ticket,
  User as UserIcon,
  X,
} from 'lucide-react';
import { BrandLogo } from '@/components/ui/BrandLogo';
import { useAuth } from '@/contexts/AuthContext';

function parseBrazilDateToInput(raw: string): string | null {
  const trimmed = raw.trim();
  // Match YYYY-MM-DD
  if (/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) {
    return trimmed;
  }
  // Match DD/MM/YYYY
  const br = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(trimmed);
  if (br) {
    const [, dd, mm, yyyy] = br;
    return `${yyyy}-${mm}-${dd}`;
  }
  return null;
}

export function Header() {
  const { user, isAuthenticated, isAdmin, logout } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const [searchParams] = useSearchParams();

  const [query, setQuery] = useState(() => searchParams.get('q') ?? '');
  const [dateFilter, setDateFilter] = useState(
    () => searchParams.get('fromDate') ?? '',
  );
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [mobileSearchOpen, setMobileSearchOpen] = useState(false);
  const [userMenuOpen, setUserMenuOpen] = useState(false);

  const searchInputRef = useRef<HTMLInputElement>(null);
  const mobileSearchInputRef = useRef<HTMLInputElement>(null);
  const userMenuRef = useRef<HTMLDivElement>(null);

  // Sync local search inputs when URL changes on Home
  useEffect(() => {
    if (location.pathname === '/') {
      setQuery(searchParams.get('q') ?? '');
      const urlFrom = searchParams.get('fromDate') ?? '';
      const urlTo = searchParams.get('toDate') ?? '';
      setDateFilter(urlFrom && urlFrom === urlTo ? urlFrom : urlFrom);
    }
  }, [location.pathname, searchParams]);

  // Close menus on route navigation
  useEffect(() => {
    setMobileMenuOpen(false);
    setMobileSearchOpen(false);
    setUserMenuOpen(false);
  }, [location.pathname]);

  // Keyboard shortcut Ctrl/Cmd+K to focus quick search
  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        searchInputRef.current?.focus();
      }
    }
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, []);

  // Auto-focus expandable mobile search input when opened
  useEffect(() => {
    if (mobileSearchOpen) {
      mobileSearchInputRef.current?.focus();
    }
  }, [mobileSearchOpen]);

  // Close mobile drawers on Escape
  useEffect(() => {
    if (!mobileMenuOpen && !mobileSearchOpen) return;
    function onEscape(e: KeyboardEvent) {
      if (e.key === 'Escape') {
        setMobileMenuOpen(false);
        setMobileSearchOpen(false);
      }
    }
    window.addEventListener('keydown', onEscape);
    return () => window.removeEventListener('keydown', onEscape);
  }, [mobileMenuOpen, mobileSearchOpen]);

  // Click outside user menu
  useEffect(() => {
    if (!userMenuOpen) return;
    function onClickOutside(e: MouseEvent) {
      if (userMenuRef.current && !userMenuRef.current.contains(e.target as Node)) {
        setUserMenuOpen(false);
      }
    }
    document.addEventListener('mousedown', onClickOutside);
    return () => document.removeEventListener('mousedown', onClickOutside);
  }, [userMenuOpen]);

  function applyQuickSearch(nextQuery: string, nextDate: string) {
    const params = new URLSearchParams(
      location.pathname === '/' ? searchParams : undefined,
    );

    const parsedDateFromText = parseBrazilDateToInput(nextQuery);
    const effectiveDate = nextDate || parsedDateFromText || '';
    const effectiveText = parsedDateFromText ? '' : nextQuery.trim();

    if (effectiveText) {
      params.set('q', effectiveText);
    } else {
      params.delete('q');
    }

    if (effectiveDate) {
      params.set('fromDate', effectiveDate);
      params.set('toDate', effectiveDate);
    } else if (nextDate === '' && params.get('fromDate') === params.get('toDate')) {
      params.delete('fromDate');
      params.delete('toDate');
    }

    const qs = params.toString();
    navigate(qs ? `/?${qs}#eventos` : '/#eventos');
    setMobileSearchOpen(false);
  }

  function handleSearchSubmit(e: FormEvent) {
    e.preventDefault();
    applyQuickSearch(query, dateFilter);
  }

  function handleClearSearch() {
    setQuery('');
    setDateFilter('');
    if (location.pathname === '/') {
      const params = new URLSearchParams(searchParams);
      params.delete('q');
      params.delete('fromDate');
      params.delete('toDate');
      const qs = params.toString();
      navigate(qs ? `/?${qs}` : '/');
    }
  }

  function handleLogout() {
    logout();
    setUserMenuOpen(false);
    setMobileMenuOpen(false);
    navigate('/');
  }

  const userInitials = user?.name
    ? user.name
        .split(' ')
        .filter(Boolean)
        .slice(0, 2)
        .map((part) => part[0]?.toUpperCase() ?? '')
        .join('')
    : 'U';

  return (
    <header className="sticky top-0 z-40 border-b border-[var(--border-subtle)] bg-[var(--bg-glass)] backdrop-blur-xl">
      <div className="mx-auto flex h-[60px] max-w-7xl items-center justify-between gap-3 px-4 sm:px-6 md:h-[72px] lg:px-8">
        {/* Brand */}
        <Link to="/" className="group shrink-0" aria-label="Página inicial MESA">
          <BrandLogo />
        </Link>

        {/* Quick Search Bar (Desktop) */}
        <form
          onSubmit={handleSearchSubmit}
          role="search"
          aria-label="Busca rápida de eventos"
          className="hidden max-w-xl flex-1 items-center rounded-full border border-[var(--border-subtle)] bg-[var(--bg-surface)]/90 px-2 py-1.5 shadow-sm transition-colors focus-within:border-[var(--border-strong)] md:flex"
        >
          <div className="flex min-w-0 flex-1 items-center gap-2 pl-2.5">
            <Search className="h-4 w-4 shrink-0 text-[var(--text-muted)]" />
            <input
              ref={searchInputRef}
              type="text"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Buscar por evento, local, cidade ou data..."
              className="w-full min-w-0 bg-transparent text-xs text-[var(--text-primary)] placeholder:text-[var(--text-muted)] focus:outline-none lg:text-sm"
            />
            {(query || dateFilter) && (
              <button
                type="button"
                onClick={handleClearSearch}
                aria-label="Limpar busca"
                className="cursor-pointer rounded-full p-1 text-[var(--text-muted)] hover:bg-[var(--bg-hover)] hover:text-[var(--text-primary)]"
              >
                <X className="h-3.5 w-3.5" />
              </button>
            )}
          </div>

          <span className="mx-2 h-5 w-px bg-[var(--border-subtle)]" aria-hidden="true" />

          <label className="relative flex shrink-0 items-center gap-1.5 rounded-full px-2.5 py-1 text-xs text-[var(--text-secondary)] hover:bg-[var(--bg-elevated)]">
            <Calendar className="h-3.5 w-3.5 text-[var(--text-muted)]" />
            <input
              type="date"
              aria-label="Filtrar por data"
              value={dateFilter}
              onChange={(e) => {
                const next = e.target.value;
                setDateFilter(next);
                applyQuickSearch(query, next);
              }}
              className="w-[110px] cursor-pointer bg-transparent text-xs text-[var(--text-secondary)] focus:outline-none"
            />
          </label>

          <button
            type="submit"
            className="ml-1 shrink-0 cursor-pointer rounded-full bg-[var(--cta-bg)] px-4 py-1.5 text-xs font-semibold text-[var(--cta-text)] transition-colors hover:bg-[var(--cta-hover)]"
          >
            Buscar
          </button>
        </form>

        {/* Desktop Nav & Actions */}
        <div className="hidden items-center gap-2 md:flex">
          {isAuthenticated && (
            <NavLink
              to="/minhas-reservas"
              className={({ isActive }) =>
                `inline-flex items-center gap-1.5 rounded-full px-3.5 py-2 text-xs font-medium transition-colors lg:text-sm ${
                  isActive
                    ? 'bg-[var(--bg-elevated)] text-[var(--text-primary)]'
                    : 'text-[var(--text-secondary)] hover:bg-[var(--bg-elevated)] hover:text-[var(--text-primary)]'
                }`
              }
            >
              <Ticket className="h-3.5 w-3.5" />
              Minhas Reservas
            </NavLink>
          )}

          {isAdmin && (
            <NavLink
              to="/admin"
              className={({ isActive }) =>
                `inline-flex items-center gap-1.5 rounded-full border px-3.5 py-2 text-xs font-medium transition-colors lg:text-sm ${
                  isActive
                    ? 'border-[var(--accent-border)] bg-[var(--accent-soft)] text-[var(--accent)]'
                    : 'border-[var(--border-subtle)] bg-[var(--bg-surface)] text-[var(--text-primary)] hover:border-[var(--accent-border)] hover:text-[var(--accent)]'
                }`
              }
            >
              <Shield className="h-3.5 w-3.5" />
              Painel Admin
            </NavLink>
          )}

          {isAuthenticated && user ? (
            <div className="relative" ref={userMenuRef}>
              <button
                type="button"
                onClick={() => setUserMenuOpen((prev) => !prev)}
                aria-expanded={userMenuOpen}
                aria-haspopup="menu"
                className="flex cursor-pointer items-center gap-2 rounded-full border border-[var(--border-subtle)] bg-[var(--bg-surface)] py-1 pr-3 pl-1.5 text-left transition-colors hover:border-[var(--border-strong)]"
              >
                <span className="flex h-7 w-7 items-center justify-center rounded-full bg-[var(--cta-bg)] text-[11px] font-bold text-[var(--cta-text)]">
                  {userInitials}
                </span>
                <span className="hidden max-w-[110px] truncate text-xs font-medium text-[var(--text-primary)] lg:inline">
                  {user.name.split(' ')[0]}
                </span>
              </button>

              {userMenuOpen && (
                <div
                  role="menu"
                  className="absolute right-0 mt-2 w-64 overflow-hidden rounded-2xl border border-[var(--border-subtle)] bg-[var(--bg-surface)] p-2 shadow-[var(--shadow-elevated)]"
                >
                  <div className="border-b border-[var(--border-subtle)] px-3 py-2.5">
                    <div className="flex items-center justify-between gap-2">
                      <p className="truncate text-sm font-semibold text-[var(--text-primary)]">
                        {user.name}
                      </p>
                      <span
                        className={`shrink-0 rounded-full px-2 py-0.5 text-[10px] font-semibold tracking-wide uppercase ${
                          user.role === 'ADMIN'
                            ? 'bg-[var(--accent-soft)] text-[var(--accent)]'
                            : 'bg-[var(--bg-elevated)] text-[var(--text-secondary)]'
                        }`}
                      >
                        {user.role}
                      </span>
                    </div>
                    <p className="mt-0.5 truncate text-xs text-[var(--text-muted)]">
                      {user.email}
                    </p>
                  </div>

                  <div className="py-1">
                    <Link
                      to="/minhas-reservas"
                      role="menuitem"
                      className="flex items-center gap-2.5 rounded-xl px-3 py-2 text-xs font-medium text-[var(--text-secondary)] transition-colors hover:bg-[var(--bg-elevated)] hover:text-[var(--text-primary)]"
                    >
                      <Ticket className="h-4 w-4" />
                      Minhas Reservas
                    </Link>

                    {isAdmin && (
                      <Link
                        to="/admin"
                        role="menuitem"
                        className="flex items-center gap-2.5 rounded-xl px-3 py-2 text-xs font-medium text-[var(--text-secondary)] transition-colors hover:bg-[var(--bg-elevated)] hover:text-[var(--text-primary)]"
                      >
                        <Shield className="h-4 w-4 text-[var(--accent)]" />
                        Painel Admin
                      </Link>
                    )}

                    {!user.emailVerifiedAt && (
                      <Link
                        to={`/verificar-email?email=${encodeURIComponent(user.email)}`}
                        role="menuitem"
                        className="flex items-center gap-2.5 rounded-xl px-3 py-2 text-xs font-medium text-[var(--warning)] transition-colors hover:bg-[var(--bg-elevated)]"
                      >
                        <UserIcon className="h-4 w-4" />
                        Verificar e-mail
                      </Link>
                    )}
                  </div>

                  <div className="border-t border-[var(--border-subtle)] pt-1">
                    <button
                      type="button"
                      role="menuitem"
                      onClick={handleLogout}
                      className="flex w-full cursor-pointer items-center gap-2.5 rounded-xl px-3 py-2 text-xs font-medium text-[var(--danger)] transition-colors hover:bg-[var(--danger)]/10"
                    >
                      <LogOut className="h-4 w-4" />
                      Sair
                    </button>
                  </div>
                </div>
              )}
            </div>
          ) : (
            <div className="flex items-center gap-2">
              <Link
                to="/login"
                className="rounded-full px-4 py-2 text-xs font-medium text-[var(--text-secondary)] transition-colors hover:bg-[var(--bg-elevated)] hover:text-[var(--text-primary)] lg:text-sm"
              >
                Entrar
              </Link>
              <Link
                to="/cadastro"
                className="rounded-full bg-[var(--cta-bg)] px-4 py-2 text-xs font-semibold text-[var(--cta-text)] transition-colors hover:bg-[var(--cta-hover)] lg:text-sm"
              >
                Criar conta
              </Link>
            </div>
          )}
        </div>

        {/* Mobile Actions (< 768px): only compact Search + Hamburger Menu */}
        <div className="flex items-center gap-2 md:hidden">
          <button
            type="button"
            onClick={() => {
              setMobileSearchOpen((prev) => !prev);
              setMobileMenuOpen(false);
            }}
            aria-label={mobileSearchOpen ? 'Fechar busca' : 'Abrir busca rápida'}
            aria-expanded={mobileSearchOpen}
            className={`relative flex h-9 w-9 cursor-pointer items-center justify-center rounded-full border transition-colors ${
              mobileSearchOpen || query || dateFilter
                ? 'border-[var(--accent-border)] bg-[var(--accent-soft)] text-[var(--accent)]'
                : 'border-[var(--border-subtle)] bg-[var(--bg-surface)] text-[var(--text-primary)] hover:border-[var(--border-strong)]'
            }`}
          >
            {mobileSearchOpen ? (
              <X className="h-4 w-4" />
            ) : (
              <Search className="h-4 w-4" />
            )}
            {!mobileSearchOpen && (query || dateFilter) && (
              <span
                aria-hidden="true"
                className="absolute top-1.5 right-1.5 h-1.5 w-1.5 rounded-full bg-[var(--accent)]"
              />
            )}
          </button>

          <button
            type="button"
            onClick={() => {
              setMobileMenuOpen((prev) => !prev);
              setMobileSearchOpen(false);
            }}
            aria-label={mobileMenuOpen ? 'Fechar menu' : 'Abrir menu'}
            aria-expanded={mobileMenuOpen}
            className={`flex h-9 w-9 cursor-pointer items-center justify-center rounded-full border transition-colors ${
              mobileMenuOpen
                ? 'border-[var(--border-strong)] bg-[var(--bg-elevated)] text-[var(--text-primary)]'
                : 'border-[var(--border-subtle)] bg-[var(--bg-surface)] text-[var(--text-primary)] hover:border-[var(--border-strong)]'
            }`}
          >
            {mobileMenuOpen ? <X className="h-4 w-4" /> : <Menu className="h-4 w-4" />}
          </button>
        </div>
      </div>

      {/* Mobile Expandable Search Bar */}
      {mobileSearchOpen && (
        <div className="animate-fade-in border-t border-[var(--border-subtle)] bg-[var(--bg-surface)]/95 px-4 py-3 backdrop-blur-xl md:hidden">
          <form onSubmit={handleSearchSubmit} role="search" className="space-y-2.5">
            <div className="flex items-center gap-2">
              <div className="relative flex-1">
                <Search className="pointer-events-none absolute top-1/2 left-3.5 h-4 w-4 -translate-y-1/2 text-[var(--text-muted)]" />
                <input
                  ref={mobileSearchInputRef}
                  type="text"
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  placeholder="Buscar evento, local ou cidade..."
                  className="w-full rounded-full border border-[var(--border-subtle)] bg-[var(--bg-elevated)] py-2.5 pr-9 pl-10 text-sm text-[var(--text-primary)] placeholder:text-[var(--text-muted)] focus:border-[var(--border-strong)] focus:outline-none"
                />
                {(query || dateFilter) && (
                  <button
                    type="button"
                    onClick={handleClearSearch}
                    aria-label="Limpar busca"
                    className="absolute top-1/2 right-2.5 -translate-y-1/2 cursor-pointer rounded-full p-1 text-[var(--text-muted)] hover:bg-[var(--bg-hover)] hover:text-[var(--text-primary)]"
                  >
                    <X className="h-3.5 w-3.5" />
                  </button>
                )}
              </div>
              <button
                type="submit"
                className="shrink-0 cursor-pointer rounded-full bg-[var(--cta-bg)] px-4 py-2.5 text-xs font-semibold text-[var(--cta-text)] transition-colors hover:bg-[var(--cta-hover)]"
              >
                Buscar
              </button>
            </div>
            <label className="flex items-center gap-2 rounded-full border border-[var(--border-subtle)] bg-[var(--bg-elevated)] px-3.5 py-2 text-xs text-[var(--text-secondary)]">
              <Calendar className="h-3.5 w-3.5 shrink-0 text-[var(--text-muted)]" />
              <span className="shrink-0 text-[11px] font-medium text-[var(--text-muted)]">
                Data:
              </span>
              <input
                type="date"
                aria-label="Data do evento"
                value={dateFilter}
                onChange={(e) => setDateFilter(e.target.value)}
                className="min-w-0 flex-1 bg-transparent text-xs text-[var(--text-primary)] focus:outline-none"
              />
            </label>
          </form>
        </div>
      )}

      {/* Mobile Menu Drawer */}
      {mobileMenuOpen && (
        <div className="animate-fade-in border-t border-[var(--border-subtle)] bg-[var(--bg-surface)] px-4 py-4 shadow-[var(--shadow-elevated)] md:hidden">
          <div className="space-y-3">
            {isAuthenticated && user && (
              <div className="flex items-center gap-3 rounded-2xl border border-[var(--border-subtle)] bg-[var(--bg-elevated)] p-3">
                <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-[var(--cta-bg)] text-xs font-bold text-[var(--cta-text)]">
                  {userInitials}
                </span>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-semibold text-[var(--text-primary)]">
                    {user.name}
                  </p>
                  <p className="truncate text-xs text-[var(--text-muted)]">{user.email}</p>
                </div>
                <span
                  className={`shrink-0 rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase ${
                    user.role === 'ADMIN'
                      ? 'bg-[var(--accent-soft)] text-[var(--accent)]'
                      : 'bg-[var(--bg-surface)] text-[var(--text-secondary)]'
                  }`}
                >
                  {user.role}
                </span>
              </div>
            )}

            {/* Navigation Links */}
            <nav aria-label="Menu mobile" className="grid gap-1">
              <Link
                to="/minhas-reservas"
                className="flex items-center gap-2.5 rounded-2xl px-3.5 py-2.5 text-sm font-medium text-[var(--text-primary)] transition-colors hover:bg-[var(--bg-elevated)]"
              >
                <Ticket className="h-4 w-4 text-[var(--text-secondary)]" />
                Minhas Reservas
              </Link>

              {isAdmin && (
                <Link
                  to="/admin"
                  className="flex items-center gap-2.5 rounded-2xl px-3.5 py-2.5 text-sm font-medium text-[var(--accent)] transition-colors hover:bg-[var(--accent-soft)]"
                >
                  <Shield className="h-4 w-4" />
                  Painel Admin
                </Link>
              )}

              {isAuthenticated && user && !user.emailVerifiedAt && (
                <Link
                  to={`/verificar-email?email=${encodeURIComponent(user.email)}`}
                  className="flex items-center gap-2.5 rounded-2xl px-3.5 py-2.5 text-sm font-medium text-[var(--warning)] transition-colors hover:bg-[var(--bg-elevated)]"
                >
                  <UserIcon className="h-4 w-4" />
                  Verificar e-mail
                </Link>
              )}

            </nav>

            {/* Auth Actions */}
            <div className="border-t border-[var(--border-subtle)] pt-3">
              {isAuthenticated ? (
                <button
                  type="button"
                  onClick={handleLogout}
                  className="flex w-full cursor-pointer items-center gap-2.5 rounded-2xl px-3.5 py-2.5 text-left text-sm font-medium text-[var(--danger)] transition-colors hover:bg-[var(--danger)]/10"
                >
                  <LogOut className="h-4 w-4" />
                  Sair
                </button>
              ) : (
                <div className="grid grid-cols-2 gap-2.5">
                  <Link
                    to="/login"
                    className="flex items-center justify-center rounded-full border border-[var(--border-strong)] bg-[var(--bg-elevated)] px-4 py-2.5 text-sm font-medium text-[var(--text-primary)] transition-colors hover:bg-[var(--bg-hover)]"
                  >
                    Entrar
                  </Link>
                  <Link
                    to="/cadastro"
                    className="flex items-center justify-center rounded-full bg-[var(--cta-bg)] px-4 py-2.5 text-sm font-semibold text-[var(--cta-text)] transition-colors hover:bg-[var(--cta-hover)]"
                  >
                    Criar conta
                  </Link>
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </header>
  );
}
