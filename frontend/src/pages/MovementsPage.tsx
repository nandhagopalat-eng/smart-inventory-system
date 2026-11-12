import { useCallback, useEffect, useMemo, useState, type FormEvent } from 'react';

import { api, ApiError } from '../api/client';
import type { MovementReason, Product, StockMovement } from '../api/types';
import { useAuth } from '../context/AuthContext';
import { Icon } from '../components/Icons';
import {
  EmptyState,
  ErrorNote,
  Modal,
  PageHeader,
  Pagination,
  Spinner,
  formatDate,
} from '../components/ui';

const REASONS: Array<Exclude<MovementReason, 'sale'>> = [
  'purchase',
  'adjustment',
  'return',
  'transfer',
  'waste',
];

const RecordMovementForm = ({
  products,
  onCancel,
  onDone,
}: {
  products: Product[];
  onCancel: () => void;
  onDone: (message: string) => void;
}) => {
  const [productId, setProductId] = useState(products[0]?.id ?? '');
  const [movementType, setMovementType] = useState<'in' | 'out'>('in');
  const [quantity, setQuantity] = useState(1);
  const [reason, setReason] = useState<Exclude<MovementReason, 'sale'>>('purchase');
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setBusy(true);
    setError('');
    try {
      await api.createMovement({
        productId,
        movementType,
        quantityChange: quantity,
        reason,
        ...(note.trim() ? { note: note.trim() } : {}),
      });
      const product = products.find((item) => item.id === productId);
      onDone(`Movement recorded for ${product?.name ?? 'product'}.`);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Movement could not be recorded.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <form className="form-grid" onSubmit={submit}>
      <label className="field field-span">
        <span>Product</span>
        <select value={productId} onChange={(event) => setProductId(event.target.value)} required>
          {products.map((product) => (
            <option key={product.id} value={product.id}>
              {product.name} · {product.sku} · {product.currentQuantity} on hand
            </option>
          ))}
        </select>
      </label>
      <label className="field">
        <span>Direction</span>
        <select
          value={movementType}
          onChange={(event) => setMovementType(event.target.value as 'in' | 'out')}
        >
          <option value="in">Stock in (+)</option>
          <option value="out">Stock out (−)</option>
        </select>
      </label>
      <label className="field">
        <span>Quantity</span>
        <input
          type="number"
          min={1}
          step={1}
          required
          value={quantity}
          onChange={(event) => setQuantity(Number(event.target.value))}
        />
      </label>
      <label className="field">
        <span>Reason</span>
        <select
          value={reason}
          onChange={(event) => setReason(event.target.value as Exclude<MovementReason, 'sale'>)}
        >
          {REASONS.map((option) => (
            <option key={option} value={option}>
              {option}
            </option>
          ))}
        </select>
      </label>
      <label className="field field-span">
        <span>Note (optional)</span>
        <input maxLength={250} value={note} onChange={(event) => setNote(event.target.value)} />
      </label>
      {error ? <div className="field-span"><ErrorNote>{error}</ErrorNote></div> : null}
      <div className="form-actions field-span">
        <button type="button" className="btn btn-ghost" onClick={onCancel} disabled={busy}>
          Cancel
        </button>
        <button type="submit" className="btn btn-primary" disabled={busy}>
          {busy ? 'Recording…' : 'Record movement'}
        </button>
      </div>
    </form>
  );
};

export const MovementsPage = () => {
  const { isAdmin } = useAuth();
  const [items, setItems] = useState<StockMovement[]>([]);
  const [products, setProducts] = useState<Product[]>([]);
  const [page, setPage] = useState(1);
  const [pages, setPages] = useState(1);
  const [total, setTotal] = useState(0);
  const [productFilter, setProductFilter] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [formOpen, setFormOpen] = useState(false);

  const productNames = useMemo(
    () => new Map(products.map((product) => [product.id, product.name])),
    [products]
  );

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const result = await api.listMovements({
        page,
        limit: 20,
        productId: productFilter || undefined,
      });
      setItems(result.items);
      setTotal(result.total);
      setPages(result.pages);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Movements could not be loaded.');
    } finally {
      setLoading(false);
    }
  }, [page, productFilter]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    api
      .listProducts({ limit: 100 })
      .then((result) => setProducts(result.items))
      .catch(() => undefined);
  }, []);

  return (
    <div className="stack">
      <PageHeader
        eyebrow="Stock movements"
        title="Every change, signed."
        description="Sales, purchases, adjustments, returns, transfers and waste. Stock never changes without an entry here."
        actions={
          isAdmin ? (
            <button type="button" className="btn btn-primary" onClick={() => setFormOpen(true)}>
              <Icon name="plus" /> Record movement
            </button>
          ) : undefined
        }
      />

      {notice ? (
        <div className="notice" role="status">
          {notice}
          <button type="button" className="notice-close" onClick={() => setNotice('')} aria-label="Dismiss">
            ×
          </button>
        </div>
      ) : null}
      {error ? <ErrorNote>{error}</ErrorNote> : null}

      <section className="toolbar">
        <label className="field field-inline">
          <span>Filter by product</span>
          <select
            value={productFilter}
            onChange={(event) => {
              setProductFilter(event.target.value);
              setPage(1);
            }}
          >
            <option value="">All products</option>
            {products.map((product) => (
              <option key={product.id} value={product.id}>
                {product.name}
              </option>
            ))}
          </select>
        </label>
        <button type="button" className="btn btn-ghost" onClick={() => void load()}>
          <Icon name="history" /> Refresh
        </button>
      </section>

      <section className="panel panel-table">
        {loading ? (
          <Spinner label="Loading audit trail…" />
        ) : items.length === 0 ? (
          <EmptyState
            title="No movements recorded"
            body={
              productFilter
                ? 'This product has no stock movements yet.'
                : 'Sales and stock adjustments will appear here as they are recorded.'
            }
          />
        ) : (
          <div className="table-scroll">
            <table>
              <thead>
                <tr>
                  <th>When</th>
                  <th>Product</th>
                  <th>Direction</th>
                  <th className="num">Qty</th>
                  <th>Reason</th>
                  <th>Note</th>
                </tr>
              </thead>
              <tbody>
                {items.map((movement) => (
                  <tr key={movement.id}>
                    <td className="mono">{formatDate(movement.timestamp)}</td>
                    <td>{productNames.get(movement.productId) ?? movement.productId.slice(-6)}</td>
                    <td>
                      <span className={`badge ${movement.movementType === 'in' ? 'badge-ok' : 'badge-neutral'}`}>
                        {movement.movementType === 'in' ? 'Stock in' : 'Stock out'}
                      </span>
                    </td>
                    <td className="num mono">
                      {movement.movementType === 'in' ? '+' : '−'}
                      {movement.quantityChange}
                    </td>
                    <td className="cap">{movement.reason}</td>
                    <td className="muted">{movement.note ?? '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        <Pagination page={page} pages={pages} total={total} onChange={setPage} />
      </section>

      {formOpen && products.length > 0 ? (
        <Modal title="Record a stock movement" onClose={() => setFormOpen(false)} wide>
          <RecordMovementForm
            products={products}
            onCancel={() => setFormOpen(false)}
            onDone={(message) => {
              setFormOpen(false);
              setNotice(message);
              void load();
            }}
          />
        </Modal>
      ) : null}
    </div>
  );
};
