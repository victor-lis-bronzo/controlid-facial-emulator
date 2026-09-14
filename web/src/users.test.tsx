import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { UsersPage } from './pages/UsersPage.tsx';
import { AuthProvider } from './context/AuthContext.tsx';

describe('Users Management via .fcgi (Issue #21)', () => {
  beforeEach(() => {
    localStorage.clear();
    localStorage.setItem('controlid_session', 'auth-token-999');
    vi.restoreAllMocks();
  });

  it('loads and lists users consuming POST /load_objects.fcgi with session query', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockImplementation(async (url) => {
      const urlString = String(url);
      if (urlString.includes('/load_objects.fcgi')) {
        return {
          ok: true,
          status: 200,
          text: async () =>
            JSON.stringify({
              users: [
                { id: 1, name: 'Carlos Alberto', registration: 'REG001' },
                { id: 2, name: 'Ana Carolina', registration: 'REG002' },
              ],
            }),
        } as Response;
      }
      return { ok: false, status: 404, text: async () => '' } as Response;
    });

    render(
      <AuthProvider>
        <MemoryRouter>
          <UsersPage />
        </MemoryRouter>
      </AuthProvider>
    );

    await waitFor(() => {
      expect(screen.getByText('Carlos Alberto')).toBeInTheDocument();
      expect(screen.getByText('REG001')).toBeInTheDocument();
      expect(screen.getByText('Ana Carolina')).toBeInTheDocument();
      expect(screen.getByText('REG002')).toBeInTheDocument();
    });

    expect(fetchSpy).toHaveBeenCalledWith(
      expect.stringContaining('/load_objects.fcgi?session=auth-token-999'),
      expect.objectContaining({
        method: 'POST',
        headers: expect.objectContaining({ 'Content-Type': 'application/json' }),
        body: JSON.stringify({ object: 'users' }),
      })
    );
  });

  it('creates a new user consuming POST /create_objects.fcgi with session query and reloads list', async () => {
    let usersList = [{ id: 1, name: 'Carlos Alberto', registration: 'REG001' }];

    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockImplementation(async (url, init) => {
      const urlString = String(url);
      const method = init?.method ?? 'GET';

      if (urlString.includes('/load_objects.fcgi')) {
        return {
          ok: true,
          status: 200,
          text: async () => JSON.stringify({ users: usersList }),
        } as Response;
      }

      if (urlString.includes('/create_objects.fcgi') && method === 'POST') {
        const body = JSON.parse(String(init?.body));
        usersList = [...usersList, { id: 2, name: body.values[0].name, registration: body.values[0].registration }];
        return {
          ok: true,
          status: 200,
          text: async () => JSON.stringify({ ids: [2] }),
        } as Response;
      }

      return { ok: false, status: 404, text: async () => '' } as Response;
    });

    render(
      <AuthProvider>
        <MemoryRouter>
          <UsersPage />
        </MemoryRouter>
      </AuthProvider>
    );

    await waitFor(() => {
      expect(screen.getByText('Carlos Alberto')).toBeInTheDocument();
    });

    // Open create user form
    await userEvent.click(screen.getByRole('button', { name: /novo usuário|adicionar usuário/i }));

    // Fill form
    await userEvent.type(screen.getByLabelText(/nome/i), 'Mariana Souza');
    await userEvent.type(screen.getByLabelText(/matrícula|registration/i), 'REG999');
    await userEvent.type(screen.getByLabelText(/senha|pin/i), '1234');

    // Submit form
    await userEvent.click(screen.getByRole('button', { name: /salvar|criar/i }));

    await waitFor(() => {
      expect(fetchSpy).toHaveBeenCalledWith(
        expect.stringContaining('/create_objects.fcgi?session=auth-token-999'),
        expect.objectContaining({
          method: 'POST',
          headers: expect.objectContaining({ 'Content-Type': 'application/json' }),
          body: JSON.stringify({
            object: 'users',
            values: [{ name: 'Mariana Souza', registration: 'REG999', password: '1234' }],
          }),
        })
      );
    });

    await waitFor(() => {
      expect(screen.getByText('Mariana Souza')).toBeInTheDocument();
      expect(screen.getByText('REG999')).toBeInTheDocument();
    });
  });
});
