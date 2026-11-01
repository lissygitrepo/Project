"use client";

import { createContext, useCallback, useContext, useEffect, useState } from "react";
import { apiFetch, clearToken, getToken, loginRequest, registerRequest, setToken } from "./api";

const AuthContext = createContext(null);

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(true);

  // On first load, restore the session if a token is saved
  useEffect(() => {
    let cancelled = false;
    (async () => {
      if (!getToken()) {
        setLoading(false);
        return;
      }
      try {
        const me = await apiFetch("/auth/me");
        if (!cancelled) setUser(me);
      } catch {
        clearToken();
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  // If any later request gets a 401 (token expired), drop the user so pages redirect to login
  useEffect(() => {
    const onUnauthorized = () => setUser(null);
    window.addEventListener("la:unauthorized", onUnauthorized);
    return () => window.removeEventListener("la:unauthorized", onUnauthorized);
  }, []);

  const login = useCallback(async (email, password) => {
    const data = await loginRequest(email, password);
    setToken(data.access_token);
    setUser(await apiFetch("/auth/me"));
  }, []);

  const register = useCallback(
    async (payload) => {
      await registerRequest(payload);
      await login(payload.email, payload.password);
    },
    [login]
  );

  const logout = useCallback(() => {
    clearToken();
    setUser(null);
  }, []);

  return (
    <AuthContext.Provider value={{ user, loading, login, register, logout }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used inside <AuthProvider>");
  return ctx;
}