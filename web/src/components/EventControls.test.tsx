import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { EventControls } from './EventControls.tsx';
import * as api from '../api/client.ts';
import type { PushOutcome, UserRecord } from '../api/types.ts';

vi.mock('../api/client.ts');

const mockedApi = vi.mocked(api);

const identities: UserRecord[] = [
  { id: 8, registration: '0123', name: 'Walter White' },
  { id: 6, registration: '0456', name: 'Neal Caffrey' },
];

const successOutcome: PushOutcome = {
  success: true,
  target: 'http://192.168.0.20:8000/api/notifications/dao',
  statusCode: 200,
  attempts: 1,
};

beforeEach(() => {
  vi.clearAllMocks();
  mockedApi.getIdentities.mockResolvedValue(identities);
});

describe('EventControls', () => {
  it('disables the authorized control until an identity is selected (Req 7.3)', async () => {
    render(<EventControls />);

    const authorizedButton = await screen.findByRole('button', {
      name: /simulate authorized access/i,
    });

    // No identity selected yet -> disabled.
    expect(authorizedButton).toBeDisabled();

    await userEvent.selectOptions(
      screen.getByRole('combobox', { name: /identity/i }),
      '8'
    );

    // A selection enables the control.
    expect(authorizedButton).toBeEnabled();
  });

  it('shows an error and retains the selection without resubmitting on failure (Req 7.8)', async () => {
    mockedApi.simulateAuthorized.mockRejectedValue(
      new Error('Push target unreachable')
    );

    render(<EventControls />);

    const select = await screen.findByRole('combobox', { name: /identity/i });
    await userEvent.selectOptions(select, '8');

    const authorizedButton = screen.getByRole('button', {
      name: /simulate authorized access/i,
    });
    await userEvent.click(authorizedButton);

    // A visible error message is shown.
    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent(/push target unreachable/i);

    // The selection is retained (still '8') and the request was sent once
    // (no automatic resubmit).
    expect(select).toHaveValue('8');
    expect(mockedApi.simulateAuthorized).toHaveBeenCalledTimes(1);
    expect(mockedApi.simulateAuthorized).toHaveBeenCalledWith(8);
  });

  it('calls the client and renders the outcome on the happy path', async () => {
    mockedApi.simulateAuthorized.mockResolvedValue(successOutcome);

    render(<EventControls />);

    const select = await screen.findByRole('combobox', { name: /identity/i });
    await userEvent.selectOptions(select, '8');
    await userEvent.click(
      screen.getByRole('button', { name: /simulate authorized access/i })
    );

    await waitFor(() =>
      expect(mockedApi.simulateAuthorized).toHaveBeenCalledWith(8)
    );

    const outcome = await screen.findByRole('status');
    expect(outcome).toHaveTextContent(
      'http://192.168.0.20:8000/api/notifications/dao'
    );
    expect(outcome).toHaveTextContent(/success/i);
  });

  it('allows denied simulation without an identity selection', async () => {
    mockedApi.simulateDenied.mockResolvedValue({
      ...successOutcome,
      target: 'http://192.168.0.20:8000/api/notifications/dao',
    });

    render(<EventControls />);

    const deniedButton = await screen.findByRole('button', {
      name: /simulate denied access/i,
    });
    expect(deniedButton).toBeEnabled();

    await userEvent.click(deniedButton);
    await waitFor(() => expect(mockedApi.simulateDenied).toHaveBeenCalledTimes(1));
  });
});
