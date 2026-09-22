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
      // The edit modal always loads the three association checklists too —
      // return one entry each, already associated, so the "at least one
      // checked per checklist" guard doesn't block this name-only edit.
      if (urlString.includes('/load_objects.fcgi?object=groups')) {
        return ok(200, { groups: [{ id: 10, name: 'Administradores' }] });
      }
      if (urlString.includes('/load_objects.fcgi?object=time_zones')) {
        return ok(200, { time_zones: [{ id: 30, name: 'Comercial' }] });
      }
      if (urlString.includes('/load_objects.fcgi?object=portals')) {
        return ok(200, { portals: [{ id: 40, name: 'Porta Principal' }] });
      }
      if (urlString.includes('/load_objects.fcgi?object=group_access_rules')) {
        return ok(200, { group_access_rules: [{ group_id: 10, access_rule_id: 1 }] });
      }
      if (urlString.includes('/load_objects.fcgi?object=access_rule_time_zones')) {
        return ok(200, { access_rule_time_zones: [{ access_rule_id: 1, time_zone_id: 30 }] });
      }
      if (urlString.includes('/load_objects.fcgi?object=portal_access_rules')) {
        return ok(200, { portal_access_rules: [{ portal_id: 40, access_rule_id: 1 }] });
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
    await waitFor(() => {
      expect(screen.getByLabelText('Administradores')).toBeChecked();
    });
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

describe('Access Rules association management', () => {
  beforeEach(() => {
    localStorage.clear();
    localStorage.setItem('controlid_session', 'auth-token-999');
    vi.restoreAllMocks();
  });

  const rulesList = [{ id: 1, name: 'Acesso Administrativo' }];
  const groupsList = [
    { id: 10, name: 'Administradores' },
    { id: 20, name: 'Visitantes' },
  ];
  const timeZonesList = [
    { id: 30, name: 'Comercial' },
    { id: 31, name: 'Noturno' },
  ];
  const portalsList = [{ id: 40, name: 'Porta Principal' }];

  function mockAssociationFetch(overrides: {
    groupAccessRules?: { group_id: number; access_rule_id: number }[];
    accessRuleTimeZones?: { access_rule_id: number; time_zone_id: number }[];
    portalAccessRules?: { portal_id: number; access_rule_id: number }[];
    onCreate?: (object: string, values: Record<string, unknown>) => void;
    onDestroy?: (object: string, where: Record<string, unknown>) => void;
  }) {
    const groupAccessRules = overrides.groupAccessRules ?? [{ group_id: 10, access_rule_id: 1 }];
    const accessRuleTimeZones = overrides.accessRuleTimeZones ?? [{ access_rule_id: 1, time_zone_id: 30 }];
    const portalAccessRules = overrides.portalAccessRules ?? [{ portal_id: 40, access_rule_id: 1 }];

    return vi.spyOn(globalThis, 'fetch').mockImplementation(async (url, init) => {
      const urlString = String(url);
      const method = init?.method ?? 'GET';
      const body = init?.body ? JSON.parse(String(init.body)) : undefined;

      if (urlString.includes('/load_objects.fcgi?object=access_rules')) {
        return ok(200, { access_rules: rulesList });
      }
      if (urlString.includes('/load_objects.fcgi?object=groups')) {
        return ok(200, { groups: groupsList });
      }
      if (urlString.includes('/load_objects.fcgi?object=time_zones')) {
        return ok(200, { time_zones: timeZonesList });
      }
      if (urlString.includes('/load_objects.fcgi?object=portals')) {
        return ok(200, { portals: portalsList });
      }
      if (urlString.includes('/load_objects.fcgi?object=group_access_rules')) {
        return ok(200, { group_access_rules: groupAccessRules });
      }
      if (urlString.includes('/load_objects.fcgi?object=access_rule_time_zones')) {
        return ok(200, { access_rule_time_zones: accessRuleTimeZones });
      }
      if (urlString.includes('/load_objects.fcgi?object=portal_access_rules')) {
        return ok(200, { portal_access_rules: portalAccessRules });
      }
      if (urlString.includes('/create_objects.fcgi') && method === 'POST') {
        overrides.onCreate?.(body.object, body.values[0]);
        return ok(200, { ids: [999] });
      }
      if (urlString.includes('/destroy_objects.fcgi') && method === 'POST') {
        overrides.onDestroy?.(body.object, body.where);
        return ok(200, { changes: 1 });
      }
      return ok(404, {});
    });
  }

  it('pre-checks each checklist with the rule current associations', async () => {
    mockAssociationFetch({});

    renderAccessRulesPage();

    await waitFor(() => {
      expect(screen.getByText('Acesso Administrativo')).toBeInTheDocument();
    });

    await userEvent.click(screen.getByRole('button', { name: /editar acesso administrativo/i }));

    await waitFor(() => {
      expect(screen.getByLabelText('Administradores')).toBeChecked();
    });
    expect(screen.getByLabelText('Visitantes')).not.toBeChecked();
    expect(screen.getByLabelText('Comercial')).toBeChecked();
    expect(screen.getByLabelText('Porta Principal')).toBeChecked();
  });

  it('adds a group consuming POST /create_objects.fcgi?object=group_access_rules', async () => {
    const created: { object: string; values: Record<string, unknown> }[] = [];
    mockAssociationFetch({ onCreate: (object, values) => created.push({ object, values }) });

    renderAccessRulesPage();

    await waitFor(() => {
      expect(screen.getByText('Acesso Administrativo')).toBeInTheDocument();
    });

    await userEvent.click(screen.getByRole('button', { name: /editar acesso administrativo/i }));
    await waitFor(() => {
      expect(screen.getByLabelText('Visitantes')).toBeInTheDocument();
    });

    await userEvent.click(screen.getByLabelText('Visitantes'));
    await userEvent.click(screen.getByRole('button', { name: /salvar alterações/i }));

    await waitFor(() => {
      expect(created).toContainEqual({
        object: 'group_access_rules',
        values: { group_id: 20, access_rule_id: 1 },
      });
    });
  });

  it('removes a time zone consuming POST /destroy_objects.fcgi?object=access_rule_time_zones', async () => {
    const destroyed: { object: string; where: Record<string, unknown> }[] = [];
    // Rule starts associated with BOTH time zones, so unchecking one still
    // leaves the checklist with >=1 entry checked (required to save).
    mockAssociationFetch({
      accessRuleTimeZones: [
        { access_rule_id: 1, time_zone_id: 30 },
        { access_rule_id: 1, time_zone_id: 31 },
      ],
      onDestroy: (object, where) => destroyed.push({ object, where }),
    });

    renderAccessRulesPage();

    await waitFor(() => {
      expect(screen.getByText('Acesso Administrativo')).toBeInTheDocument();
    });

    await userEvent.click(screen.getByRole('button', { name: /editar acesso administrativo/i }));
    await waitFor(() => {
      expect(screen.getByLabelText('Comercial')).toBeChecked();
    });
    expect(screen.getByLabelText('Noturno')).toBeChecked();

    await userEvent.click(screen.getByLabelText('Comercial'));
    await userEvent.click(screen.getByRole('button', { name: /salvar alterações/i }));

    await waitFor(() => {
      expect(destroyed).toContainEqual({
        object: 'access_rule_time_zones',
        where: { access_rule_id: 1, time_zone_id: 30 },
      });
    });
  });

  it('rejects saving when a checklist has zero entries checked', async () => {
    mockAssociationFetch({ portalAccessRules: [] });

    renderAccessRulesPage();

    await waitFor(() => {
      expect(screen.getByText('Acesso Administrativo')).toBeInTheDocument();
    });

    await userEvent.click(screen.getByRole('button', { name: /editar acesso administrativo/i }));
    await waitFor(() => {
      expect(screen.getByLabelText('Porta Principal')).not.toBeChecked();
    });

    await userEvent.click(screen.getByRole('button', { name: /salvar alterações/i }));

    await waitFor(() => {
      expect(screen.getByText('Selecione ao menos um portal')).toBeInTheDocument();
    });
  });
});
