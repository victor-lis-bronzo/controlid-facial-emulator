import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { UsersPage } from './pages/UsersPage.tsx';
import { AuthProvider } from './context/AuthContext.tsx';

describe('Users Management via .fcgi (Issue #21)', () => {
  beforeEach(() => {
    localStorage.clear();
    localStorage.setItem('controlid_session', 'auth-token-999');
    vi.restoreAllMocks();
  });

  it('loads and lists users consuming POST /load_objects.fcgi?object=users with session query', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockImplementation(async (url) => {
      const urlString = String(url);
      if (urlString.includes('/load_objects.fcgi')) {
        return {
          ok: true,
          status: 200,
          text: async () =>
            JSON.stringify({
              users: [
                { id: 1, name: 'Carlos Alberto', registration: 'REG001' },
                { id: 2, name: 'Ana Carolina', registration: 'REG002' },
              ],
            }),
        } as Response;
      }
      return { ok: false, status: 404, text: async () => '' } as Response;
    });

    render(
      <AuthProvider>
        <MemoryRouter>
          <UsersPage />
        </MemoryRouter>
      </AuthProvider>
    );

    await waitFor(() => {
      expect(screen.getByText('Carlos Alberto')).toBeInTheDocument();
      expect(screen.getByText('REG001')).toBeInTheDocument();
      expect(screen.getByText('Ana Carolina')).toBeInTheDocument();
      expect(screen.getByText('REG002')).toBeInTheDocument();
    });

    expect(fetchSpy).toHaveBeenCalledWith(
      expect.stringContaining('/load_objects.fcgi?object=users&session=auth-token-999'),
      expect.objectContaining({
        method: 'POST',
        headers: expect.objectContaining({ 'Content-Type': 'application/json' }),
        body: JSON.stringify({ object: 'users' }),
      })
    );
  });

  it('creates a new user consuming POST /create_objects.fcgi?object=users with session query and reloads list', async () => {
    let usersList = [{ id: 1, name: 'Carlos Alberto', registration: 'REG001' }];

    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockImplementation(async (url, init) => {
      const urlString = String(url);
      const method = init?.method ?? 'GET';

      if (urlString.includes('/load_objects.fcgi')) {
        return {
          ok: true,
          status: 200,
          text: async () => JSON.stringify({ users: usersList }),
        } as Response;
      }

      if (urlString.includes('/create_objects.fcgi') && method === 'POST') {
        const body = JSON.parse(String(init?.body));
        usersList = [...usersList, { id: 2, name: body.values[0].name, registration: body.values[0].registration }];
        return {
          ok: true,
          status: 200,
          text: async () => JSON.stringify({ ids: [2] }),
        } as Response;
      }

      return { ok: false, status: 404, text: async () => '' } as Response;
    });

    render(
      <AuthProvider>
        <MemoryRouter>
          <UsersPage />
        </MemoryRouter>
      </AuthProvider>
    );

    await waitFor(() => {
      expect(screen.getByText('Carlos Alberto')).toBeInTheDocument();
    });

    // Open create user form
    await userEvent.click(screen.getByRole('button', { name: /novo usuário|adicionar usuário/i }));

    // Fill form
    await userEvent.type(screen.getByLabelText(/nome/i), 'Mariana Souza');
    await userEvent.type(screen.getByLabelText(/matrícula|registration/i), 'REG999');
    await userEvent.type(screen.getByLabelText(/senha|pin/i), '1234');

    // Submit form
    await userEvent.click(screen.getByRole('button', { name: /salvar|criar/i }));

    await waitFor(() => {
      expect(fetchSpy).toHaveBeenCalledWith(
        expect.stringContaining('/create_objects.fcgi?object=users&session=auth-token-999'),
        expect.objectContaining({
          method: 'POST',
          headers: expect.objectContaining({ 'Content-Type': 'application/json' }),
          body: JSON.stringify({
            object: 'users',
            values: [{ name: 'Mariana Souza', registration: 'REG999', password: '1234' }],
          }),
        })
      );
    });

    await waitFor(() => {
      expect(screen.getByText('Mariana Souza')).toBeInTheDocument();
      expect(screen.getByText('REG999')).toBeInTheDocument();
    });
  });

  it('omits password field in payload if password input is blank', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockImplementation(async (url, init) => {
      const urlString = String(url);
      const method = init?.method ?? 'GET';

      if (urlString.includes('/load_objects.fcgi')) {
        return {
          ok: true,
          status: 200,
          text: async () => JSON.stringify({ users: [] }),
        } as Response;
      }

      if (urlString.includes('/create_objects.fcgi') && method === 'POST') {
        return {
          ok: true,
          status: 200,
          text: async () => JSON.stringify({ ids: [1] }),
        } as Response;
      }

      return { ok: false, status: 404, text: async () => '' } as Response;
    });

    render(
      <AuthProvider>
        <MemoryRouter>
          <UsersPage />
        </MemoryRouter>
      </AuthProvider>
    );

    await userEvent.click(screen.getByRole('button', { name: /novo usuário/i }));
    await userEvent.type(screen.getByLabelText(/nome/i), 'Sem Senha');
    await userEvent.type(screen.getByLabelText(/matrícula/i), 'REG-NO-PASS');
    await userEvent.click(screen.getByRole('button', { name: /salvar/i }));

    await waitFor(() => {
      expect(fetchSpy).toHaveBeenCalledWith(
        expect.stringContaining('/create_objects.fcgi?object=users'),
        expect.objectContaining({
          body: JSON.stringify({
            object: 'users',
            values: [{ name: 'Sem Senha', registration: 'REG-NO-PASS' }],
          }),
        })
      );
    });
  });

  describe('User Editing via POST /modify_objects.fcgi (Issue #24)', () => {
    it('opens edit modal pre-filled with user data when Edit button is clicked', async () => {
      vi.spyOn(globalThis, 'fetch').mockImplementation(async (url) => {
        const urlString = String(url);
        if (urlString.includes('/load_objects.fcgi')) {
          return {
            ok: true,
            status: 200,
            text: async () =>
              JSON.stringify({
                users: [{ id: 1, name: 'Carlos Alberto', registration: 'REG001' }],
              }),
          } as Response;
        }
        return { ok: false, status: 404, text: async () => '' } as Response;
      });

      render(
        <AuthProvider>
          <MemoryRouter>
            <UsersPage />
          </MemoryRouter>
        </AuthProvider>
      );

      await waitFor(() => {
        expect(screen.getByText('Carlos Alberto')).toBeInTheDocument();
      });

      const editBtn = screen.getByRole('button', { name: /editar carlos alberto|editar/i });
      await userEvent.click(editBtn);

      expect(screen.getByRole('heading', { name: /editar usuário/i })).toBeInTheDocument();
      expect(screen.getByDisplayValue('Carlos Alberto')).toBeInTheDocument();
      expect(screen.getByDisplayValue('REG001')).toBeInTheDocument();
    });

    it('submits updated values via POST /modify_objects.fcgi?object=users with session and reloads list', async () => {
      let usersList = [{ id: 1, name: 'Carlos Alberto', registration: 'REG001' }];

      const fetchSpy = vi.spyOn(globalThis, 'fetch').mockImplementation(async (url, init) => {
        const urlString = String(url);
        const method = init?.method ?? 'GET';

        if (urlString.includes('/load_objects.fcgi')) {
          return {
            ok: true,
            status: 200,
            text: async () => JSON.stringify({ users: usersList }),
          } as Response;
        }

        if (urlString.includes('/modify_objects.fcgi') && method === 'POST') {
          const body = JSON.parse(String(init?.body));
          usersList = [{ id: 1, name: body.values.name, registration: body.values.registration }];
          return {
            ok: true,
            status: 200,
            text: async () => JSON.stringify({ changes: 1 }),
          } as Response;
        }

        return { ok: false, status: 404, text: async () => '' } as Response;
      });

      render(
        <AuthProvider>
          <MemoryRouter>
            <UsersPage />
          </MemoryRouter>
        </AuthProvider>
      );

      await waitFor(() => {
        expect(screen.getByText('Carlos Alberto')).toBeInTheDocument();
      });

      // Open edit modal
      await userEvent.click(screen.getByRole('button', { name: /editar carlos alberto|editar/i }));

      // Edit fields
      const nameInput = screen.getByDisplayValue('Carlos Alberto');
      await userEvent.clear(nameInput);
      await userEvent.type(nameInput, 'Carlos Alberto Silva');

      const regInput = screen.getByDisplayValue('REG001');
      await userEvent.clear(regInput);
      await userEvent.type(regInput, 'REG001-NEW');

      const pinInput = screen.getByLabelText(/senha|pin/i);
      await userEvent.type(pinInput, '9988');

      // Submit changes
      await userEvent.click(screen.getByRole('button', { name: /salvar alterações|salvar/i }));

      await waitFor(() => {
        expect(fetchSpy).toHaveBeenCalledWith(
          expect.stringContaining('/modify_objects.fcgi?object=users&session=auth-token-999'),
          expect.objectContaining({
            method: 'POST',
            headers: expect.objectContaining({ 'Content-Type': 'application/json' }),
            body: JSON.stringify({
              object: 'users',
              values: {
                name: 'Carlos Alberto Silva',
                registration: 'REG001-NEW',
                password: '9988',
              },
              where: { id: 1 },
            }),
          })
        );
      });

      await waitFor(() => {
        expect(screen.getByText('Carlos Alberto Silva')).toBeInTheDocument();
        expect(screen.getByText('REG001-NEW')).toBeInTheDocument();
      });
    });

    it('omits password in values if password field was left blank when editing', async () => {
      const fetchSpy = vi.spyOn(globalThis, 'fetch').mockImplementation(async (url, init) => {
        const urlString = String(url);
        const method = init?.method ?? 'GET';

        if (urlString.includes('/load_objects.fcgi')) {
          return {
            ok: true,
            status: 200,
            text: async () =>
              JSON.stringify({
                users: [{ id: 1, name: 'Carlos Alberto', registration: 'REG001' }],
              }),
          } as Response;
        }

        if (urlString.includes('/modify_objects.fcgi') && method === 'POST') {
          return {
            ok: true,
            status: 200,
            text: async () => JSON.stringify({ changes: 1 }),
          } as Response;
        }

        return { ok: false, status: 404, text: async () => '' } as Response;
      });

      render(
        <AuthProvider>
          <MemoryRouter>
            <UsersPage />
          </MemoryRouter>
        </AuthProvider>
      );

      await waitFor(() => {
        expect(screen.getByText('Carlos Alberto')).toBeInTheDocument();
      });

      await userEvent.click(screen.getByRole('button', { name: /editar/i }));

      const nameInput = screen.getByDisplayValue('Carlos Alberto');
      await userEvent.clear(nameInput);
      await userEvent.type(nameInput, 'Carlos Editado');

      await userEvent.click(screen.getByRole('button', { name: /salvar/i }));

      await waitFor(() => {
        expect(fetchSpy).toHaveBeenCalledWith(
          expect.stringContaining('/modify_objects.fcgi?object=users'),
          expect.objectContaining({
            body: JSON.stringify({
              object: 'users',
              values: {
                name: 'Carlos Editado',
                registration: 'REG001',
              },
              where: { id: 1 },
            }),
          })
        );
      });
    });
  });

  describe('User Deletion with Confirmation via POST /destroy_objects.fcgi (Issue #25)', () => {
    it('opens confirmation modal showing user name and registration when delete button is clicked', async () => {
      vi.spyOn(globalThis, 'fetch').mockImplementation(async (url) => {
        const urlString = String(url);
        if (urlString.includes('/load_objects.fcgi')) {
          return {
            ok: true,
            status: 200,
            text: async () =>
              JSON.stringify({
                users: [{ id: 1, name: 'Carlos Alberto', registration: 'REG001' }],
              }),
          } as Response;
        }
        return { ok: false, status: 404, text: async () => '' } as Response;
      });

      render(
        <AuthProvider>
          <MemoryRouter>
            <UsersPage />
          </MemoryRouter>
        </AuthProvider>
      );

      await waitFor(() => {
        expect(screen.getByText('Carlos Alberto')).toBeInTheDocument();
      });

      const deleteBtn = screen.getByRole('button', { name: /excluir carlos alberto|excluir/i });
      await userEvent.click(deleteBtn);

      expect(screen.getByRole('heading', { name: /confirmar exclusão|excluir usuário/i })).toBeInTheDocument();
      expect(screen.getAllByText(/carlos alberto/i).length).toBeGreaterThanOrEqual(2);
      expect(screen.getAllByText(/reg001/i).length).toBeGreaterThanOrEqual(2);
    });

    it('cancels deletion when cancel button is clicked without calling destroy_objects.fcgi', async () => {
      const fetchSpy = vi.spyOn(globalThis, 'fetch').mockImplementation(async (url) => {
        const urlString = String(url);
        if (urlString.includes('/load_objects.fcgi')) {
          return {
            ok: true,
            status: 200,
            text: async () =>
              JSON.stringify({
                users: [{ id: 1, name: 'Carlos Alberto', registration: 'REG001' }],
              }),
          } as Response;
        }
        return { ok: false, status: 404, text: async () => '' } as Response;
      });

      render(
        <AuthProvider>
          <MemoryRouter>
            <UsersPage />
          </MemoryRouter>
        </AuthProvider>
      );

      await waitFor(() => {
        expect(screen.getByText('Carlos Alberto')).toBeInTheDocument();
      });

      await userEvent.click(screen.getByRole('button', { name: /excluir carlos alberto|excluir/i }));
      expect(screen.getByRole('heading', { name: /confirmar exclusão|excluir usuário/i })).toBeInTheDocument();

      const cancelBtn = screen.getByRole('button', { name: /cancelar/i });
      await userEvent.click(cancelBtn);

      expect(screen.queryByRole('heading', { name: /confirmar exclusão|excluir usuário/i })).not.toBeInTheDocument();
      expect(fetchSpy).not.toHaveBeenCalledWith(
        expect.stringContaining('/destroy_objects.fcgi'),
        expect.anything()
      );
    });

    it('dispatches POST /destroy_objects.fcgi?object=users with session and reloads list upon confirmation', async () => {
      let usersList = [{ id: 1, name: 'Carlos Alberto', registration: 'REG001' }];

      const fetchSpy = vi.spyOn(globalThis, 'fetch').mockImplementation(async (url, init) => {
        const urlString = String(url);
        const method = init?.method ?? 'GET';

        if (urlString.includes('/load_objects.fcgi')) {
          return {
            ok: true,
            status: 200,
            text: async () => JSON.stringify({ users: usersList }),
          } as Response;
        }

        if (urlString.includes('/destroy_objects.fcgi') && method === 'POST') {
          usersList = [];
          return {
            ok: true,
            status: 200,
            text: async () => JSON.stringify({ changes: 1 }),
          } as Response;
        }

        return { ok: false, status: 404, text: async () => '' } as Response;
      });

      render(
        <AuthProvider>
          <MemoryRouter>
            <UsersPage />
          </MemoryRouter>
        </AuthProvider>
      );

      await waitFor(() => {
        expect(screen.getByText('Carlos Alberto')).toBeInTheDocument();
      });

      // Click delete button
      await userEvent.click(screen.getByRole('button', { name: /excluir carlos alberto|excluir/i }));

      // Confirm deletion
      const confirmBtn = screen.getByRole('button', { name: /confirmar exclusão/i });
      await userEvent.click(confirmBtn);

      await waitFor(() => {
        expect(fetchSpy).toHaveBeenCalledWith(
          expect.stringContaining('/destroy_objects.fcgi?object=users&session=auth-token-999'),
          expect.objectContaining({
            method: 'POST',
            headers: expect.objectContaining({ 'Content-Type': 'application/json' }),
            body: JSON.stringify({
              object: 'users',
              where: { id: 1 },
            }),
          })
        );
      });

      await waitFor(() => {
        expect(screen.getByText('Nenhum usuário cadastrado no momento.')).toBeInTheDocument();
      });
    });
  });

  describe('Facial Photo Management via POST /user_set_image.fcgi & GET /user_get_image.fcgi (Issue #26)', () => {
    it('renders a photo avatar for a user with image_path and initials for a user without one', async () => {
      vi.spyOn(globalThis, 'fetch').mockImplementation(async (url) => {
        const urlString = String(url);
        if (urlString.includes('/load_objects.fcgi')) {
          return {
            ok: true,
            status: 200,
            text: async () =>
              JSON.stringify({
                users: [
                  { id: 1, name: 'Carlos Alberto', registration: 'REG001', image_path: 'photos/1.jpg' },
                  { id: 2, name: 'Ana Carolina', registration: 'REG002', image_path: null },
                ],
              }),
          } as Response;
        }
        return { ok: false, status: 404, text: async () => '' } as Response;
      });

      render(
        <AuthProvider>
          <MemoryRouter>
            <UsersPage />
          </MemoryRouter>
        </AuthProvider>
      );

      await waitFor(() => {
        expect(screen.getByRole('img', { name: /photo of carlos alberto/i })).toBeInTheDocument();
      });
      expect(screen.getByText('AC')).toBeInTheDocument();

      // The avatar's <img src> must carry the session token: user_get_image.fcgi
      // is a protected route (requireSession), so an unauthenticated request 401s.
      expect(screen.getByRole('img', { name: /photo of carlos alberto/i })).toHaveAttribute(
        'src',
        expect.stringContaining('session=auth-token-999')
      );
    });

    it('shows the photo controls in the edit modal, "Remover Foto" disabled without a photo', async () => {
      vi.spyOn(globalThis, 'fetch').mockImplementation(async (url) => {
        const urlString = String(url);
        if (urlString.includes('/load_objects.fcgi')) {
          return {
            ok: true,
            status: 200,
            text: async () =>
              JSON.stringify({
                users: [{ id: 1, name: 'Carlos Alberto', registration: 'REG001', image_path: null }],
              }),
          } as Response;
        }
        return { ok: false, status: 404, text: async () => '' } as Response;
      });

      render(
        <AuthProvider>
          <MemoryRouter>
            <UsersPage />
          </MemoryRouter>
        </AuthProvider>
      );

      await waitFor(() => {
        expect(screen.getByText('Carlos Alberto')).toBeInTheDocument();
      });
      await userEvent.click(screen.getByRole('button', { name: /editar carlos alberto|editar/i }));

      expect(screen.getByRole('button', { name: /remover foto/i })).toBeDisabled();
    });

    it('enables "Remover Foto" in the edit modal when the user already has a photo', async () => {
      vi.spyOn(globalThis, 'fetch').mockImplementation(async (url) => {
        const urlString = String(url);
        if (urlString.includes('/load_objects.fcgi')) {
          return {
            ok: true,
            status: 200,
            text: async () =>
              JSON.stringify({
                users: [
                  { id: 1, name: 'Carlos Alberto', registration: 'REG001', image_path: 'photos/1.jpg' },
                ],
              }),
          } as Response;
        }
        return { ok: false, status: 404, text: async () => '' } as Response;
      });

      render(
        <AuthProvider>
          <MemoryRouter>
            <UsersPage />
          </MemoryRouter>
        </AuthProvider>
      );

      await waitFor(() => {
        expect(screen.getByText('Carlos Alberto')).toBeInTheDocument();
      });
      await userEvent.click(screen.getByRole('button', { name: /editar carlos alberto|editar/i }));

      expect(screen.getByRole('button', { name: /remover foto/i })).toBeEnabled();
    });

    it('uploads a valid JPEG via POST /user_set_image.fcgi with the session query param and refreshes the avatar', async () => {
      const fetchSpy = vi.spyOn(globalThis, 'fetch').mockImplementation(async (url, init) => {
        const urlString = String(url);
        const method = init?.method ?? 'GET';

        if (urlString.includes('/load_objects.fcgi')) {
          return {
            ok: true,
            status: 200,
            text: async () =>
              JSON.stringify({
                users: [{ id: 1, name: 'Carlos Alberto', registration: 'REG001', image_path: null }],
              }),
          } as Response;
        }
        if (urlString.includes('/user_set_image.fcgi') && method === 'POST') {
          return {
            ok: true,
            status: 200,
            text: async () => JSON.stringify({ success: true }),
          } as Response;
        }
        return { ok: false, status: 404, text: async () => '' } as Response;
      });

      render(
        <AuthProvider>
          <MemoryRouter>
            <UsersPage />
          </MemoryRouter>
        </AuthProvider>
      );

      await waitFor(() => {
        expect(screen.getByText('Carlos Alberto')).toBeInTheDocument();
      });
      await userEvent.click(screen.getByRole('button', { name: /editar carlos alberto|editar/i }));

      const file = new File([new Uint8Array([1, 2, 3])], 'face.jpg', { type: 'image/jpeg' });
      const fileInput = screen.getByLabelText(/selecionar foto/i);
      await userEvent.upload(fileInput, file);

      await waitFor(() => {
        const call = fetchSpy.mock.calls.find(([u]) => String(u).includes('/user_set_image.fcgi'));
        expect(call).toBeDefined();
        const [uploadUrl, uploadInit] = call!;
        expect(String(uploadUrl)).toContain('session=auth-token-999');
        expect(uploadInit?.method).toBe('POST');
        const body = uploadInit?.body as FormData;
        expect(body).toBeInstanceOf(FormData);
        expect(body.get('user_id')).toBe('1');
        expect(body.get('file')).toBeInstanceOf(File);
      });

      expect(screen.queryByText(/formato inválido|não pode exceder/i)).not.toBeInTheDocument();
    });

    it('rejects an oversized file client-side without calling fetch', async () => {
      const fetchSpy = vi.spyOn(globalThis, 'fetch').mockImplementation(async (url) => {
        const urlString = String(url);
        if (urlString.includes('/load_objects.fcgi')) {
          return {
            ok: true,
            status: 200,
            text: async () =>
              JSON.stringify({
                users: [{ id: 1, name: 'Carlos Alberto', registration: 'REG001', image_path: null }],
              }),
          } as Response;
        }
        return { ok: false, status: 404, text: async () => '' } as Response;
      });

      render(
        <AuthProvider>
          <MemoryRouter>
            <UsersPage />
          </MemoryRouter>
        </AuthProvider>
      );

      await waitFor(() => {
        expect(screen.getByText('Carlos Alberto')).toBeInTheDocument();
      });
      await userEvent.click(screen.getByRole('button', { name: /editar carlos alberto|editar/i }));

      const oversized = new File([new Uint8Array(6 * 1024 * 1024)], 'big.jpg', {
        type: 'image/jpeg',
      });
      const fileInput = screen.getByLabelText(/selecionar foto/i);
      await userEvent.upload(fileInput, oversized);

      expect(await screen.findByText(/não pode exceder 5 mb/i)).toBeInTheDocument();
      expect(fetchSpy).not.toHaveBeenCalledWith(
        expect.stringContaining('/user_set_image.fcgi'),
        expect.anything()
      );
    });

    it('rejects a disallowed mime type client-side without calling fetch', async () => {
      const fetchSpy = vi.spyOn(globalThis, 'fetch').mockImplementation(async (url) => {
        const urlString = String(url);
        if (urlString.includes('/load_objects.fcgi')) {
          return {
            ok: true,
            status: 200,
            text: async () =>
              JSON.stringify({
                users: [{ id: 1, name: 'Carlos Alberto', registration: 'REG001', image_path: null }],
              }),
          } as Response;
        }
        return { ok: false, status: 404, text: async () => '' } as Response;
      });

      render(
        <AuthProvider>
          <MemoryRouter>
            <UsersPage />
          </MemoryRouter>
        </AuthProvider>
      );

      await waitFor(() => {
        expect(screen.getByText('Carlos Alberto')).toBeInTheDocument();
      });
      await userEvent.click(screen.getByRole('button', { name: /editar carlos alberto|editar/i }));

      // `applyAccept: false` bypasses the file input's `accept` filtering, so
      // this exercises the component's own client-side validation as a
      // defense-in-depth check (e.g. a drag-and-drop source bypassing the
      // native file picker's `accept` filter).
      const user = userEvent.setup({ applyAccept: false });
      const gif = new File([new Uint8Array([1, 2, 3])], 'face.gif', { type: 'image/gif' });
      const fileInput = screen.getByLabelText(/selecionar foto/i);
      await user.upload(fileInput, gif);

      expect(await screen.findByText(/formato inválido/i)).toBeInTheDocument();
      expect(fetchSpy).not.toHaveBeenCalledWith(
        expect.stringContaining('/user_set_image.fcgi'),
        expect.anything()
      );
    });

    it('surfaces a server-side upload error (e.g. spoofed magic bytes rejected by the backend)', async () => {
      vi.spyOn(globalThis, 'fetch').mockImplementation(async (url, init) => {
        const urlString = String(url);
        const method = init?.method ?? 'GET';

        if (urlString.includes('/load_objects.fcgi')) {
          return {
            ok: true,
            status: 200,
            text: async () =>
              JSON.stringify({
                users: [{ id: 1, name: 'Carlos Alberto', registration: 'REG001', image_path: null }],
              }),
          } as Response;
        }
        if (urlString.includes('/user_set_image.fcgi') && method === 'POST') {
          return {
            ok: false,
            status: 400,
            text: async () => JSON.stringify({ 'error-description': 'Accepted formats: JPEG, PNG.' }),
          } as Response;
        }
        return { ok: false, status: 404, text: async () => '' } as Response;
      });

      render(
        <AuthProvider>
          <MemoryRouter>
            <UsersPage />
          </MemoryRouter>
        </AuthProvider>
      );

      await waitFor(() => {
        expect(screen.getByText('Carlos Alberto')).toBeInTheDocument();
      });
      await userEvent.click(screen.getByRole('button', { name: /editar carlos alberto|editar/i }));

      const file = new File([new Uint8Array([1, 2, 3])], 'face.jpg', { type: 'image/jpeg' });
      const fileInput = screen.getByLabelText(/selecionar foto/i);
      await userEvent.upload(fileInput, file);

      expect(await screen.findByText(/accepted formats: jpeg, png/i)).toBeInTheDocument();
    });

    it('removes the photo via POST /user_destroy_image.fcgi and reverts to the initials placeholder', async () => {
      let hasPhoto = true;
      const fetchSpy = vi.spyOn(globalThis, 'fetch').mockImplementation(async (url, init) => {
        const urlString = String(url);
        const method = init?.method ?? 'GET';

        if (urlString.includes('/load_objects.fcgi')) {
          return {
            ok: true,
            status: 200,
            text: async () =>
              JSON.stringify({
                users: [
                  {
                    id: 1,
                    name: 'Carlos Alberto',
                    registration: 'REG001',
                    image_path: hasPhoto ? 'photos/1.jpg' : null,
                  },
                ],
              }),
          } as Response;
        }
        if (urlString.includes('/user_destroy_image.fcgi') && method === 'POST') {
          hasPhoto = false;
          return {
            ok: true,
            status: 200,
            text: async () => JSON.stringify({ success: true }),
          } as Response;
        }
        return { ok: false, status: 404, text: async () => '' } as Response;
      });

      render(
        <AuthProvider>
          <MemoryRouter>
            <UsersPage />
          </MemoryRouter>
        </AuthProvider>
      );

      await waitFor(() => {
        expect(screen.getByRole('img', { name: /photo of carlos alberto/i })).toBeInTheDocument();
      });
      await userEvent.click(screen.getByRole('button', { name: /editar carlos alberto|editar/i }));
      await userEvent.click(screen.getByRole('button', { name: /remover foto/i }));

      await waitFor(() => {
        expect(fetchSpy).toHaveBeenCalledWith(
          expect.stringContaining('/user_destroy_image.fcgi?session=auth-token-999'),
          expect.objectContaining({
            method: 'POST',
            body: JSON.stringify({ user_id: 1 }),
          })
        );
      });

      await waitFor(() => {
        expect(screen.getAllByText('CA').length).toBeGreaterThan(0);
        expect(screen.queryByRole('img', { name: /photo of carlos alberto/i })).not.toBeInTheDocument();
      });
    });

    it('surfaces an error and keeps the photo displayed when photo removal fails', async () => {
      vi.spyOn(globalThis, 'fetch').mockImplementation(async (url, init) => {
        const urlString = String(url);
        const method = init?.method ?? 'GET';

        if (urlString.includes('/load_objects.fcgi')) {
          return {
            ok: true,
            status: 200,
            text: async () =>
              JSON.stringify({
                users: [
                  { id: 1, name: 'Carlos Alberto', registration: 'REG001', image_path: 'photos/1.jpg' },
                ],
              }),
          } as Response;
        }
        if (urlString.includes('/user_destroy_image.fcgi') && method === 'POST') {
          return {
            ok: false,
            status: 404,
            text: async () => JSON.stringify({ 'error-description': 'No image stored.' }),
          } as Response;
        }
        return { ok: false, status: 404, text: async () => '' } as Response;
      });

      render(
        <AuthProvider>
          <MemoryRouter>
            <UsersPage />
          </MemoryRouter>
        </AuthProvider>
      );

      await waitFor(() => {
        expect(screen.getByRole('img', { name: /photo of carlos alberto/i })).toBeInTheDocument();
      });
      await userEvent.click(screen.getByRole('button', { name: /editar carlos alberto|editar/i }));
      await userEvent.click(screen.getByRole('button', { name: /remover foto/i }));

      expect(await screen.findByText(/no image stored/i)).toBeInTheDocument();
      expect(screen.getAllByRole('img', { name: /photo of carlos alberto/i }).length).toBeGreaterThan(0);
    });
  });
});
