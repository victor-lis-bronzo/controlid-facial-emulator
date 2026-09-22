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

describe('Time Zones interval management', () => {
  beforeEach(() => {
    localStorage.clear();
    localStorage.setItem('controlid_session', 'auth-token-999');
    vi.restoreAllMocks();
  });

  it('adds an interval consuming POST /create_objects.fcgi?object=time_spans with HH:MM converted to seconds', async () => {
    const timeZonesList = [{ id: 1, name: 'Comercial' }];
    let spansList: Record<string, unknown>[] = [];

    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockImplementation(async (url, init) => {
      const urlString = String(url);
      const method = init?.method ?? 'GET';
      const body = init?.body ? JSON.parse(String(init.body)) : undefined;

      if (urlString.includes('/load_objects.fcgi?object=time_zones')) {
        return ok(200, { time_zones: timeZonesList });
      }
      if (urlString.includes('/load_objects.fcgi?object=time_spans')) {
        if (body?.where?.time_zone_id) {
          return ok(200, { time_spans: spansList.filter((s) => s.time_zone_id === body.where.time_zone_id) });
        }
        return ok(200, { time_spans: spansList });
      }
      if (urlString.includes('/create_objects.fcgi') && method === 'POST' && body.object === 'time_spans') {
        const created = { id: 1, ...body.values[0] };
        spansList = [...spansList, created];
        return ok(200, { ids: [1] });
      }
      return ok(404, {});
    });

    renderTimeZonesPage();

    await waitFor(() => {
      expect(screen.getByText('Comercial')).toBeInTheDocument();
    });

    await userEvent.click(screen.getByRole('button', { name: /editar comercial/i }));
    await waitFor(() => {
      expect(screen.getByText('Nenhum intervalo cadastrado.')).toBeInTheDocument();
    });

    await userEvent.click(screen.getByRole('button', { name: /adicionar intervalo/i }));
    await userEvent.click(screen.getByLabelText('Seg'));

    const startInput = screen.getByLabelText(/início do intervalo/i);
    await userEvent.clear(startInput);
    await userEvent.type(startInput, '09:00');
    const endInput = screen.getByLabelText(/término do intervalo/i);
    await userEvent.clear(endInput);
    await userEvent.type(endInput, '18:00');

    await userEvent.click(screen.getByRole('button', { name: /salvar alterações/i }));

    await waitFor(() => {
      expect(fetchSpy).toHaveBeenCalledWith(
        expect.stringContaining('/create_objects.fcgi?object=time_spans&session=auth-token-999'),
        expect.objectContaining({
          method: 'POST',
          body: JSON.stringify({
            object: 'time_spans',
            values: [
              {
                time_zone_id: '1',
                start: '32400',
                end: '64800',
                sun: '0',
                mon: '1',
                tue: '0',
                wed: '0',
                thu: '0',
                fri: '0',
                sat: '0',
                hol1: '0',
                hol2: '0',
                hol3: '0',
              },
            ],
          }),
        })
      );
    });
  });

  it('removes an interval consuming POST /destroy_objects.fcgi?object=time_spans', async () => {
    const timeZonesList = [{ id: 1, name: 'Comercial' }];
    let spansList = [
      {
        id: 5,
        time_zone_id: 1,
        start: '0',
        end: '3600',
        sun: '1',
        mon: '1',
        tue: '1',
        wed: '1',
        thu: '1',
        fri: '1',
        sat: '1',
      },
    ];

    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockImplementation(async (url, init) => {
      const urlString = String(url);
      const method = init?.method ?? 'GET';
      const body = init?.body ? JSON.parse(String(init.body)) : undefined;

      if (urlString.includes('/load_objects.fcgi?object=time_zones')) {
        return ok(200, { time_zones: timeZonesList });
      }
      if (urlString.includes('/load_objects.fcgi?object=time_spans')) {
        if (body?.where?.time_zone_id) {
          return ok(200, { time_spans: spansList.filter((s) => s.time_zone_id === body.where.time_zone_id) });
        }
        return ok(200, { time_spans: spansList });
      }
      if (urlString.includes('/destroy_objects.fcgi') && method === 'POST' && body.object === 'time_spans') {
        spansList = spansList.filter((s) => s.id !== body.where.id);
        return ok(200, { changes: 1 });
      }
      return ok(404, {});
    });

    renderTimeZonesPage();

    await waitFor(() => {
      expect(screen.getByText('Comercial')).toBeInTheDocument();
    });

    await userEvent.click(screen.getByRole('button', { name: /editar comercial/i }));
    await waitFor(() => {
      expect(screen.getByRole('button', { name: /remover intervalo/i })).toBeInTheDocument();
    });

    await userEvent.click(screen.getByRole('button', { name: /remover intervalo/i }));
    await userEvent.click(screen.getByRole('button', { name: /salvar alterações/i }));

    await waitFor(() => {
      expect(fetchSpy).toHaveBeenCalledWith(
        expect.stringContaining('/destroy_objects.fcgi?object=time_spans&session=auth-token-999'),
        expect.objectContaining({
          method: 'POST',
          body: JSON.stringify({ object: 'time_spans', where: { id: 5 } }),
        })
      );
    });
  });

  it('edits an existing interval by destroying the old row and creating the new one', async () => {
    const timeZonesList = [{ id: 1, name: 'Comercial' }];
    let spansList = [
      {
        id: 5,
        time_zone_id: 1,
        start: '0',
        end: '3600',
        sun: '1',
        mon: '1',
        tue: '1',
        wed: '1',
        thu: '1',
        fri: '1',
        sat: '1',
      },
    ];

    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockImplementation(async (url, init) => {
      const urlString = String(url);
      const method = init?.method ?? 'GET';
      const body = init?.body ? JSON.parse(String(init.body)) : undefined;

      if (urlString.includes('/load_objects.fcgi?object=time_zones')) {
        return ok(200, { time_zones: timeZonesList });
      }
      if (urlString.includes('/load_objects.fcgi?object=time_spans')) {
        if (body?.where?.time_zone_id) {
          return ok(200, { time_spans: spansList.filter((s) => s.time_zone_id === body.where.time_zone_id) });
        }
        return ok(200, { time_spans: spansList });
      }
      if (urlString.includes('/destroy_objects.fcgi') && method === 'POST' && body.object === 'time_spans') {
        spansList = spansList.filter((s) => s.id !== body.where.id);
        return ok(200, { changes: 1 });
      }
      if (urlString.includes('/create_objects.fcgi') && method === 'POST' && body.object === 'time_spans') {
        const created = { id: 9, ...body.values[0] };
        spansList = [...spansList, created];
        return ok(200, { ids: [9] });
      }
      return ok(404, {});
    });

    renderTimeZonesPage();

    await waitFor(() => {
      expect(screen.getByText('Comercial')).toBeInTheDocument();
    });

    await userEvent.click(screen.getByRole('button', { name: /editar comercial/i }));
    await waitFor(() => {
      expect(screen.getByLabelText(/início do intervalo/i)).toBeInTheDocument();
    });

    // Change only the start time of the already-loaded interval — no add, no remove.
    // (end stays 01:00/3600s, so the new start must remain before it.)
    const startInput = screen.getByLabelText(/início do intervalo/i);
    await userEvent.clear(startInput);
    await userEvent.type(startInput, '00:30');

    await userEvent.click(screen.getByRole('button', { name: /salvar alterações/i }));

    await waitFor(() => {
      expect(fetchSpy).toHaveBeenCalledWith(
        expect.stringContaining('/destroy_objects.fcgi?object=time_spans&session=auth-token-999'),
        expect.objectContaining({
          method: 'POST',
          body: JSON.stringify({ object: 'time_spans', where: { id: 5 } }),
        })
      );
      expect(fetchSpy).toHaveBeenCalledWith(
        expect.stringContaining('/create_objects.fcgi?object=time_spans&session=auth-token-999'),
        expect.objectContaining({
          method: 'POST',
          body: JSON.stringify({
            object: 'time_spans',
            values: [
              {
                time_zone_id: '1',
                start: '1800',
                end: '3600',
                sun: '1',
                mon: '1',
                tue: '1',
                wed: '1',
                thu: '1',
                fri: '1',
                sat: '1',
                hol1: '0',
                hol2: '0',
                hol3: '0',
              },
            ],
          }),
        })
      );
    });
  });

  it('rejects saving an interval with no day selected', async () => {
    const timeZonesList = [{ id: 1, name: 'Comercial' }];

    vi.spyOn(globalThis, 'fetch').mockImplementation(async (url) => {
      const urlString = String(url);
      if (urlString.includes('object=time_zones')) return ok(200, { time_zones: timeZonesList });
      if (urlString.includes('object=time_spans')) return ok(200, { time_spans: [] });
      return ok(404, {});
    });

    renderTimeZonesPage();

    await waitFor(() => {
      expect(screen.getByText('Comercial')).toBeInTheDocument();
    });

    await userEvent.click(screen.getByRole('button', { name: /editar comercial/i }));
    await waitFor(() => {
      expect(screen.getByText('Nenhum intervalo cadastrado.')).toBeInTheDocument();
    });

    await userEvent.click(screen.getByRole('button', { name: /adicionar intervalo/i }));
    await userEvent.click(screen.getByRole('button', { name: /salvar alterações/i }));

    await waitFor(() => {
      expect(
        screen.getByText('Cada intervalo precisa de ao menos um dia da semana marcado')
      ).toBeInTheDocument();
    });
  });

  it('rejects saving an interval whose end is not after its start', async () => {
    const timeZonesList = [{ id: 1, name: 'Comercial' }];

    vi.spyOn(globalThis, 'fetch').mockImplementation(async (url) => {
      const urlString = String(url);
      if (urlString.includes('object=time_zones')) return ok(200, { time_zones: timeZonesList });
      if (urlString.includes('object=time_spans')) return ok(200, { time_spans: [] });
      return ok(404, {});
    });

    renderTimeZonesPage();

    await waitFor(() => {
      expect(screen.getByText('Comercial')).toBeInTheDocument();
    });

    await userEvent.click(screen.getByRole('button', { name: /editar comercial/i }));
    await waitFor(() => {
      expect(screen.getByText('Nenhum intervalo cadastrado.')).toBeInTheDocument();
    });

    await userEvent.click(screen.getByRole('button', { name: /adicionar intervalo/i }));
    await userEvent.click(screen.getByLabelText('Seg'));

    const startInput = screen.getByLabelText(/início do intervalo/i);
    await userEvent.clear(startInput);
    await userEvent.type(startInput, '18:00');
    const endInput = screen.getByLabelText(/término do intervalo/i);
    await userEvent.clear(endInput);
    await userEvent.type(endInput, '09:00');

    await userEvent.click(screen.getByRole('button', { name: /salvar alterações/i }));

    await waitFor(() => {
      expect(
        screen.getByText('O horário de início deve ser anterior ao horário de término')
      ).toBeInTheDocument();
    });
  });
});
