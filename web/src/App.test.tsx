import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { App } from './App.tsx';
import * as api from './api/client.ts';
import type * as ApiModule from './api/client.ts';

vi.mock('./api/client.ts', async (importOriginal) => {
  const actual = await importOriginal<typeof ApiModule>();
  return {
    ...actual,
    // Section data loads resolve to empty so the shell renders empty-states.
    adminDashboard: { get: vi.fn() },
    adminPortals: { list: vi.fn(), create: vi.fn(), update: vi.fn(), remove: vi.fn() },
    adminGroups: { list: vi.fn() },
    adminUsers: { list: vi.fn() },
    adminTimeZones: { list: vi.fn() },
    adminAccessRules: { list: vi.fn() },
    adminAccessLogs: { list: vi.fn() },
    getIdentities: vi.fn(),
    getInterception: vi.fn(),
  };
});

const dashboardGet = vi.mocked(api.adminDashboard.get);
const portalsList = vi.mocked(api.adminPortals.list);
const identitiesFn = vi.mocked(api.getIdentities);

beforeEach(() => {
  vi.clearAllMocks();
  window.location.hash = '';
  dashboardGet.mockResolvedValue({
    counts: { users: 2, groups: 1, accessRules: 0, portals: 3 },
    recentLogs: [],
  });
  portalsList.mockResolvedValue([]);
});

describe('App router shell', () => {
  it('presents navigation controls for all nine sections (Req 11.2)', async () => {
    render(<App />);
    const nav = screen.getByRole('navigation', { name: /admin panel sections/i });
    // Let the default Dashboard section's async load settle to avoid act() noise.
    await screen.findByRole('heading', { name: /^dashboard$/i });
    for (const label of [
      'Dashboard',
      'Users',
      'Groups',
      'Time Zones',
      'Access Rules',
      'Portals',
      'Access Logs',
      'Simulate',
      'Interception Log',
    ]) {
      expect(nav).toHaveTextContent(label);
    }
  });

  it('renders the Dashboard by default and swaps sections without reload (Req 11.3)', async () => {
    render(<App />);

    // Default route is the dashboard.
    expect(await screen.findByRole('heading', { name: /^dashboard$/i })).toBeInTheDocument();

    // Navigating to Portals swaps the section in-place (no full reload).
    await userEvent.click(screen.getByRole('button', { name: /^portals$/i }));
    await waitFor(() =>
      expect(screen.getByRole('heading', { name: /^portals$/i })).toBeInTheDocument()
    );
    expect(portalsList).toHaveBeenCalled();
  });

  it('renders the preserved Simulate section unchanged (Req 12.3)', async () => {
    identitiesFn.mockResolvedValue([]);
    render(<App />);

    await userEvent.click(screen.getByRole('button', { name: /^simulate$/i }));
    expect(
      await screen.findByRole('heading', { name: /simulate access event/i })
    ).toBeInTheDocument();
  });
});
