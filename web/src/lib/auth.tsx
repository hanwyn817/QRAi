import React, { createContext, useContext, useEffect, useMemo, useState } from "react";
import { api } from "./api";

export type User = { id: string; email: string; role: "admin" | "user"; plan?: "free" | "pro" | "max" };

type AuthContextValue = {
  user: User | null;
  loading: boolean;
  login: (email: string, password: string) => Promise<string | null>;
  register: (email: string, password: string, adminKey?: string) => Promise<string | null>;
  logout: () => Promise<void>;
};

const AuthContext = createContext<AuthContextValue | undefined>(undefined);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let active = true;
    api.getMe().then((result) => {
      if (!active) {
        return;
      }
      setUser(result.data?.user ?? null);
      setLoading(false);
    });
    return () => {
      active = false;
    };
  }, []);

  const login = async (email: string, password: string) => {
    const result = await api.login(email, password);
    if (result.error) {
      return result.error;
    }
    setUser(result.data ?? null);
    return null;
  };

  const register = async (email: string, password: string, adminKey?: string) => {
    const result = await api.register(email, password, adminKey);
    if (result.error) {
      return result.error;
    }
    setUser(result.data ?? null);
    return null;
  };

  const logout = async () => {
    await api.logout();
    setUser(null);
  };

  const value = useMemo(
    () => ({ user, loading, login, register, logout }),
    [user, loading]
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) {
    throw new Error("useAuth must be used within AuthProvider");
  }
  return ctx;
}
