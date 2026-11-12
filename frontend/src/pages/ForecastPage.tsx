import { Fragment, useCallback, useEffect, useState } from 'react';

import { api, ApiError } from '../api/client';
import type { Prediction } from '../api/types';
import { useAuth } from '../context/AuthContext';
import { Icon } from '../components/Icons';
import { RestockModal } from '../components/RestockModal';
import { EmptyState, ErrorNote, Modal, PageHeader, Spinner } from '../components/ui';

export const ForecastPage = () => {
  const { isAdmin } = useAuth();
  const [items, setItems] = useState<Prediction[]>([]);
  const [urgentCount, setUrgentCount] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [expanded, setExpanded] = useState<string | null>(null);
  const [restocking, setRestocking] = useState<Prediction | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const result = await api.predictions();
      setItems(result.items);
      setUrgentCount(result.urgentCount);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Forecasts could not be calculated.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  return (
    <div className="stack">
      <PageHeader
        eyebrow="Explainable forecasting"
        title="Reorder points, decoded."
        description="Reorder point = average daily demand × supplier lead time + safety stock. Every number below is derived from this business's recorded sales."
        actions={
          <button type="button" className="btn btn-ghost" onClick={() => void load()}>
            <Icon name="trend" /> Recalculate
          </button>
        }
      />

      <div className="formula-strip">
        <span className="formula-part">Average daily demand</span>
        <span className="formula-op">×</span>
        <span className="formula-part">Lead time</span>
        <span className="formula-op">+</span>
        <span className="formula-part">Safety stock</span>
        <span className="formula-op">=</span>
        <span className="formula-part formula-result">Reorder point</span>
      </div>

      {notice ? <div className="notice" role="status">{notice}</div> : null}
      {error ? <ErrorNote>{error}</ErrorNote> : null}

      {loading ? (
        <Spinner label="Calculating from sales history…" />
      ) : items.length === 0 ? (
        <EmptyState
          title="No products to forecast"
          body="Add products and record sales; demand averages and reorder points will be calculated from that history."
        />
      ) : (
        <>
          <section className="stats-grid stats-grid-3">
            <article className="stat stat-accent">
              <p className="stat-label">Products analysed</p>
              <p className="stat-value">{items.length}</p>
              <p className="stat-hint">Last 30 days of sales</p>
            </article>
            <article className="stat stat-warn">
              <p className="stat-label">Urgent reorders</p>
              <p className="stat-value">{urgentCount}</p>
              <p className="stat-hint">At or below threshold</p>
            </article>
            <article className="stat">
              <p className="stat-label">Units suggested</p>
              <p className="stat-value">
                {items.reduce((sum, item) => sum + item.suggestedOrderQuantity, 0)}
              </p>
              <p className="stat-hint">To reach reorder point + safety stock</p>
            </article>
          </section>

          <section className="panel panel-table">
            <div className="table-scroll">
              <table>
                <thead>
                  <tr>
                    <th>Product</th>
                    <th className="num">On hand</th>
                    <th className="num">Avg / day</th>
                    <th className="num">Lead</th>
                    <th className="num">Safety</th>
                    <th className="num">Reorder at</th>
                    <th className="num">Suggested</th>
                    <th>Urgency</th>
                    <th aria-label="Actions" />
                  </tr>
                </thead>
                <tbody>
                  {items.map((item) => (
                    <Fragment key={item.productId}>
                      <tr>
                        <td>
                          <div className="cell-title">
                            <strong>{item.productName}</strong>
                            <span>{item.sku}</span>
                          </div>
                        </td>
                        <td className="num mono">{item.currentQuantity}</td>
                        <td className="num mono">{item.averageDailyDemand}</td>
                        <td className="num mono">{item.leadTimeDays}d</td>
                        <td className="num mono">{item.safetyStock}</td>
                        <td className="num mono">{item.reorderPoint}</td>
                        <td className="num mono">{item.suggestedOrderQuantity}</td>
                        <td>
                          <span className={`badge ${item.urgency === 'HIGH' ? 'badge-danger' : 'badge-ok'}`}>
                            {item.urgency === 'HIGH' ? 'High' : 'Normal'}
                          </span>
                        </td>
                        <td>
                          <div className="row-actions">
                            <button
                              type="button"
                              className="btn btn-small btn-ghost"
                              onClick={() =>
                                setExpanded(expanded === item.productId ? null : item.productId)
                              }
                            >
                              {expanded === item.productId ? 'Hide' : 'Explain'}
                            </button>
                            {isAdmin ? (
                              <button
                                type="button"
                                className="btn btn-small"
                                onClick={() => setRestocking(item)}
                              >
                                Restock
                              </button>
                            ) : null}
                          </div>
                        </td>
                      </tr>
                      {expanded === item.productId ? (
                        <tr className="explain-row">
                          <td colSpan={9}>
                            <div className="explain">
                              <p>
                                <strong>{item.averageDailyDemand}</strong> units/day ×{' '}
                                <strong>{item.leadTimeDays}</strong> days lead time +{' '}
                                <strong>{item.safetyStock}</strong> safety = reorder point{' '}
                                <strong>{item.reorderPoint}</strong>.
                              </p>
                              <p>
                                With <strong>{item.currentQuantity}</strong> on hand, order{' '}
                                <strong>{item.suggestedOrderQuantity}</strong> units to cover demand
                                and keep a buffer.
                              </p>
                            </div>
                          </td>
                        </tr>
                      ) : null}
                    </Fragment>
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
            productId={restocking.productId}
            productName={restocking.productName}
            suggestedQuantity={restocking.suggestedOrderQuantity}
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
