import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { AppRouter } from './AppRouter.tsx';

describe('AppRouter (WebGUI Foundation)', () => {
  it('renders login view on /admin/login', () => {
    render(
      <MemoryRouter initialEntries={['/admin/login']}>
        <AppRouter />
      </MemoryRouter>
    );
    expect(screen.getByRole('heading', { name: /login/i })).toBeInTheDocument();
  });

  it('renders users view on /admin/users', () => {
    render(
      <MemoryRouter initialEntries={['/admin/users']}>
        <AppRouter />
      </MemoryRouter>
    );
    expect(screen.getByRole('heading', { name: /users/i })).toBeInTheDocument();
  });
});
