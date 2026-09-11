import { describe, it, expect } from 'vitest';
import { useState } from 'react';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ErrorBanner } from './ErrorBanner.tsx';
import { ApiError } from '../api/client.ts';

/**
 * A minimal host that mirrors how sections use ErrorBanner: a form input plus a
 * button that "fails" by setting an ApiError. The input state is never reset on
 * failure, proving the banner surfaces without clearing the form (Req 11.5).
 */
function Host() {
  const [value, setValue] = useState('');
  const [error, setError] = useState<unknown>(null);
  return (
    <form>
      <ErrorBanner error={error} context="Save failed" />
      <input aria-label="name" value={value} onChange={(e) => setValue(e.target.value)} />
      <button
        type="button"
        onClick={() => setError(new ApiError('Name must not be empty.', 400))}
      >
        Save
      </button>
    </form>
  );
}

describe('ErrorBanner', () => {
  it('renders nothing when there is no error', () => {
    render(<ErrorBanner error={null} />);
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('surfaces the ApiError message and retains the input on failure (Req 11.5)', async () => {
    render(<Host />);

    const input = screen.getByLabelText('name');
    await userEvent.type(input, 'Gustavo');
    await userEvent.click(screen.getByRole('button', { name: /save/i }));

    // The error-description is shown with its status.
    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent(/name must not be empty/i);
    expect(alert).toHaveTextContent(/http 400/i);

    // The form input is retained (not cleared) after the failure.
    expect(input).toHaveValue('Gustavo');
  });
});
