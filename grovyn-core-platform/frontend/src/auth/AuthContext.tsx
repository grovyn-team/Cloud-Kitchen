import React, { createContext, useCallback, useContext, useMemo, useRef, useState } from 'react';
import type { AuthSession, LoginPayload, Role } from '@/types/api';
import { createApi, apiPaths } from '@/services/api';
import type { AxiosInstance } from 'axios';

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
  const [user, setUser] = useState<AuthSession | null>(null);
  const tokenRef = useRef<string | null>(null);
  tokenRef.current = user?.sessionToken ?? null;
  const getToken = useCallback(() => tokenRef.current, []);
  const api = useMemo(() => createApi(getToken), []);

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

  const logout = useCallback(() => {
    setUser(null);
  }, []);

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
