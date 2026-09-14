import { describe, it, expect, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { AppRouter } from './AppRouter.tsx';
import { AuthProvider } from './context/AuthContext.tsx';

describe('AppRouter (WebGUI Foundation)', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it('renders login view on /admin/login', () => {
    render(
      <AuthProvider>
        <MemoryRouter initialEntries={['/admin/login']}>
          <AppRouter />
        </MemoryRouter>
      </AuthProvider>
    );
    expect(screen.getByRole('heading', { name: /login/i })).toBeInTheDocument();
  });

  it('renders users view on /admin/users when authenticated', async () => {
    localStorage.setItem('controlid_session', 'test-session');
    render(
      <AuthProvider>
        <MemoryRouter initialEntries={['/admin/users']}>
          <AppRouter />
        </MemoryRouter>
      </AuthProvider>
    );
    expect(await screen.findByRole('heading', { name: /users/i })).toBeInTheDocument();
  });
});
