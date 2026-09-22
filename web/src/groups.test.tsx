import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { GroupsPage } from './pages/GroupsPage.tsx';
import { AuthProvider } from './context/AuthContext.tsx';

function renderGroupsPage() {
  render(
    <AuthProvider>
      <MemoryRouter>
        <GroupsPage />
      </MemoryRouter>
    </AuthProvider>
  );
}

describe('Groups CRUD via .fcgi', () => {
  beforeEach(() => {
    localStorage.clear();
    localStorage.setItem('controlid_session', 'auth-token-999');
    vi.restoreAllMocks();
  });

  it('loads the group list and shows the member count', async () => {
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (url) => {
      const urlString = String(url);
      if (urlString.includes('/load_objects.fcgi?object=groups')) {
        return {
          ok: true,
          status: 200,
          text: async () => JSON.stringify({ groups: [{ id: 1, name: 'Administradores' }] }),
        } as Response;
      }
      if (urlString.includes('/load_objects.fcgi?object=user_groups')) {
        return {
          ok: true,
          status: 200,
          text: async () =>
            JSON.stringify({
              user_groups: [
                { user_id: 1, group_id: 1 },
                { user_id: 2, group_id: 1 },
              ],
            }),
        } as Response;
      }
      return { ok: false, status: 404, text: async () => '' } as Response;
    });

    renderGroupsPage();

    await waitFor(() => {
      expect(screen.getByText('Administradores')).toBeInTheDocument();
    });
    expect(screen.getByText('2')).toBeInTheDocument();
  });

  it('shows an explicit empty state when no groups exist', async () => {
    vi.spyOn(globalThis, 'fetch').mockImplementation(async () => {
      return { ok: true, status: 200, text: async () => JSON.stringify({}) } as Response;
    });

    renderGroupsPage();

    await waitFor(() => {
      expect(screen.getByText('Nenhum grupo cadastrado no momento.')).toBeInTheDocument();
    });
  });

  it('creates a new group consuming POST /create_objects.fcgi?object=groups and reloads the list', async () => {
    let groupsList: { id: number; name: string }[] = [];

    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockImplementation(async (url, init) => {
      const urlString = String(url);
      const method = init?.method ?? 'GET';

      if (urlString.includes('/load_objects.fcgi?object=groups')) {
        return { ok: true, status: 200, text: async () => JSON.stringify({ groups: groupsList }) } as Response;
      }
      if (urlString.includes('/load_objects.fcgi?object=user_groups')) {
        return { ok: true, status: 200, text: async () => JSON.stringify({ user_groups: [] }) } as Response;
      }
      if (urlString.includes('/create_objects.fcgi') && method === 'POST') {
        const body = JSON.parse(String(init?.body));
        groupsList = [...groupsList, { id: 1, name: body.values[0].name }];
        return { ok: true, status: 200, text: async () => JSON.stringify({ ids: [1] }) } as Response;
      }
      return { ok: false, status: 404, text: async () => '' } as Response;
    });

    renderGroupsPage();

    await waitFor(() => {
      expect(screen.getByText('Nenhum grupo cadastrado no momento.')).toBeInTheDocument();
    });

    await userEvent.click(screen.getByRole('button', { name: /novo grupo/i }));
    await userEvent.type(screen.getByLabelText(/nome/i), 'Administradores');
    await userEvent.click(screen.getByRole('button', { name: /salvar/i }));

    await waitFor(() => {
      expect(fetchSpy).toHaveBeenCalledWith(
        expect.stringContaining('/create_objects.fcgi?object=groups&session=auth-token-999'),
        expect.objectContaining({
          method: 'POST',
          headers: expect.objectContaining({ 'Content-Type': 'application/json' }),
          body: JSON.stringify({ object: 'groups', values: [{ name: 'Administradores' }] }),
        })
      );
    });

    await waitFor(() => {
      expect(screen.getByText('Administradores')).toBeInTheDocument();
    });
  });

  it('edits a group name via POST /modify_objects.fcgi?object=groups', async () => {
    let groupsList = [{ id: 1, name: 'Administradores' }];

    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockImplementation(async (url, init) => {
      const urlString = String(url);
      const method = init?.method ?? 'GET';

      if (urlString.includes('/load_objects.fcgi?object=groups')) {
        return { ok: true, status: 200, text: async () => JSON.stringify({ groups: groupsList }) } as Response;
      }
      if (urlString.includes('/load_objects.fcgi?object=user_groups')) {
        return { ok: true, status: 200, text: async () => JSON.stringify({ user_groups: [] }) } as Response;
      }
      if (urlString.includes('/modify_objects.fcgi') && method === 'POST') {
        const body = JSON.parse(String(init?.body));
        groupsList = groupsList.map((g) => (g.id === body.where.id ? { ...g, name: body.values.name } : g));
        return { ok: true, status: 200, text: async () => JSON.stringify({ changes: 1 }) } as Response;
      }
      return { ok: false, status: 404, text: async () => '' } as Response;
    });

    renderGroupsPage();

    await waitFor(() => {
      expect(screen.getByText('Administradores')).toBeInTheDocument();
    });

    await userEvent.click(screen.getByRole('button', { name: /editar administradores/i }));
    const nameInput = screen.getByLabelText(/nome/i);
    await userEvent.clear(nameInput);
    await userEvent.type(nameInput, 'Gestores');
    await userEvent.click(screen.getByRole('button', { name: /salvar alterações/i }));

    await waitFor(() => {
      expect(fetchSpy).toHaveBeenCalledWith(
        expect.stringContaining('/modify_objects.fcgi?object=groups&session=auth-token-999'),
        expect.objectContaining({
          method: 'POST',
          body: JSON.stringify({ object: 'groups', values: { name: 'Gestores' }, where: { id: 1 } }),
        })
      );
    });

    await waitFor(() => {
      expect(screen.getByText('Gestores')).toBeInTheDocument();
    });
  });

  it('deletes a group via POST /destroy_objects.fcgi?object=groups', async () => {
    let groupsList = [{ id: 1, name: 'Administradores' }];

    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockImplementation(async (url, init) => {
      const urlString = String(url);
      const method = init?.method ?? 'GET';

      if (urlString.includes('/load_objects.fcgi?object=groups')) {
        return { ok: true, status: 200, text: async () => JSON.stringify({ groups: groupsList }) } as Response;
      }
      if (urlString.includes('/load_objects.fcgi?object=user_groups')) {
        return { ok: true, status: 200, text: async () => JSON.stringify({ user_groups: [] }) } as Response;
      }
      if (urlString.includes('/destroy_objects.fcgi') && method === 'POST') {
        const body = JSON.parse(String(init?.body));
        groupsList = groupsList.filter((g) => g.id !== body.where.id);
        return { ok: true, status: 200, text: async () => JSON.stringify({ changes: 1 }) } as Response;
      }
      return { ok: false, status: 404, text: async () => '' } as Response;
    });

    renderGroupsPage();

    await waitFor(() => {
      expect(screen.getByText('Administradores')).toBeInTheDocument();
    });

    await userEvent.click(screen.getByRole('button', { name: /excluir administradores/i }));
    await userEvent.click(screen.getByRole('button', { name: /confirmar exclusão/i }));

    await waitFor(() => {
      expect(fetchSpy).toHaveBeenCalledWith(
        expect.stringContaining('/destroy_objects.fcgi?object=groups&session=auth-token-999'),
        expect.objectContaining({
          method: 'POST',
          body: JSON.stringify({ object: 'groups', where: { id: 1 } }),
        })
      );
    });

    await waitFor(() => {
      expect(screen.getByText('Nenhum grupo cadastrado no momento.')).toBeInTheDocument();
    });
  });

  it('shows an error message when a .fcgi call fails', async () => {
    vi.spyOn(globalThis, 'fetch').mockImplementation(async () => {
      return {
        ok: false,
        status: 500,
        text: async () => JSON.stringify({ 'error-description': 'Erro interno' }),
      } as Response;
    });

    renderGroupsPage();

    await waitFor(() => {
      expect(screen.getByText('Erro interno')).toBeInTheDocument();
    });
  });
});
