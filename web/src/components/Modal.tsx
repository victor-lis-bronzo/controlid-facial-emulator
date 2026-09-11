import { useEffect } from 'react';
import type { ReactNode } from 'react';

interface ModalProps {
  /** The modal heading. */
  title: string;
  /** Called when the user requests to close (backdrop click, Escape, ✕). */
  onClose: () => void;
  /** Modal body content (typically a form). */
  children: ReactNode;
}

/**
 * A lightweight accessible modal dialog used to host create/edit forms across
 * the CRUD sections. Closes on Escape and backdrop click. No dependency; pure
 * presentational primitive.
 */
export function Modal({ title, onClose, children }: ModalProps) {
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') {
        onClose();
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => {
      window.removeEventListener('keydown', onKeyDown);
    };
  }, [onClose]);

  return (
    <div
      className="modal__backdrop"
      role="presentation"
      onClick={(event) => {
        if (event.target === event.currentTarget) {
          onClose();
        }
      }}
    >
      <div
        className="modal"
        role="dialog"
        aria-modal="true"
        aria-label={title}
      >
        <div className="modal__header">
          <h2 className="modal__title">{title}</h2>
          <button
            type="button"
            className="modal__close"
            aria-label="Close dialog"
            onClick={onClose}
          >
            ✕
          </button>
        </div>
        <div className="modal__body">{children}</div>
      </div>
    </div>
  );
}
