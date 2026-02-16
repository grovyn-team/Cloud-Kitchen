import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import type { AuthSession, LoginPayload, Role } from '@/types/api';
import { createApi, apiPaths } from '@/services/api';
import type { AxiosInstance } from 'axios';

const STORAGE_KEY = 'grovyn_session';

/** Stateless tokens contain a dot (payload.signature). Old in-memory tokens do not. */
function isStatelessToken(token: string): boolean {
  return typeof token === 'string' && token.includes('.');
}

function loadStoredSession(): AuthSession | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as AuthSession;
    if (!parsed?.sessionToken || !parsed?.userId || !parsed?.role) return null;
    // Backend now uses stateless tokens (required for Vercel). Discard old-format tokens.
    if (!isStatelessToken(parsed.sessionToken)) return null;
    return parsed;
  } catch {
    return null;
  }
}

function saveSession(session: AuthSession | null) {
  if (session) {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(session));
    } catch {
      /* ignore */
    }
  } else {
    try {
      localStorage.removeItem(STORAGE_KEY);
    } catch {
      /* ignore */
    }
  }
}

interface AuthState {
  user: AuthSession | null;
  isAuthenticated: boolean;
}

interface AuthContextValue extends AuthState {
  login: (payload: LoginPayload) => Promise<AuthSession>;
  logout: () => void;
  getToken: () => string | null;
  api: AxiosInstance;
  role: Role | null;
  storeIds: string[];
}

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<AuthSession | null>(() => loadStoredSession());
  const tokenRef = useRef<string | null>(null);
  tokenRef.current = user?.sessionToken ?? null;
  const getToken = useCallback(() => tokenRef.current, []);
  const logoutRef = useRef<() => void>(() => {
    setUser(null);
    saveSession(null);
  });
  const logout = useCallback(() => {
    setUser(null);
    saveSession(null);
  }, []);
  logoutRef.current = logout;

  useEffect(() => {
    saveSession(user);
  }, [user]);
  const api = useMemo(
    () => createApi(getToken, () => logoutRef.current()),
    []
  );

  const login = useCallback(
    async (payload: LoginPayload): Promise<AuthSession> => {
      const { data } = await api.post<AuthSession>(apiPaths.auth.login, payload);
      const session: AuthSession = {
        userId: data.userId,
        role: data.role,
        storeIds: data.storeIds ?? [],
        sessionToken: data.sessionToken,
      };
      setUser(session);
      return session;
    },
    [api]
  );


  const value: AuthContextValue = useMemo(
    () => ({
      user,
      isAuthenticated: !!user,
      login,
      logout,
      getToken,
      api,
      role: user?.role ?? null,
      storeIds: user?.storeIds ?? [],
    }),
    [user, login, logout, getToken, api]
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used within AuthProvider');
  return ctx;
}
