import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { AppRouter } from './AppRouter.tsx';
import { AuthProvider } from './context/AuthContext.tsx';

describe('Authentication flow (Issue #20)', () => {
  beforeEach(() => {
    localStorage.clear();
    vi.restoreAllMocks();
  });

  it('redirects unauthenticated users trying to access /admin/users to /admin/login', async () => {
    render(
      <AuthProvider>
        <MemoryRouter initialEntries={['/admin/users']}>
          <AppRouter />
        </MemoryRouter>
      </AuthProvider>
    );

    await waitFor(() => {
      expect(screen.getByRole('heading', { name: /login/i })).toBeInTheDocument();
    });
  });

  it('authenticates via /login.fcgi, persists session to localStorage, and navigates to /admin/users', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockImplementation(async (url) => {
      const urlStr = String(url);
      if (urlStr.includes('/login.fcgi')) {
        return {
          ok: true,
          status: 200,
          text: async () => JSON.stringify({ session: 'session-xyz-123' }),
        } as Response;
      }
      return {
        ok: true,
        status: 200,
        text: async () => JSON.stringify({ users: [] }),
      } as Response;
    });

    render(
      <AuthProvider>
        <MemoryRouter initialEntries={['/admin/login']}>
          <AppRouter />
        </MemoryRouter>
      </AuthProvider>
    );

    await userEvent.type(screen.getByLabelText(/login|usuário/i), 'admin');
    await userEvent.type(screen.getByLabelText(/senha|password/i), 'admin');
    await userEvent.click(screen.getByRole('button', { name: /entrar|login/i }));

    await waitFor(() => {
      expect(fetchSpy).toHaveBeenCalledWith(
        '/login.fcgi',
        expect.objectContaining({
          method: 'POST',
          headers: expect.objectContaining({ 'Content-Type': 'application/json' }),
          body: JSON.stringify({ login: 'admin', password: 'admin' }),
        })
      );
    });

    expect(localStorage.getItem('controlid_session')).toBe('session-xyz-123');

    await waitFor(() => {
      expect(screen.getByRole('heading', { name: /users/i })).toBeInTheDocument();
    });
  });

  it('displays error message when /login.fcgi fails', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce({
      ok: false,
      status: 401,
      text: async () => JSON.stringify({ error: 'invalid credentials' }),
    } as Response);

    render(
      <AuthProvider>
        <MemoryRouter initialEntries={['/admin/login']}>
          <AppRouter />
        </MemoryRouter>
      </AuthProvider>
    );

    await userEvent.type(screen.getByLabelText(/login|usuário/i), 'wrong');
    await userEvent.type(screen.getByLabelText(/senha|password/i), 'wrong');
    await userEvent.click(screen.getByRole('button', { name: /entrar|login/i }));

    await waitFor(() => {
      expect(screen.getByText(/credenciais inválidas|falha no login|invalid credentials/i)).toBeInTheDocument();
    });
    expect(localStorage.getItem('controlid_session')).toBeNull();
  });
});
