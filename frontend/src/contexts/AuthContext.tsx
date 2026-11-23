import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react';
import {
  ApiError,
  authApi,
  clearStoredAccessToken,
  getStoredAccessToken,
  storeAccessToken,
} from '@/lib/api';
import type { User, UserRole } from '@/types/api';

const SIGNED_OUT_FLAG = 'mesa-signed-out-session';

interface AuthContextValue {
  user: User | null;
  isAuthenticated: boolean;
  isAdmin: boolean;
  isInitializing: boolean;
  login: (input: { email: string; password: string }) => Promise<User>;
  register: (input: {
    name: string;
    email: string;
    password: string;
  }) => Promise<User>;
  logout: () => void;
  refreshUser: () => Promise<User | null>;
  startGoogleLogin: () => void;
  getDefaultRouteForRole: (role: UserRole) => string;
}

const AuthContext = createContext<AuthContextValue | null>(null);

export function getDefaultRouteForRole(role: UserRole): string {
  return role === 'ADMIN' ? '/admin' : '/';
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [isInitializing, setIsInitializing] = useState(true);

  const refreshUser = useCallback(async (): Promise<User | null> => {
    try {
      const { user: fetchedUser } = await authApi.me();
      setUser(fetchedUser);
      try {
        sessionStorage.removeItem(SIGNED_OUT_FLAG);
      } catch {
        // Ignore
      }
      return fetchedUser;
    } catch (error) {
      if (error instanceof ApiError && (error.status === 401 || error.status === 403)) {
        clearStoredAccessToken();
      }
      setUser(null);
      return null;
    }
  }, []);

  useEffect(() => {
    let active = true;

    async function hydrateSession() {
      // Respect explicit local sign-out unless a fresh token is present
      const hasToken = Boolean(getStoredAccessToken());
      let wasSignedOut = false;
      try {
        wasSignedOut = sessionStorage.getItem(SIGNED_OUT_FLAG) === '1';
      } catch {
        wasSignedOut = false;
      }

      if (wasSignedOut && !hasToken) {
        if (active) setIsInitializing(false);
        return;
      }

      try {
        const { user: currentUser } = await authApi.me();
        if (active) {
          setUser(currentUser);
        }
      } catch (error) {
        if (
          error instanceof ApiError &&
          (error.status === 401 || error.status === 403)
        ) {
          clearStoredAccessToken();
        }
        if (active) {
          setUser(null);
        }
      } finally {
        if (active) {
          setIsInitializing(false);
        }
      }
    }

    void hydrateSession();

    return () => {
      active = false;
    };
  }, []);

  const login = useCallback(
    async (input: { email: string; password: string }): Promise<User> => {
      const response = await authApi.login({
        email: input.email.trim(),
        password: input.password,
      });
      storeAccessToken(response.accessToken, response.expiresIn);
      try {
        sessionStorage.removeItem(SIGNED_OUT_FLAG);
      } catch {
        // Ignore
      }
      setUser(response.user);
      return response.user;
    },
    [],
  );

  const register = useCallback(
    async (input: {
      name: string;
      email: string;
      password: string;
    }): Promise<User> => {
      const { user: created } = await authApi.register({
        name: input.name.trim(),
        email: input.email.trim(),
        password: input.password,
      });
      return created;
    },
    [],
  );

  const logout = useCallback(() => {
    clearStoredAccessToken();
    try {
      sessionStorage.setItem(SIGNED_OUT_FLAG, '1');
    } catch {
      // Ignore
    }
    setUser(null);
  }, []);

  const startGoogleLogin = useCallback(() => {
    try {
      sessionStorage.removeItem(SIGNED_OUT_FLAG);
    } catch {
      // Ignore
    }
    window.location.assign(authApi.getGoogleAuthUrl());
  }, []);

  const value = useMemo<AuthContextValue>(
    () => ({
      user,
      isAuthenticated: Boolean(user),
      isAdmin: user?.role === 'ADMIN',
      isInitializing,
      login,
      register,
      logout,
      refreshUser,
      startGoogleLogin,
      getDefaultRouteForRole,
    }),
    [user, isInitializing, login, register, logout, refreshUser, startGoogleLogin],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) {
    throw new Error('useAuth must be used within AuthProvider');
  }
  return ctx;
}
