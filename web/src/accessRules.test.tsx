import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { AccessRulesPage } from './pages/AccessRulesPage.tsx';
import { AuthProvider } from './context/AuthContext.tsx';

function renderAccessRulesPage() {
  render(
    <AuthProvider>
      <MemoryRouter>
        <AccessRulesPage />
      </MemoryRouter>
    </AuthProvider>
  );
}

function ok(status: number, body: unknown): Response {
  return { ok: status < 400, status, text: async () => JSON.stringify(body) } as Response;
}

describe('Access Rules CRUD via .fcgi', () => {
  beforeEach(() => {
    localStorage.clear();
    localStorage.setItem('controlid_session', 'auth-token-999');
    vi.restoreAllMocks();
  });

  it('loads the access rule list', async () => {
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (url) => {
      const urlString = String(url);
      if (urlString.includes('/load_objects.fcgi?object=access_rules')) {
        return ok(200, { access_rules: [{ id: 1, name: 'Acesso Administrativo' }] });
      }
      return ok(404, {});
    });

    renderAccessRulesPage();

    await waitFor(() => {
      expect(screen.getByText('Acesso Administrativo')).toBeInTheDocument();
    });
  });

  it('shows an explicit empty state when no access rules exist', async () => {
    vi.spyOn(globalThis, 'fetch').mockImplementation(async () => ok(200, {}));

    renderAccessRulesPage();

    await waitFor(() => {
      expect(screen.getByText('Nenhuma regra de acesso cadastrada no momento.')).toBeInTheDocument();
    });
  });

  it('creates a new access rule consuming POST /create_objects.fcgi?object=access_rules and reloads the list', async () => {
    let rulesList: { id: number; name: string }[] = [];

    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockImplementation(async (url, init) => {
      const urlString = String(url);
      const method = init?.method ?? 'GET';

      if (urlString.includes('/load_objects.fcgi?object=access_rules')) {
        return ok(200, { access_rules: rulesList });
      }
      if (urlString.includes('/create_objects.fcgi') && method === 'POST') {
        const body = JSON.parse(String(init?.body));
        rulesList = [...rulesList, { id: 1, name: body.values[0].name }];
        return ok(200, { ids: [1] });
      }
      return ok(404, {});
    });

    renderAccessRulesPage();

    await waitFor(() => {
      expect(screen.getByText('Nenhuma regra de acesso cadastrada no momento.')).toBeInTheDocument();
    });

    await userEvent.click(screen.getByRole('button', { name: /nova regra/i }));
    await userEvent.type(screen.getByLabelText(/nome/i), 'Acesso Administrativo');
    await userEvent.click(screen.getByRole('button', { name: /salvar/i }));

    await waitFor(() => {
      expect(fetchSpy).toHaveBeenCalledWith(
        expect.stringContaining('/create_objects.fcgi?object=access_rules&session=auth-token-999'),
        expect.objectContaining({
          method: 'POST',
          headers: expect.objectContaining({ 'Content-Type': 'application/json' }),
          body: JSON.stringify({ object: 'access_rules', values: [{ name: 'Acesso Administrativo' }] }),
        })
      );
    });

    await waitFor(() => {
      expect(screen.getByText('Acesso Administrativo')).toBeInTheDocument();
    });
  });

  it('rejects an empty access rule name client-side', async () => {
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (url) => {
      const urlString = String(url);
      if (urlString.includes('object=access_rules')) return ok(200, { access_rules: [] });
      return ok(404, {});
    });

    renderAccessRulesPage();

    await waitFor(() => {
      expect(screen.getByText('Nenhuma regra de acesso cadastrada no momento.')).toBeInTheDocument();
    });

    await userEvent.click(screen.getByRole('button', { name: /nova regra/i }));
    const nameInput = screen.getByLabelText(/nome/i) as HTMLInputElement;
    nameInput.removeAttribute('required');
    await userEvent.click(screen.getByRole('button', { name: /^salvar$/i }));

    await waitFor(() => {
      expect(screen.getByText('O nome da regra de acesso é obrigatório')).toBeInTheDocument();
    });
  });

  it('edits an access rule name via POST /modify_objects.fcgi?object=access_rules', async () => {
    let rulesList = [{ id: 1, name: 'Acesso Administrativo' }];

    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockImplementation(async (url, init) => {
      const urlString = String(url);
      const method = init?.method ?? 'GET';

      if (urlString.includes('/load_objects.fcgi?object=access_rules')) {
        return ok(200, { access_rules: rulesList });
      }
      if (urlString.includes('/modify_objects.fcgi') && method === 'POST') {
        const body = JSON.parse(String(init?.body));
        rulesList = rulesList.map((r) => (r.id === body.where.id ? { ...r, name: body.values.name } : r));
        return ok(200, { changes: 1 });
      }
      return ok(404, {});
    });

    renderAccessRulesPage();

    await waitFor(() => {
      expect(screen.getByText('Acesso Administrativo')).toBeInTheDocument();
    });

    await userEvent.click(screen.getByRole('button', { name: /editar acesso administrativo/i }));
    const nameInput = screen.getByLabelText(/nome/i);
    await userEvent.clear(nameInput);
    await userEvent.type(nameInput, 'Acesso Noturno');
    await userEvent.click(screen.getByRole('button', { name: /salvar alterações/i }));

    await waitFor(() => {
      expect(fetchSpy).toHaveBeenCalledWith(
        expect.stringContaining('/modify_objects.fcgi?object=access_rules&session=auth-token-999'),
        expect.objectContaining({
          method: 'POST',
          body: JSON.stringify({ object: 'access_rules', values: { name: 'Acesso Noturno' }, where: { id: 1 } }),
        })
      );
    });

    await waitFor(() => {
      expect(screen.getByText('Acesso Noturno')).toBeInTheDocument();
    });
  });

  it('deletes an access rule via POST /destroy_objects.fcgi?object=access_rules', async () => {
    let rulesList = [{ id: 1, name: 'Acesso Administrativo' }];

    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockImplementation(async (url, init) => {
      const urlString = String(url);
      const method = init?.method ?? 'GET';

      if (urlString.includes('/load_objects.fcgi?object=access_rules')) {
        return ok(200, { access_rules: rulesList });
      }
      if (urlString.includes('/destroy_objects.fcgi') && method === 'POST') {
        const body = JSON.parse(String(init?.body));
        rulesList = rulesList.filter((r) => r.id !== body.where.id);
        return ok(200, { changes: 1 });
      }
      return ok(404, {});
    });

    renderAccessRulesPage();

    await waitFor(() => {
      expect(screen.getByText('Acesso Administrativo')).toBeInTheDocument();
    });

    await userEvent.click(screen.getByRole('button', { name: /excluir acesso administrativo/i }));
    await userEvent.click(screen.getByRole('button', { name: /confirmar exclusão/i }));

    await waitFor(() => {
      expect(fetchSpy).toHaveBeenCalledWith(
        expect.stringContaining('/destroy_objects.fcgi?object=access_rules&session=auth-token-999'),
        expect.objectContaining({
          method: 'POST',
          body: JSON.stringify({ object: 'access_rules', where: { id: 1 } }),
        })
      );
    });

    await waitFor(() => {
      expect(screen.getByText('Nenhuma regra de acesso cadastrada no momento.')).toBeInTheDocument();
    });
  });

  it('shows an error message when a .fcgi call fails', async () => {
    vi.spyOn(globalThis, 'fetch').mockImplementation(async () =>
      ok(500, { 'error-description': 'Erro interno' })
    );

    renderAccessRulesPage();

    await waitFor(() => {
      expect(screen.getByText('Erro interno')).toBeInTheDocument();
    });
  });
});
