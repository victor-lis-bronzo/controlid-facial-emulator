import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { WebGuiLayout } from './components/WebGuiLayout.tsx';
import { AuthProvider } from './context/AuthContext.tsx';

describe('WebGuiLayout (Issue #23)', () => {
  beforeEach(() => {
    localStorage.clear();
    localStorage.setItem('controlid_session', 'active-session-token');
    vi.restoreAllMocks();
  });

  it('renders header with branding, status badge, and children content', () => {
    render(
      <AuthProvider>
        <MemoryRouter initialEntries={['/admin/users']}>
          <WebGuiLayout>
            <div data-testid="child-content">Conteúdo da Tela</div>
          </WebGuiLayout>
        </MemoryRouter>
      </AuthProvider>
    );

    expect(screen.getByText('Control-iD WebGUI')).toBeInTheDocument();
    expect(screen.getByText('Emulador Facial')).toBeInTheDocument();
    expect(screen.getByText(/online|conectado/i)).toBeInTheDocument();
    expect(screen.getByTestId('child-content')).toHaveTextContent('Conteúdo da Tela');
  });

  it('renders navigation sidebar with active link on Usuários and placeholders for future modules', () => {
    render(
      <AuthProvider>
        <MemoryRouter initialEntries={['/admin/users']}>
          <WebGuiLayout>
            <div>Conteúdo</div>
          </WebGuiLayout>
        </MemoryRouter>
      </AuthProvider>
    );

    const usersLink = screen.getByRole('link', { name: /usuários/i });
    expect(usersLink).toBeInTheDocument();
    expect(usersLink).toHaveAttribute('href', '/admin/users');
    expect(usersLink).toHaveAttribute('aria-current', 'page');

    const groupsLink = screen.getByRole('link', { name: /grupos/i });
    expect(groupsLink).toBeInTheDocument();
    expect(groupsLink).toHaveAttribute('href', '/admin/groups');

    const timeZonesLink = screen.getByRole('link', { name: /horários/i });
    expect(timeZonesLink).toBeInTheDocument();
    expect(timeZonesLink).toHaveAttribute('href', '/admin/time-zones');

    expect(screen.getByText('Regras de Acesso')).toBeInTheDocument();
    expect(screen.getByText('Logs de Acesso')).toBeInTheDocument();
    expect(screen.getByText('Configurações')).toBeInTheDocument();

    const comingSoonBadges = screen.getAllByText('Em breve');
    expect(comingSoonBadges.length).toBeGreaterThanOrEqual(3);
  });

  it('triggers logout when Sair button is clicked', async () => {
    const user = userEvent.setup();

    render(
      <AuthProvider>
        <MemoryRouter initialEntries={['/admin/users']}>
          <WebGuiLayout>
            <div>Conteúdo</div>
          </WebGuiLayout>
        </MemoryRouter>
      </AuthProvider>
    );

    const logoutBtn = screen.getByRole('button', { name: /sair/i });
    expect(logoutBtn).toBeInTheDocument();

    await user.click(logoutBtn);
    expect(localStorage.getItem('controlid_session')).toBeNull();
  });
});
