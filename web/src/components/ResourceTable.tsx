import type { ReactNode } from 'react';

/** A single column definition for {@link ResourceTable}. */
export interface Column<T> {
  /** Stable column key (also used as the React key for the header/cell). */
  key: string;
  /** Column header label. */
  header: string;
  /** Renders the cell content for a given row. */
  render: (row: T) => ReactNode;
}

interface ResourceTableProps<T> {
  /** Column definitions in display order. */
  columns: Column<T>[];
  /** The rows to render. */
  rows: T[];
  /** Extracts a stable React key from a row. */
  rowKey: (row: T) => string | number;
  /** Optional per-row edit action; when provided an Edit button is shown. */
  onEdit?: (row: T) => void;
  /** Optional per-row delete action; when provided a Delete button is shown. */
  onDelete?: (row: T) => void;
  /** Message shown when there are no rows. */
  emptyMessage?: string;
}

/**
 * A generic list table with optional per-row edit/delete actions, reused by
 * every CRUD section (Portals, Groups, Time Zones, Access Rules, Users). Wraps
 * the table in a horizontally scrollable container so wide tables scroll within
 * themselves rather than the page (Req 11.6).
 */
export function ResourceTable<T>({
  columns,
  rows,
  rowKey,
  onEdit,
  onDelete,
  emptyMessage = 'No records yet.',
}: ResourceTableProps<T>) {
  const hasActions = onEdit !== undefined || onDelete !== undefined;

  if (rows.length === 0) {
    return (
      <p className="empty-state" role="status">
        {emptyMessage}
      </p>
    );
  }

  return (
    <div className="table-scroll">
      <table className="log-table">
        <thead>
          <tr>
            {columns.map((col) => (
              <th key={col.key}>{col.header}</th>
            ))}
            {hasActions && <th aria-label="Row actions" />}
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={rowKey(row)}>
              {columns.map((col) => (
                <td key={col.key}>{col.render(row)}</td>
              ))}
              {hasActions && (
                <td className="table-actions">
                  {onEdit !== undefined && (
                    <button
                      type="button"
                      className="button button--secondary button--small"
                      onClick={() => onEdit(row)}
                    >
                      Edit
                    </button>
                  )}
                  {onDelete !== undefined && (
                    <button
                      type="button"
                      className="button button--danger button--small"
                      onClick={() => onDelete(row)}
                    >
                      Delete
                    </button>
                  )}
                </td>
              )}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
