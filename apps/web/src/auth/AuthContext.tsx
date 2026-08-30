import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react';
import { api, storeToken, storedToken } from '../api/client';
import type { AuthUser, LoginResult, UserRole } from '../api/types';

const USER_KEY = 'egomot.user';

interface AuthValue {
  user: AuthUser | null;
  login: (phone: string, password: string) => Promise<void>;
  logout: () => Promise<void>;
  /** True for the roles listed, false otherwise. */
  hasRole: (...roles: UserRole[]) => boolean;
}

const AuthContext = createContext<AuthValue | null>(null);

function cachedUser(): AuthUser | null {
  const raw = localStorage.getItem(USER_KEY);
  if (!raw) return null;
  try {
    return JSON.parse(raw) as AuthUser;
  } catch {
    return null;
  }
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<AuthUser | null>(() =>
    storedToken() ? cachedUser() : null,
  );

  // A token can expire between visits; the first 401 clears it, and this
  // keeps the cached user from outliving it.
  useEffect(() => {
    if (!storedToken() && user) {
      setUser(null);
      localStorage.removeItem(USER_KEY);
    }
  }, [user]);

  const login = useCallback(async (phone: string, password: string) => {
    const result = await api<LoginResult>('/auth/login', {
      method: 'POST',
      body: { phone, password },
    });
    storeToken(result.access_token);
    localStorage.setItem(USER_KEY, JSON.stringify(result.user));
    setUser(result.user);
  }, []);

  const logout = useCallback(async () => {
    try {
      await api('/auth/logout', { method: 'POST' });
    } catch {
      // Logging out locally must work even when the server cannot be reached.
    }
    storeToken(null);
    localStorage.removeItem(USER_KEY);
    setUser(null);
  }, []);

  const value = useMemo<AuthValue>(
    () => ({
      user,
      login,
      logout,
      hasRole: (...roles) => (user ? roles.includes(user.role) : false),
    }),
    [user, login, logout],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthValue {
  const value = useContext(AuthContext);
  if (!value) {
    throw new Error('useAuth must be used inside AuthProvider');
  }
  return value;
}
