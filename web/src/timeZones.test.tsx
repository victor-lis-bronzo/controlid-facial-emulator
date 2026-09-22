import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { TimeZonesPage } from './pages/TimeZonesPage.tsx';
import { AuthProvider } from './context/AuthContext.tsx';

function renderTimeZonesPage() {
  render(
    <AuthProvider>
      <MemoryRouter>
        <TimeZonesPage />
      </MemoryRouter>
    </AuthProvider>
  );
}

function ok(status: number, body: unknown): Response {
  return { ok: status < 400, status, text: async () => JSON.stringify(body) } as Response;
}

describe('Time Zones CRUD via .fcgi', () => {
  beforeEach(() => {
    localStorage.clear();
    localStorage.setItem('controlid_session', 'auth-token-999');
    vi.restoreAllMocks();
  });

  it('loads the time zone list and shows the interval count', async () => {
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (url) => {
      const urlString = String(url);
      if (urlString.includes('/load_objects.fcgi?object=time_zones')) {
        return ok(200, { time_zones: [{ id: 1, name: 'Comercial' }] });
      }
      if (urlString.includes('/load_objects.fcgi?object=time_spans')) {
        return ok(200, {
          time_spans: [
            { id: 1, time_zone_id: 1 },
            { id: 2, time_zone_id: 1 },
          ],
        });
      }
      return ok(404, {});
    });

    renderTimeZonesPage();

    await waitFor(() => {
      expect(screen.getByText('Comercial')).toBeInTheDocument();
    });
    expect(screen.getByText('2')).toBeInTheDocument();
  });

  it('shows an explicit empty state when no time zones exist', async () => {
    vi.spyOn(globalThis, 'fetch').mockImplementation(async () => ok(200, {}));

    renderTimeZonesPage();

    await waitFor(() => {
      expect(screen.getByText('Nenhum horário cadastrado no momento.')).toBeInTheDocument();
    });
  });

  it('creates a new time zone consuming POST /create_objects.fcgi?object=time_zones and reloads the list', async () => {
    let timeZonesList: { id: number; name: string }[] = [];

    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockImplementation(async (url, init) => {
      const urlString = String(url);
      const method = init?.method ?? 'GET';

      if (urlString.includes('/load_objects.fcgi?object=time_zones')) {
        return ok(200, { time_zones: timeZonesList });
      }
      if (urlString.includes('/load_objects.fcgi?object=time_spans')) {
        return ok(200, { time_spans: [] });
      }
      if (urlString.includes('/create_objects.fcgi') && method === 'POST') {
        const body = JSON.parse(String(init?.body));
        timeZonesList = [...timeZonesList, { id: 1, name: body.values[0].name }];
        return ok(200, { ids: [1] });
      }
      return ok(404, {});
    });

    renderTimeZonesPage();

    await waitFor(() => {
      expect(screen.getByText('Nenhum horário cadastrado no momento.')).toBeInTheDocument();
    });

    await userEvent.click(screen.getByRole('button', { name: /novo horário/i }));
    await userEvent.type(screen.getByLabelText(/nome/i), 'Comercial');
    await userEvent.click(screen.getByRole('button', { name: /salvar/i }));

    await waitFor(() => {
      expect(fetchSpy).toHaveBeenCalledWith(
        expect.stringContaining('/create_objects.fcgi?object=time_zones&session=auth-token-999'),
        expect.objectContaining({
          method: 'POST',
          headers: expect.objectContaining({ 'Content-Type': 'application/json' }),
          body: JSON.stringify({ object: 'time_zones', values: [{ name: 'Comercial' }] }),
        })
      );
    });

    await waitFor(() => {
      expect(screen.getByText('Comercial')).toBeInTheDocument();
    });
  });

  it('rejects an empty time zone name client-side', async () => {
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (url) => {
      const urlString = String(url);
      if (urlString.includes('object=time_zones')) return ok(200, { time_zones: [] });
      if (urlString.includes('object=time_spans')) return ok(200, { time_spans: [] });
      return ok(404, {});
    });

    renderTimeZonesPage();

    await waitFor(() => {
      expect(screen.getByText('Nenhum horário cadastrado no momento.')).toBeInTheDocument();
    });

    await userEvent.click(screen.getByRole('button', { name: /novo horário/i }));
    const nameInput = screen.getByLabelText(/nome/i) as HTMLInputElement;
    // Bypass the native `required` attribute so the component's own validation runs.
    nameInput.removeAttribute('required');
    await userEvent.click(screen.getByRole('button', { name: /^salvar$/i }));

    await waitFor(() => {
      expect(screen.getByText('O nome do horário é obrigatório')).toBeInTheDocument();
    });
  });

  it('edits a time zone name via POST /modify_objects.fcgi?object=time_zones', async () => {
    let timeZonesList = [{ id: 1, name: 'Comercial' }];

    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockImplementation(async (url, init) => {
      const urlString = String(url);
      const method = init?.method ?? 'GET';

      if (urlString.includes('/load_objects.fcgi?object=time_zones')) {
        return ok(200, { time_zones: timeZonesList });
      }
      if (urlString.includes('/load_objects.fcgi?object=time_spans')) {
        return ok(200, { time_spans: [] });
      }
      if (urlString.includes('/modify_objects.fcgi') && method === 'POST') {
        const body = JSON.parse(String(init?.body));
        timeZonesList = timeZonesList.map((tz) =>
          tz.id === body.where.id ? { ...tz, name: body.values.name } : tz
        );
        return ok(200, { changes: 1 });
      }
      return ok(404, {});
    });

    renderTimeZonesPage();

    await waitFor(() => {
      expect(screen.getByText('Comercial')).toBeInTheDocument();
    });

    await userEvent.click(screen.getByRole('button', { name: /editar comercial/i }));
    const nameInput = screen.getByLabelText(/nome/i);
    await userEvent.clear(nameInput);
    await userEvent.type(nameInput, 'Noturno');
    await userEvent.click(screen.getByRole('button', { name: /salvar alterações/i }));

    await waitFor(() => {
      expect(fetchSpy).toHaveBeenCalledWith(
        expect.stringContaining('/modify_objects.fcgi?object=time_zones&session=auth-token-999'),
        expect.objectContaining({
          method: 'POST',
          body: JSON.stringify({ object: 'time_zones', values: { name: 'Noturno' }, where: { id: 1 } }),
        })
      );
    });

    await waitFor(() => {
      expect(screen.getByText('Noturno')).toBeInTheDocument();
    });
  });

  it('deletes a time zone via POST /destroy_objects.fcgi?object=time_zones', async () => {
    let timeZonesList = [{ id: 1, name: 'Comercial' }];

    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockImplementation(async (url, init) => {
      const urlString = String(url);
      const method = init?.method ?? 'GET';

      if (urlString.includes('/load_objects.fcgi?object=time_zones')) {
        return ok(200, { time_zones: timeZonesList });
      }
      if (urlString.includes('/load_objects.fcgi?object=time_spans')) {
        return ok(200, { time_spans: [] });
      }
      if (urlString.includes('/destroy_objects.fcgi') && method === 'POST') {
        const body = JSON.parse(String(init?.body));
        timeZonesList = timeZonesList.filter((tz) => tz.id !== body.where.id);
        return ok(200, { changes: 1 });
      }
      return ok(404, {});
    });

    renderTimeZonesPage();

    await waitFor(() => {
      expect(screen.getByText('Comercial')).toBeInTheDocument();
    });

    await userEvent.click(screen.getByRole('button', { name: /excluir comercial/i }));
    await userEvent.click(screen.getByRole('button', { name: /confirmar exclusão/i }));

    await waitFor(() => {
      expect(fetchSpy).toHaveBeenCalledWith(
        expect.stringContaining('/destroy_objects.fcgi?object=time_zones&session=auth-token-999'),
        expect.objectContaining({
          method: 'POST',
          body: JSON.stringify({ object: 'time_zones', where: { id: 1 } }),
        })
      );
    });

    await waitFor(() => {
      expect(screen.getByText('Nenhum horário cadastrado no momento.')).toBeInTheDocument();
    });
  });

  it('shows an error message when a .fcgi call fails', async () => {
    vi.spyOn(globalThis, 'fetch').mockImplementation(async () =>
      ok(500, { 'error-description': 'Erro interno' })
    );

    renderTimeZonesPage();

    await waitFor(() => {
      expect(screen.getByText('Erro interno')).toBeInTheDocument();
    });
  });
});
