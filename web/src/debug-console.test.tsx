import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { DebugConsolePage } from './pages/DebugConsolePage.tsx';
import { AuthProvider } from './context/AuthContext.tsx';

function renderDebugConsolePage() {
  render(
    <AuthProvider>
      <MemoryRouter>
        <DebugConsolePage />
      </MemoryRouter>
    </AuthProvider>
  );
}

function ok(status: number, body: unknown): Response {
  return { ok: status < 400, status, text: async () => JSON.stringify(body) } as Response;
}

const IDENTITIES = [{ id: 1, registration: '1001', name: 'Ana Souza' }];

describe('Debug Console (Simulate + Interception Log)', () => {
  beforeEach(() => {
    localStorage.clear();
    localStorage.setItem('controlid_session', 'auth-token-999');
    vi.restoreAllMocks();
  });

  it('loads identities and the interception log on mount', async () => {
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (url) => {
      const urlString = String(url);
      if (urlString.includes('/api/identities')) return ok(200, IDENTITIES);
      if (urlString.includes('/api/interception')) return ok(200, []);
      return ok(404, {});
    });

    renderDebugConsolePage();

    await waitFor(() => {
      expect(screen.getByRole('option', { name: 'Ana Souza (#1001)' })).toBeInTheDocument();
    });
  });

  it('keeps the Authorized action disabled until an identity is selected', async () => {
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (url) => {
      const urlString = String(url);
      if (urlString.includes('/api/identities')) return ok(200, IDENTITIES);
      if (urlString.includes('/api/interception')) return ok(200, []);
      return ok(404, {});
    });

    renderDebugConsolePage();

    await waitFor(() => {
      expect(screen.getByRole('option', { name: 'Ana Souza (#1001)' })).toBeInTheDocument();
    });

    expect(screen.getByRole('button', { name: /simular acesso autorizado/i })).toBeDisabled();

    await userEvent.selectOptions(screen.getByLabelText(/identity/i), '1');

    expect(screen.getByRole('button', { name: /simular acesso autorizado/i })).toBeEnabled();
  });

  it('dispatches POST /api/simulate/authorized with the selected identity and renders the outcome', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockImplementation(async (url, init) => {
      const urlString = String(url);
      const method = init?.method ?? 'GET';
      if (urlString.includes('/api/identities')) return ok(200, IDENTITIES);
      if (urlString.includes('/api/interception')) return ok(200, []);
      if (urlString.includes('/api/simulate/authorized') && method === 'POST') {
        return ok(200, { success: true, target: 'http://monitor.local/push', attempts: 1 });
      }
      return ok(404, {});
    });

    renderDebugConsolePage();

    await waitFor(() => {
      expect(screen.getByRole('option', { name: 'Ana Souza (#1001)' })).toBeInTheDocument();
    });

    await userEvent.selectOptions(screen.getByLabelText(/identity/i), '1');
    await userEvent.click(screen.getByRole('button', { name: /simular acesso autorizado/i }));

    await waitFor(() => {
      expect(fetchSpy).toHaveBeenCalledWith(
        expect.stringContaining('/api/simulate/authorized?session=auth-token-999'),
        expect.objectContaining({
          method: 'POST',
          body: JSON.stringify({ userId: 1 }),
        })
      );
    });

    await waitFor(() => {
      expect(screen.getByText('Sucesso')).toBeInTheDocument();
    });
    expect(screen.getByText('http://monitor.local/push')).toBeInTheDocument();
  });

  it('dispatches POST /api/simulate/denied without requiring a selected identity', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockImplementation(async (url, init) => {
      const urlString = String(url);
      const method = init?.method ?? 'GET';
      if (urlString.includes('/api/identities')) return ok(200, IDENTITIES);
      if (urlString.includes('/api/interception')) return ok(200, []);
      if (urlString.includes('/api/simulate/denied') && method === 'POST') {
        return ok(200, { success: true, target: null, attempts: 0 });
      }
      return ok(404, {});
    });

    renderDebugConsolePage();

    await waitFor(() => {
      expect(screen.getByRole('option', { name: 'Ana Souza (#1001)' })).toBeInTheDocument();
    });

    await userEvent.click(screen.getByRole('button', { name: /simular acesso negado/i }));

    await waitFor(() => {
      expect(fetchSpy).toHaveBeenCalledWith(
        expect.stringContaining('/api/simulate/denied?session=auth-token-999'),
        expect.objectContaining({ method: 'POST', body: JSON.stringify({}) })
      );
    });
    await waitFor(() => {
      expect(screen.getByText('(nenhum alvo configurado)')).toBeInTheDocument();
    });
  });

  it('dispatches POST /api/simulate/keep-alive', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockImplementation(async (url, init) => {
      const urlString = String(url);
      const method = init?.method ?? 'GET';
      if (urlString.includes('/api/identities')) return ok(200, IDENTITIES);
      if (urlString.includes('/api/interception')) return ok(200, []);
      if (urlString.includes('/api/simulate/keep-alive') && method === 'POST') {
        return ok(200, { success: true, target: 'http://monitor.local/push', attempts: 1 });
      }
      return ok(404, {});
    });

    renderDebugConsolePage();

    await waitFor(() => {
      expect(screen.getByRole('option', { name: 'Ana Souza (#1001)' })).toBeInTheDocument();
    });

    await userEvent.click(screen.getByRole('button', { name: /forçar keep-alive/i }));

    await waitFor(() => {
      expect(fetchSpy).toHaveBeenCalledWith(
        expect.stringContaining('/api/simulate/keep-alive?session=auth-token-999'),
        expect.objectContaining({ method: 'POST', body: JSON.stringify({}) })
      );
    });
  });

  it('shows an action error and preserves the selected identity on failure', async () => {
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (url, init) => {
      const urlString = String(url);
      const method = init?.method ?? 'GET';
      if (urlString.includes('/api/identities')) return ok(200, IDENTITIES);
      if (urlString.includes('/api/interception')) return ok(200, []);
      if (urlString.includes('/api/simulate/authorized') && method === 'POST') {
        return ok(400, { 'error-description': 'An identity (userId) must be selected.' });
      }
      return ok(404, {});
    });

    renderDebugConsolePage();

    await waitFor(() => {
      expect(screen.getByRole('option', { name: 'Ana Souza (#1001)' })).toBeInTheDocument();
    });

    await userEvent.selectOptions(screen.getByLabelText(/identity/i), '1');
    await userEvent.click(screen.getByRole('button', { name: /simular acesso autorizado/i }));

    await waitFor(() => {
      expect(screen.getByText('An identity (userId) must be selected.')).toBeInTheDocument();
    });

    expect(screen.getByLabelText(/identity/i)).toHaveValue('1');
  });

  it('renders interception log records', async () => {
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (url) => {
      const urlString = String(url);
      if (urlString.includes('/api/identities')) return ok(200, []);
      if (urlString.includes('/api/interception')) {
        return ok(200, [
          {
            id: 1,
            direction: 'inbound',
            method: 'POST',
            path: '/load_objects.fcgi?object=users',
            timestamp: '2026-09-24T12:00:00.000Z',
            body: '{}',
            truncated: false,
          },
          {
            id: 2,
            direction: 'outbound',
            method: 'POST',
            path: 'http://monitor.local/push',
            timestamp: '2026-09-24T12:00:01.000Z',
            body: '{}',
            truncated: false,
            outcome: 'success',
            statusCode: 200,
            attempts: 1,
          },
        ]);
      }
      return ok(404, {});
    });

    renderDebugConsolePage();

    await waitFor(() => {
      expect(screen.getByText('/load_objects.fcgi?object=users')).toBeInTheDocument();
    });
    expect(screen.getByText('http://monitor.local/push')).toBeInTheDocument();
  });

  it('shows an explicit empty state when the interception log has no records', async () => {
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (url) => {
      const urlString = String(url);
      if (urlString.includes('/api/identities')) return ok(200, []);
      if (urlString.includes('/api/interception')) return ok(200, []);
      return ok(404, {});
    });

    renderDebugConsolePage();

    await waitFor(() => {
      expect(
        screen.getByText(
          'Nenhum registro de interceptação ainda. Simule um evento para ver requisições e webhooks aqui.'
        )
      ).toBeInTheDocument();
    });
  });

  it('refetches the interception log when Refresh is clicked', async () => {
    let interceptionRecords: unknown[] = [];

    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockImplementation(async (url) => {
      const urlString = String(url);
      if (urlString.includes('/api/identities')) return ok(200, []);
      if (urlString.includes('/api/interception')) return ok(200, interceptionRecords);
      return ok(404, {});
    });

    renderDebugConsolePage();

    await waitFor(() => {
      expect(
        screen.getByText(
          'Nenhum registro de interceptação ainda. Simule um evento para ver requisições e webhooks aqui.'
        )
      ).toBeInTheDocument();
    });

    interceptionRecords = [
      {
        id: 1,
        direction: 'inbound',
        method: 'GET',
        path: '/api/interception',
        timestamp: '2026-09-24T12:00:00.000Z',
        body: '',
        truncated: false,
      },
    ];

    await userEvent.click(screen.getByRole('button', { name: /atualizar/i }));

    await waitFor(() => {
      expect(screen.getByText('/api/interception')).toBeInTheDocument();
    });
    expect(fetchSpy).toHaveBeenCalledWith(
      expect.stringContaining('/api/interception?session=auth-token-999'),
      expect.anything()
    );
  });

  it('shows an error banner when the interception log fails to load', async () => {
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (url) => {
      const urlString = String(url);
      if (urlString.includes('/api/identities')) return ok(200, []);
      if (urlString.includes('/api/interception')) return ok(500, { 'error-description': 'Erro interno' });
      return ok(404, {});
    });

    renderDebugConsolePage();

    await waitFor(() => {
      expect(screen.getByText('Erro interno')).toBeInTheDocument();
    });
  });
});
