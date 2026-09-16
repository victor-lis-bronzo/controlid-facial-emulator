import React, { useEffect, useState } from 'react';
import { useFcgi } from '../hooks/useFcgi.ts';
import { Avatar } from './Avatar.tsx';
import { validatePhotoFile } from '../lib/photo-validation.ts';

interface PhotoFieldProps {
  /**
   * The owning user's id. Required (and used) only in `mode: 'edit'`, where
   * the field targets `user_set_image.fcgi`/`user_destroy_image.fcgi` for
   * that user and renders the `Avatar` preview. Ignored in `mode: 'staged'`.
   */
  userId?: number;
  hasPhoto: boolean;
  name: string;
  refreshToken?: number;
  session?: string;
  /** `id`/`htmlFor` pair for the hidden file input and its label. */
  inputId?: string;
  /**
   * `'edit'` (default): the user already exists — selecting a file uploads
   * it immediately via `user_set_image.fcgi`, removal calls
   * `user_destroy_image.fcgi`.
   * `'staged'`: the user doesn't exist yet (create-user form). A selected
   * file is only validated and held locally (with an object-URL preview);
   * no network call is made. The file is handed to the parent via
   * `onFileStaged` so it can be uploaded after the user is created.
   */
  mode?: 'edit' | 'staged';
  /** `mode: 'staged'` only. Called with the validated file, or `null` when cleared. */
  onFileStaged?: (file: File | null) => void;
  /** Called after a successful upload (`true`) or removal (`false`). `mode: 'edit'` only. */
  onPhotoUpdated?: (hasPhoto: boolean) => void | Promise<void>;
  /**
   * Pre-populates `photoError` on mount, e.g. when a caller reopens this
   * field already knowing about a prior failure (such as a partial failure
   * after user creation — see Issue #40). Only read once, at mount; later
   * prop changes do not resync internal state.
   */
  initialError?: string | null;
}

export function PhotoField({
  userId,
  hasPhoto,
  name,
  refreshToken,
  session,
  inputId = 'editUserPhoto',
  mode = 'edit',
  onFileStaged,
  onPhotoUpdated,
  initialError = null,
}: PhotoFieldProps) {
  const { fcgiFetch, fcgiUpload } = useFcgi();

  const [photoError, setPhotoError] = useState<string | null>(initialError);
  const [uploadingPhoto, setUploadingPhoto] = useState(false);
  const [removingPhoto, setRemovingPhoto] = useState(false);
  const [stagedFile, setStagedFile] = useState<File | null>(null);
  const [stagedPreviewUrl, setStagedPreviewUrl] = useState<string | null>(null);

  // Keep the object URL in sync with the staged file, and revoke it on
  // change/unmount so we don't leak blob URLs.
  useEffect(() => {
    if (!stagedFile) {
      setStagedPreviewUrl(null);
      return;
    }
    const url = URL.createObjectURL(stagedFile);
    setStagedPreviewUrl(url);
    return () => URL.revokeObjectURL(url);
  }, [stagedFile]);

  const handlePhotoSelected = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;

    const validationError = validatePhotoFile(file);
    if (validationError) {
      setPhotoError(validationError);
      return;
    }

    if (mode === 'staged') {
      setPhotoError(null);
      setStagedFile(file);
      onFileStaged?.(file);
      return;
    }

    if (userId === undefined) return;

    try {
      setUploadingPhoto(true);
      setPhotoError(null);

      const body = new FormData();
      body.append('user_id', String(userId));
      body.append('file', file);
      await fcgiUpload('/user_set_image.fcgi', body);

      await onPhotoUpdated?.(true);
    } catch (err) {
      setPhotoError(err instanceof Error ? err.message : 'Erro ao enviar foto');
    } finally {
      setUploadingPhoto(false);
    }
  };

  const handleRemovePhoto = async () => {
    if (mode === 'staged') {
      setPhotoError(null);
      setStagedFile(null);
      onFileStaged?.(null);
      return;
    }

    if (userId === undefined) return;
    try {
      setRemovingPhoto(true);
      setPhotoError(null);

      await fcgiFetch('/user_destroy_image.fcgi', {
        method: 'POST',
        body: JSON.stringify({ user_id: userId }),
      });

      await onPhotoUpdated?.(false);
    } catch (err) {
      setPhotoError(err instanceof Error ? err.message : 'Erro ao remover foto');
    } finally {
      setRemovingPhoto(false);
    }
  };

  const canRemove = mode === 'staged' ? stagedFile !== null : hasPhoto;

  return (
    <div>
      <span className="block text-xs font-semibold uppercase tracking-wider text-slate-300 mb-1">
        Foto de Rosto
      </span>
      <div className="flex items-center gap-3">
        {mode === 'edit' && userId !== undefined && (
          <Avatar
            userId={userId}
            hasPhoto={hasPhoto}
            name={name}
            refreshToken={refreshToken}
            session={session}
          />
        )}
        {mode === 'staged' && stagedPreviewUrl && (
          <img
            src={stagedPreviewUrl}
            alt={`Prévia da foto de ${name || 'novo usuário'}`}
            className="h-10 w-10 rounded-full object-cover border border-slate-700"
          />
        )}
        <label
          htmlFor={inputId}
          className="cursor-pointer rounded-lg border border-slate-700 px-3 py-1.5 text-xs font-semibold text-slate-300 hover:bg-slate-800 transition-colors"
        >
          {uploadingPhoto ? 'Enviando...' : 'Selecionar Foto'}
        </label>
        <input
          id={inputId}
          type="file"
          accept="image/jpeg,image/png"
          onChange={handlePhotoSelected}
          disabled={uploadingPhoto}
          className="sr-only"
        />
        <button
          type="button"
          onClick={handleRemovePhoto}
          disabled={!canRemove || removingPhoto}
          className="text-xs font-semibold text-rose-400 hover:text-rose-300 px-2.5 py-1 rounded border border-rose-500/30 hover:bg-rose-500/10 transition-colors disabled:opacity-40 disabled:hover:bg-transparent"
        >
          {removingPhoto ? 'Removendo...' : 'Remover Foto'}
        </button>
      </div>
      {photoError && (
        <div className="mt-2 rounded-lg bg-rose-500/10 border border-rose-500/20 p-3 text-xs text-rose-400">
          {photoError}
        </div>
      )}
    </div>
  );
}
