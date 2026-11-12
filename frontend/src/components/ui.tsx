import { useEffect, type ReactNode } from 'react';

export const Modal = ({
  title,
  onClose,
  children,
  wide = false,
}: {
  title: string;
  onClose: () => void;
  children: ReactNode;
  wide?: boolean;
}) => {
  useEffect(() => {
    const handleKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        onClose();
      }
    };
    window.addEventListener('keydown', handleKey);
    return () => window.removeEventListener('keydown', handleKey);
  }, [onClose]);

  return (
    <div className="modal-backdrop" role="presentation" onMouseDown={onClose}>
      <div
        className={`modal${wide ? ' modal-wide' : ''}`}
        role="dialog"
        aria-modal="true"
        aria-label={title}
        onMouseDown={(event) => event.stopPropagation()}
      >
        <div className="modal-head">
          <h2>{title}</h2>
          <button type="button" className="icon-btn" onClick={onClose} aria-label="Close dialog">
            ×
          </button>
        </div>
        <div className="modal-body">{children}</div>
      </div>
    </div>
  );
};

export const PageHeader = ({
  eyebrow,
  title,
  description,
  actions,
}: {
  eyebrow: string;
  title: string;
  description?: string;
  actions?: ReactNode;
}) => (
  <header className="page-head">
    <div>
      <p className="eyebrow">{eyebrow}</p>
      <h1>{title}</h1>
      {description ? <p className="page-description">{description}</p> : null}
    </div>
    {actions ? <div className="page-actions">{actions}</div> : null}
  </header>
);

export const Stat = ({
  label,
  value,
  hint,
  tone = 'default',
}: {
  label: string;
  value: string;
  hint?: string;
  tone?: 'default' | 'warn' | 'good' | 'accent';
}) => (
  <article className={`stat stat-${tone}`}>
    <p className="stat-label">{label}</p>
    <p className="stat-value">{value}</p>
    {hint ? <p className="stat-hint">{hint}</p> : null}
  </article>
);

export const EmptyState = ({
  title,
  body,
  action,
}: {
  title: string;
  body: string;
  action?: ReactNode;
}) => (
  <div className="empty">
    <div className="empty-mark">∅</div>
    <h3>{title}</h3>
    <p>{body}</p>
    {action}
  </div>
);

export const Pagination = ({
  page,
  pages,
  total,
  onChange,
}: {
  page: number;
  pages: number;
  total: number;
  onChange: (page: number) => void;
}) => (
  <nav className="pagination" aria-label="Pagination">
    <span className="pagination-info">
      Page {page} of {pages || 1} · {total} records
    </span>
    <div className="pagination-actions">
      <button type="button" className="btn btn-ghost" disabled={page <= 1} onClick={() => onChange(page - 1)}>
        ← Previous
      </button>
      <button
        type="button"
        className="btn btn-ghost"
        disabled={page >= pages}
        onClick={() => onChange(page + 1)}
      >
        Next →
      </button>
    </div>
  </nav>
);

export const Spinner = ({ label = 'Loading' }: { label?: string }) => (
  <div className="spinner-row">
    <span className="spinner" aria-hidden="true" />
    {label}
  </div>
);

export const ErrorNote = ({ children }: { children: ReactNode }) => (
  <p className="error-note" role="alert">
    {children}
  </p>
);

export const money = (value: number): string =>
  new Intl.NumberFormat('en-IN', {
    style: 'currency',
    currency: 'INR',
    maximumFractionDigits: 2,
  }).format(value);

export const formatDate = (value: string): string =>
  new Date(value).toLocaleString('en-IN', {
    day: '2-digit',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
  });
