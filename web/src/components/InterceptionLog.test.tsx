import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { InterceptionLog } from './InterceptionLog.tsx';
import * as api from '../api/client.ts';
import type { InterceptionRecord } from '../api/types.ts';

vi.mock('../api/client.ts');

const mockedApi = vi.mocked(api);

const records: InterceptionRecord[] = [
  {
    id: 2,
    direction: 'outbound',
    method: 'POST',
    path: 'http://192.168.0.20:8000/api/notifications/dao',
    timestamp: '2024-01-02T00:00:00.000Z',
    body: '{}',
    truncated: false,
    outcome: 'success',
    statusCode: 200,
    attempts: 1,
  },
  {
    id: 1,
    direction: 'inbound',
    method: 'POST',
    path: '/login.fcgi',
    timestamp: '2024-01-01T00:00:00.000Z',
    body: '{}',
    truncated: false,
  },
];

beforeEach(() => {
  vi.clearAllMocks();
});

describe('InterceptionLog', () => {
  it('renders an explicit empty-state when the API returns [] (Req 8.6)', async () => {
    mockedApi.getInterception.mockResolvedValue([]);

    render(<InterceptionLog />);

    expect(
      await screen.findByText(/no interception records yet/i)
    ).toBeInTheDocument();
    expect(screen.queryByRole('table')).not.toBeInTheDocument();
  });

  it('renders records preserving the newest-first order returned by the API (Req 8.5)', async () => {
    mockedApi.getInterception.mockResolvedValue(records);

    render(<InterceptionLog />);

    const rows = await screen.findAllByRole('row');
    // rows[0] is the header row; the first data row must be the newest (id 2).
    expect(rows[1]).toHaveTextContent(/api\/notifications\/dao/);
    expect(rows[2]).toHaveTextContent('/login.fcgi');
  });

  it('shows a visible error when the fetch fails', async () => {
    mockedApi.getInterception.mockRejectedValue(new Error('boom'));

    render(<InterceptionLog />);

    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent(/failed to load interception log/i);
  });
});
