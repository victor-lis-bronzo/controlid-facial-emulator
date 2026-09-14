import { useCallback } from 'react';
import { useAuth } from '../context/AuthContext.tsx';

export function useFcgi() {
  const { session, logout } = useAuth();

  const fcgiFetch = useCallback(
    async <T = unknown>(endpoint: string, options: RequestInit = {}): Promise<T> => {
      const separator = endpoint.includes('?') ? '&' : '?';
      const authenticatedUrl = session
        ? `${endpoint}${separator}session=${encodeURIComponent(session)}`
        : endpoint;

      const headers = {
        'Content-Type': 'application/json',
        ...options.headers,
      };

      const response = await fetch(authenticatedUrl, {
        ...options,
        headers,
      });

      if (response.status === 401) {
        logout();
        throw new Error('Sessão expirada ou não autorizada');
      }

      if (!response.ok) {
        const text = await response.text();
        let errorMsg = `Requisição falhou com status ${response.status}`;
        try {
          const json = JSON.parse(text);
          if (json.error || json.message) {
            errorMsg = json.error || json.message;
          }
        } catch {
          // ignore json parse error
        }
        throw new Error(errorMsg);
      }

      const text = await response.text();
      return (text ? JSON.parse(text) : {}) as T;
    },
    [session, logout]
  );

  return { fcgiFetch };
}
