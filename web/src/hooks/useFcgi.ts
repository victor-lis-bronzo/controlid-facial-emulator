import { useCallback } from 'react';
import { useAuth } from '../context/AuthContext.tsx';

export function useFcgi() {
  const { session, logout } = useAuth();

  const withSession = useCallback(
    (endpoint: string): string => {
      const separator = endpoint.includes('?') ? '&' : '?';
      return session
        ? `${endpoint}${separator}session=${encodeURIComponent(session)}`
        : endpoint;
    },
    [session]
  );

  const handleResponse = useCallback(
    async <T,>(response: Response): Promise<T> => {
      if (response.status === 401) {
        logout();
        throw new Error('Sessão expirada ou não autorizada');
      }

      if (!response.ok) {
        const text = await response.text();
        let errorMsg = `Requisição falhou com status ${response.status}`;
        try {
          const json = JSON.parse(text);
          if (json['error-description'] || json.error || json.message) {
            errorMsg = json['error-description'] || json.error || json.message;
          }
        } catch {
          // ignore json parse error
        }
        throw new Error(errorMsg);
      }

      const text = await response.text();
      return (text ? JSON.parse(text) : {}) as T;
    },
    [logout]
  );

  const fcgiFetch = useCallback(
    async <T = unknown>(endpoint: string, options: RequestInit = {}): Promise<T> => {
      const authenticatedUrl = withSession(endpoint);

      const headers = {
        'Content-Type': 'application/json',
        ...options.headers,
      };

      const response = await fetch(authenticatedUrl, {
        ...options,
        headers,
      });

      return handleResponse<T>(response);
    },
    [withSession, handleResponse]
  );

  /**
   * POST a `FormData` body without forcing a JSON `Content-Type` — the
   * browser sets the multipart boundary itself when no `Content-Type` header
   * is supplied.
   */
  const fcgiUpload = useCallback(
    async <T = unknown>(endpoint: string, body: FormData): Promise<T> => {
      const authenticatedUrl = withSession(endpoint);

      const response = await fetch(authenticatedUrl, {
        method: 'POST',
        body,
      });

      return handleResponse<T>(response);
    },
    [withSession, handleResponse]
  );

  return { fcgiFetch, fcgiUpload };
}
