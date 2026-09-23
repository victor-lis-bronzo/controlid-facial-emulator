import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Routes, Route } from 'react-router-dom';
import { DashboardPage } from './pages/DashboardPage.tsx';
import { AuthProvider } from './context/AuthContext.tsx';

function renderDashboardPage() {
  render(
    <AuthProvider>
      <MemoryRouter initialEntries={['/admin/dashboard']}>
        <Routes>
          <Route path="/admin/dashboard" element={<DashboardPage />} />
          <Route path="/admin/groups" element={<div>Groups Screen Marker</div>} />
        </Routes>
      </MemoryRouter>
    </AuthProvider>
  );
}

function ok(status: number, body: unknown): Response {
  return { ok: status < 400, status, text: async () => JSON.stringify(body) } as Response;
}

function mockDashboardFetch(overrides: {
  users?: unknown[];
  groups?: unknown[];
  time_zones?: unknown[];
  portals?: unknown[];
  access_rules?: unknown[];
  access_logs?: unknown[];
  failObject?: string;
}) {
  return vi.spyOn(globalThis, 'fetch').mockImplementation(async (url) => {
    const urlString = String(url);

    if (overrides.failObject && urlString.includes(`object=${overrides.failObject}`)) {
      return ok(500, { 'error-description': 'Erro interno' });
    }
    if (urlString.includes('/load_objects.fcgi?object=users')) {
      return ok(200, { users: overrides.users ?? [{ id: 1 }, { id: 2 }] });
    }
    if (urlString.includes('/load_objects.fcgi?object=groups')) {
      return ok(200, { groups: overrides.groups ?? [{ id: 1 }] });
    }
    if (urlString.includes('/load_objects.fcgi?object=time_zones')) {
      return ok(200, { time_zones: overrides.time_zones ?? [{ id: 1 }] });
    }
    if (urlString.includes('/load_objects.fcgi?object=portals')) {
      return ok(200, { portals: overrides.portals ?? [{ id: 1 }] });
    }
    if (urlString.includes('/load_objects.fcgi?object=access_rules')) {
      return ok(200, { access_rules: overrides.access_rules ?? [{ id: 1 }] });
    }
    if (urlString.includes('/load_objects.fcgi?object=access_logs')) {
      return ok(200, { access_logs: overrides.access_logs ?? [{ id: 1 }, { id: 2 }, { id: 3 }] });
    }
    return ok(404, {});
  });
}

describe('Dashboard count cards', () => {
  beforeEach(() => {
    localStorage.clear();
    localStorage.setItem('controlid_session', 'auth-token-999');
    vi.restoreAllMocks();
  });

  it('shows the correct count for each entity and the access logs total', async () => {
    mockDashboardFetch({
      users: [{ id: 1 }, { id: 2 }, { id: 3 }],
      groups: [{ id: 1 }],
      time_zones: [{ id: 1 }, { id: 2 }],
      portals: [{ id: 1 }],
      access_rules: [{ id: 1 }, { id: 2 }, { id: 3 }, { id: 4 }],
      access_logs: [{ id: 1 }, { id: 2 }, { id: 3 }, { id: 4 }, { id: 5 }],
    });

    renderDashboardPage();

    await waitFor(() => {
      expect(screen.getByText('Usuários')).toBeInTheDocument();
    });

    const usersCard = screen.getByText('Usuários').closest('button');
    expect(usersCard).toHaveTextContent('3');

    const groupsCard = screen.getByText('Grupos').closest('button');
    expect(groupsCard).toHaveTextContent('1');

    const timeZonesCard = screen.getByText('Horários').closest('button');
    expect(timeZonesCard).toHaveTextContent('2');

    const portalsCard = screen.getByText('Portais').closest('button');
    expect(portalsCard).toHaveTextContent('1');

    const accessRulesCard = screen.getByText('Regras de Acesso').closest('button');
    expect(accessRulesCard).toHaveTextContent('4');

    const accessLogsCard = screen.getByText('Logs de Acesso').closest('.rounded-xl');
    expect(accessLogsCard).toHaveTextContent('5');
  });

  it('navigates to the entity screen when a count card is clicked', async () => {
    mockDashboardFetch({});

    renderDashboardPage();

    await waitFor(() => {
      expect(screen.getByText('Usuários')).toBeInTheDocument();
    });

    await userEvent.click(screen.getByText('Grupos').closest('button')!);

    await waitFor(() => {
      expect(screen.getByText('Groups Screen Marker')).toBeInTheDocument();
    });
  });

  it('the Access Logs card is not clickable (plain div, not a button)', async () => {
    mockDashboardFetch({});

    renderDashboardPage();

    await waitFor(() => {
      expect(screen.getByText('Logs de Acesso')).toBeInTheDocument();
    });

    expect(screen.getByText('Logs de Acesso').closest('button')).toBeNull();
  });

  it('shows an error message when a .fcgi call fails', async () => {
    mockDashboardFetch({ failObject: 'groups' });

    renderDashboardPage();

    await waitFor(() => {
      expect(screen.getByText('Erro interno')).toBeInTheDocument();
    });
  });
});
