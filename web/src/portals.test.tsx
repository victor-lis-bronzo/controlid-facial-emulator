import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { PortalsPage } from './pages/PortalsPage.tsx';
import { AuthProvider } from './context/AuthContext.tsx';

function renderPortalsPage() {
  render(
    <AuthProvider>
      <MemoryRouter>
        <PortalsPage />
      </MemoryRouter>
    </AuthProvider>
  );
}

function ok(status: number, body: unknown): Response {
  return { ok: status < 400, status, text: async () => JSON.stringify(body) } as Response;
}

describe('Portals CRUD via .fcgi', () => {
  beforeEach(() => {
    localStorage.clear();
    localStorage.setItem('controlid_session', 'auth-token-999');
    vi.restoreAllMocks();
  });

  it('loads the portal list', async () => {
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (url) => {
      const urlString = String(url);
      if (urlString.includes('/load_objects.fcgi?object=portals')) {
        return ok(200, { portals: [{ id: 1, name: 'Porta Principal' }] });
      }
      return ok(404, {});
    });

    renderPortalsPage();

    await waitFor(() => {
      expect(screen.getByText('Porta Principal')).toBeInTheDocument();
    });
  });

  it('shows an explicit empty state when no portals exist', async () => {
    vi.spyOn(globalThis, 'fetch').mockImplementation(async () => ok(200, {}));

    renderPortalsPage();

    await waitFor(() => {
      expect(screen.getByText('Nenhum portal cadastrado no momento.')).toBeInTheDocument();
    });
  });

  it('creates a new portal consuming POST /create_objects.fcgi?object=portals and reloads the list', async () => {
    let portalsList: { id: number; name: string }[] = [];

    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockImplementation(async (url, init) => {
      const urlString = String(url);
      const method = init?.method ?? 'GET';

      if (urlString.includes('/load_objects.fcgi?object=portals')) {
        return ok(200, { portals: portalsList });
      }
      if (urlString.includes('/create_objects.fcgi') && method === 'POST') {
        const body = JSON.parse(String(init?.body));
        portalsList = [...portalsList, { id: 1, name: body.values[0].name }];
        return ok(200, { ids: [1] });
      }
      return ok(404, {});
    });

    renderPortalsPage();

    await waitFor(() => {
      expect(screen.getByText('Nenhum portal cadastrado no momento.')).toBeInTheDocument();
    });

    await userEvent.click(screen.getByRole('button', { name: /novo portal/i }));
    await userEvent.type(screen.getByLabelText(/nome/i), 'Porta Principal');
    await userEvent.click(screen.getByRole('button', { name: /salvar/i }));

    await waitFor(() => {
      expect(fetchSpy).toHaveBeenCalledWith(
        expect.stringContaining('/create_objects.fcgi?object=portals&session=auth-token-999'),
        expect.objectContaining({
          method: 'POST',
          headers: expect.objectContaining({ 'Content-Type': 'application/json' }),
          body: JSON.stringify({ object: 'portals', values: [{ name: 'Porta Principal' }] }),
        })
      );
    });

    await waitFor(() => {
      expect(screen.getByText('Porta Principal')).toBeInTheDocument();
    });
  });

  it('rejects an empty portal name client-side', async () => {
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (url) => {
      const urlString = String(url);
      if (urlString.includes('object=portals')) return ok(200, { portals: [] });
      return ok(404, {});
    });

    renderPortalsPage();

    await waitFor(() => {
      expect(screen.getByText('Nenhum portal cadastrado no momento.')).toBeInTheDocument();
    });

    await userEvent.click(screen.getByRole('button', { name: /novo portal/i }));
    const nameInput = screen.getByLabelText(/nome/i) as HTMLInputElement;
    nameInput.removeAttribute('required');
    await userEvent.click(screen.getByRole('button', { name: /^salvar$/i }));

    await waitFor(() => {
      expect(screen.getByText('O nome do portal é obrigatório')).toBeInTheDocument();
    });
  });

  it('edits a portal name via POST /modify_objects.fcgi?object=portals', async () => {
    let portalsList = [{ id: 1, name: 'Porta Principal' }];

    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockImplementation(async (url, init) => {
      const urlString = String(url);
      const method = init?.method ?? 'GET';

      if (urlString.includes('/load_objects.fcgi?object=portals')) {
        return ok(200, { portals: portalsList });
      }
      if (urlString.includes('/modify_objects.fcgi') && method === 'POST') {
        const body = JSON.parse(String(init?.body));
        portalsList = portalsList.map((p) => (p.id === body.where.id ? { ...p, name: body.values.name } : p));
        return ok(200, { changes: 1 });
      }
      return ok(404, {});
    });

    renderPortalsPage();

    await waitFor(() => {
      expect(screen.getByText('Porta Principal')).toBeInTheDocument();
    });

    await userEvent.click(screen.getByRole('button', { name: /editar porta principal/i }));
    const nameInput = screen.getByLabelText(/nome/i);
    await userEvent.clear(nameInput);
    await userEvent.type(nameInput, 'Porta dos Fundos');
    await userEvent.click(screen.getByRole('button', { name: /salvar alterações/i }));

    await waitFor(() => {
      expect(fetchSpy).toHaveBeenCalledWith(
        expect.stringContaining('/modify_objects.fcgi?object=portals&session=auth-token-999'),
        expect.objectContaining({
          method: 'POST',
          body: JSON.stringify({ object: 'portals', values: { name: 'Porta dos Fundos' }, where: { id: 1 } }),
        })
      );
    });

    await waitFor(() => {
      expect(screen.getByText('Porta dos Fundos')).toBeInTheDocument();
    });
  });

  it('deletes a portal via POST /destroy_objects.fcgi?object=portals', async () => {
    let portalsList = [{ id: 1, name: 'Porta Principal' }];

    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockImplementation(async (url, init) => {
      const urlString = String(url);
      const method = init?.method ?? 'GET';

      if (urlString.includes('/load_objects.fcgi?object=portals')) {
        return ok(200, { portals: portalsList });
      }
      if (urlString.includes('/destroy_objects.fcgi') && method === 'POST') {
        const body = JSON.parse(String(init?.body));
        portalsList = portalsList.filter((p) => p.id !== body.where.id);
        return ok(200, { changes: 1 });
      }
      return ok(404, {});
    });

    renderPortalsPage();

    await waitFor(() => {
      expect(screen.getByText('Porta Principal')).toBeInTheDocument();
    });

    await userEvent.click(screen.getByRole('button', { name: /excluir porta principal/i }));
    await userEvent.click(screen.getByRole('button', { name: /confirmar exclusão/i }));

    await waitFor(() => {
      expect(fetchSpy).toHaveBeenCalledWith(
        expect.stringContaining('/destroy_objects.fcgi?object=portals&session=auth-token-999'),
        expect.objectContaining({
          method: 'POST',
          body: JSON.stringify({ object: 'portals', where: { id: 1 } }),
        })
      );
    });

    await waitFor(() => {
      expect(screen.getByText('Nenhum portal cadastrado no momento.')).toBeInTheDocument();
    });
  });

  it('shows the friendly 400 error and keeps the portal when delete is blocked by an access rule', async () => {
    const portalsList = [{ id: 1, name: 'Porta Principal' }];

    vi.spyOn(globalThis, 'fetch').mockImplementation(async (url, init) => {
      const urlString = String(url);
      const method = init?.method ?? 'GET';

      if (urlString.includes('/load_objects.fcgi?object=portals')) {
        return ok(200, { portals: portalsList });
      }
      if (urlString.includes('/destroy_objects.fcgi') && method === 'POST') {
        return ok(400, { 'error-description': 'Cannot delete portals: still referenced by another object' });
      }
      return ok(404, {});
    });

    renderPortalsPage();

    await waitFor(() => {
      expect(screen.getByText('Porta Principal')).toBeInTheDocument();
    });

    await userEvent.click(screen.getByRole('button', { name: /excluir porta principal/i }));
    await userEvent.click(screen.getByRole('button', { name: /confirmar exclusão/i }));

    await waitFor(() => {
      expect(
        screen.getByText('Cannot delete portals: still referenced by another object')
      ).toBeInTheDocument();
    });
    // The portal remains in the list — the delete never went through.
    expect(screen.getAllByText('Porta Principal').length).toBeGreaterThan(0);
  });

  it('shows an error message when a .fcgi call fails', async () => {
    vi.spyOn(globalThis, 'fetch').mockImplementation(async () =>
      ok(500, { 'error-description': 'Erro interno' })
    );

    renderPortalsPage();

    await waitFor(() => {
      expect(screen.getByText('Erro interno')).toBeInTheDocument();
    });
  });
});
