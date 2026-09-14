import React, { createContext, useContext, useState, useEffect } from 'react';

interface AuthContextType {
  session: string | null;
  isAuthenticated: boolean;
  login: (username: string, password: string) => Promise<void>;
  logout: () => void;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

const STORAGE_KEY = 'controlid_session';

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [session, setSession] = useState<string | null>(() => {
    return localStorage.getItem(STORAGE_KEY);
  });

  useEffect(() => {
    if (session) {
      localStorage.setItem(STORAGE_KEY, session);
    } else {
      localStorage.removeItem(STORAGE_KEY);
    }
  }, [session]);

  const login = async (username: string, password: string) => {
    const response = await fetch('/login.fcgi', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ login: username, password }),
    });

    if (!response.ok) {
      throw new Error('Credenciais inválidas');
    }

    const text = await response.text();
    const data = text ? JSON.parse(text) : {};
    if (!data.session) {
      throw new Error('Falha no login: token de sessão ausente');
    }

    setSession(data.session);
  };

  const logout = () => {
    setSession(null);
  };

  return (
    <AuthContext.Provider
      value={{
        session,
        isAuthenticated: Boolean(session),
        login,
        logout,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return context;
}
