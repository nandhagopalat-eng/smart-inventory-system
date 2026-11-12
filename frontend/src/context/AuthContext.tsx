import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react';

import { api, clearToken, getToken, setToken } from '../api/client';
import type { Business, User } from '../api/types';

interface AuthContextValue {
  user: User | null;
  business: Business | null;
  loading: boolean;
  isAdmin: boolean;
  login: (email: string, password: string) => Promise<void>;
  register: (payload: {
    name: string;
    email: string;
    password: string;
    businessName: string;
  }) => Promise<void>;
  logout: () => void;
}

const AuthContext = createContext<AuthContextValue | null>(null);

export const AuthProvider = ({ children }: { children: ReactNode }) => {
  const [user, setUser] = useState<User | null>(null);
  const [business, setBusiness] = useState<Business | null>(null);
  const [loading, setLoading] = useState(true);

  const logout = useCallback(() => {
    clearToken();
    setUser(null);
    setBusiness(null);
  }, []);

  useEffect(() => {
    const handleForcedLogout = () => {
      setUser(null);
      setBusiness(null);
    };
    window.addEventListener('auth:logout', handleForcedLogout);
    return () => window.removeEventListener('auth:logout', handleForcedLogout);
  }, []);

  useEffect(() => {
    if (!getToken()) {
      setLoading(false);
      return;
    }

    let cancelled = false;
    api
      .me()
      .then((me) => {
        if (!cancelled) {
          setUser(me.user);
          setBusiness(me.business);
        }
      })
      .catch(() => {
        if (!cancelled) {
          clearToken();
        }
      })
      .finally(() => {
        if (!cancelled) {
          setLoading(false);
        }
      });

    return () => {
      cancelled = true;
    };
  }, []);

  const login = useCallback(async (email: string, password: string) => {
    const result = await api.login({ email, password });
    setToken(result.token);
    setUser(result.user);
    try {
      const me = await api.me();
      setBusiness(me.business);
      setUser(me.user);
    } catch {
      setBusiness(null);
    }
  }, []);

  const register = useCallback(
    async (payload: { name: string; email: string; password: string; businessName: string }) => {
      await api.register(payload);
      await login(payload.email, payload.password);
    },
    [login]
  );

  const value = useMemo<AuthContextValue>(
    () => ({
      user,
      business,
      loading,
      isAdmin: user?.role === 'admin',
      login,
      register,
      logout,
    }),
    [user, business, loading, login, register, logout]
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
};

export const useAuth = (): AuthContextValue => {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error('useAuth must be used inside AuthProvider');
  }
  return context;
};
