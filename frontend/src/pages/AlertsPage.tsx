import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';

import { api, ApiError } from '../api/client';
import type { LowStockItem } from '../api/types';
import { useAuth } from '../context/AuthContext';
import { Icon } from '../components/Icons';
import { RestockModal } from '../components/RestockModal';
import { EmptyState, ErrorNote, Modal, PageHeader, Spinner } from '../components/ui';

export const AlertsPage = () => {
  const { isAdmin } = useAuth();
  const [items, setItems] = useState<LowStockItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [restocking, setRestocking] = useState<LowStockItem | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const result = await api.lowStock();
      setItems(result.items);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Alerts could not be loaded.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const out = items.filter((item) => item.isOutOfStock);
  const low = items.filter((item) => !item.isOutOfStock);

  return (
    <div className="stack">
      <PageHeader
        eyebrow="Low-stock alerts"
        title="What is running out."
        description="Derived from current quantities against each product's threshold — updated by sales and stock movements."
        actions={
          <button type="button" className="btn btn-ghost" onClick={() => void load()}>
            <Icon name="history" /> Refresh
          </button>
        }
      />

      {notice ? <div className="notice" role="status">{notice}</div> : null}
      {error ? <ErrorNote>{error}</ErrorNote> : null}

      {loading ? (
        <Spinner label="Checking thresholds…" />
      ) : items.length === 0 ? (
        <EmptyState
          title="Nothing below threshold"
          body="Every tracked product is above its minimum stock level."
          action={
            <Link className="btn btn-ghost" to="/forecast">
              Review forecasts
            </Link>
          }
        />
      ) : (
        <>
          <section className="stats-grid stats-grid-3">
            <article className="stat stat-warn">
              <p className="stat-label">Out of stock</p>
              <p className="stat-value">{out.length}</p>
              <p className="stat-hint">Cannot be sold until restocked</p>
            </article>
            <article className="stat">
              <p className="stat-label">Low stock</p>
              <p className="stat-value">{low.length}</p>
              <p className="stat-hint">At or below threshold</p>
            </article>
            <article className="stat stat-accent">
              <p className="stat-label">Units to minimum</p>
              <p className="stat-value">
                {items.reduce((sum, item) => sum + item.stockShortfall, 0)}
              </p>
              <p className="stat-hint">Across all alerts</p>
            </article>
          </section>

          <section className="panel panel-table">
            <div className="table-scroll">
              <table>
                <thead>
                  <tr>
                    <th>Product</th>
                    <th className="num">On hand</th>
                    <th className="num">Threshold</th>
                    <th className="num">Shortfall</th>
                    <th>Status</th>
                    {isAdmin ? <th aria-label="Actions" /> : null}
                  </tr>
                </thead>
                <tbody>
                  {items.map((item) => (
                    <tr key={item.id}>
                      <td>
                        <div className="cell-title">
                          <strong>{item.name}</strong>
                          <span>
                            {item.sku} · {item.category}
                          </span>
                        </div>
                      </td>
                      <td className="num mono">{item.currentQuantity}</td>
                      <td className="num mono">{item.minimumStockThreshold}</td>
                      <td className="num mono">{item.stockShortfall}</td>
                      <td>
                        {item.isOutOfStock ? (
                          <span className="badge badge-danger">Out of stock</span>
                        ) : (
                          <span className="badge badge-warn">Low</span>
                        )}
                      </td>
                      {isAdmin ? (
                        <td>
                          <button
                            type="button"
                            className="btn btn-small"
                            onClick={() => setRestocking(item)}
                          >
                            Restock
                          </button>
                        </td>
                      ) : null}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>
        </>
      )}

      {restocking ? (
        <Modal title="Record restock" onClose={() => setRestocking(null)}>
          <RestockModal
            productId={restocking.id}
            productName={restocking.name}
            suggestedQuantity={Math.max(1, restocking.stockShortfall)}
            onClose={() => setRestocking(null)}
            onDone={(message) => {
              setRestocking(null);
              setNotice(message);
              void load();
            }}
          />
        </Modal>
      ) : null}
    </div>
  );
};
