import { useCallback, useEffect, useState, type FormEvent } from 'react';

import { api, ApiError } from '../api/client';
import type { MovementReason, Product, ProductInput } from '../api/types';
import { useAuth } from '../context/AuthContext';
import {
  cacheProducts,
  getCachedProducts,
} from '../services/offlineService';
import { BarcodeScanner } from '../components/BarcodeScanner';
import { Icon } from '../components/Icons';
import {
  EmptyState,
  ErrorNote,
  Modal,
  PageHeader,
  Pagination,
  Spinner,
  money,
} from '../components/ui';

const emptyForm: ProductInput = {
  name: '',
  sku: '',
  barcode: '',
  category: 'Uncategorized',
  purchasePrice: 0,
  sellingPrice: 0,
  currentQuantity: 0,
  minimumStockThreshold: 0,
  supplierLeadTime: 1,
};

const ProductForm = ({
  initial,
  onCancel,
  onSubmit,
  busy,
  isEdit,
}: {
  initial: ProductInput;
  onCancel: () => void;
  onSubmit: (payload: ProductInput) => Promise<void>;
  busy: boolean;
  isEdit: boolean;
}) => {
  const [form, setForm] = useState<ProductInput>(initial);

  const setNumber = (key: keyof ProductInput, value: string) =>
    setForm((current) => ({ ...current, [key]: Number(value) }));

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    await onSubmit(form);
  };

  return (
    <form className="form-grid" onSubmit={submit}>
      <label className="field field-span">
        <span>Product name</span>
        <input
          required
          minLength={3}
          value={form.name}
          onChange={(event) => setForm({ ...form, name: event.target.value })}
        />
      </label>
      <label className="field">
        <span>SKU</span>
        <input
          required
          value={form.sku}
          onChange={(event) => setForm({ ...form, sku: event.target.value })}
        />
      </label>
      <label className="field">
        <span>Barcode</span>
        <input
          required
          value={form.barcode}
          onChange={(event) => setForm({ ...form, barcode: event.target.value })}
        />
      </label>
      <label className="field">
        <span>Category</span>
        <input
          value={form.category}
          onChange={(event) => setForm({ ...form, category: event.target.value })}
        />
      </label>
      <label className="field">
        <span>Supplier lead time (days)</span>
        <input
          type="number"
          min={1}
          required
          value={form.supplierLeadTime}
          onChange={(event) => setNumber('supplierLeadTime', event.target.value)}
        />
      </label>
      <label className="field">
        <span>Purchase price</span>
        <input
          type="number"
          min={0}
          step="0.01"
          required
          value={form.purchasePrice}
          onChange={(event) => setNumber('purchasePrice', event.target.value)}
        />
      </label>
      <label className="field">
        <span>Selling price</span>
        <input
          type="number"
          min={0}
          step="0.01"
          required
          value={form.sellingPrice}
          onChange={(event) => setNumber('sellingPrice', event.target.value)}
        />
      </label>
      <label className="field">
        <span>Low-stock threshold</span>
        <input
          type="number"
          min={0}
          required
          value={form.minimumStockThreshold}
          onChange={(event) => setNumber('minimumStockThreshold', event.target.value)}
        />
      </label>
      <label className="field">
        <span>Opening quantity</span>
        <input
          type="number"
          min={0}
          disabled={isEdit}
          value={form.currentQuantity ?? 0}
          onChange={(event) => setNumber('currentQuantity', event.target.value)}
        />
        <small>{isEdit ? 'Change stock through a recorded movement.' : 'Recorded as the opening balance.'}</small>
      </label>
      <div className="form-actions field-span">
        <button type="button" className="btn btn-ghost" onClick={onCancel} disabled={busy}>
          Cancel
        </button>
        <button type="submit" className="btn btn-primary" disabled={busy}>
          {busy ? 'Saving…' : isEdit ? 'Save changes' : 'Create product'}
        </button>
      </div>
    </form>
  );
};

const AdjustStockForm = ({
  product,
  onCancel,
  onSubmit,
  busy,
}: {
  product: Product;
  onCancel: () => void;
  onSubmit: (payload: {
    movementType: 'in' | 'out';
    quantityChange: number;
    reason: Exclude<MovementReason, 'sale'>;
    note?: string;
  }) => Promise<void>;
  busy: boolean;
}) => {
  const [movementType, setMovementType] = useState<'in' | 'out'>('in');
  const [quantity, setQuantity] = useState(1);
  const [reason, setReason] = useState<Exclude<MovementReason, 'sale'>>('purchase');
  const [note, setNote] = useState('');

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    await onSubmit({
      movementType,
      quantityChange: quantity,
      reason,
      ...(note.trim() ? { note: note.trim() } : {}),
    });
  };

  return (
    <form className="form-grid" onSubmit={submit}>
      <p className="form-note field-span">
        Adjusting <strong>{product.name}</strong> · currently {product.currentQuantity} on hand. This
        writes an audited stock movement.
      </p>
      <label className="field">
        <span>Direction</span>
        <select
          value={movementType}
          onChange={(event) => setMovementType(event.target.value as 'in' | 'out')}
        >
          <option value="in">Stock in</option>
          <option value="out">Stock out</option>
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
          <option value="purchase">Purchase / delivery</option>
          <option value="adjustment">Adjustment</option>
          <option value="return">Return</option>
          <option value="transfer">Transfer</option>
          <option value="waste">Waste / damage</option>
        </select>
      </label>
      <label className="field field-span">
        <span>Note (optional)</span>
        <input maxLength={250} value={note} onChange={(event) => setNote(event.target.value)} />
      </label>
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

export const InventoryPage = () => {
  const { isAdmin, user } = useAuth();
  const [items, setItems] = useState<Product[]>([]);
  const [total, setTotal] = useState(0);
  const [pages, setPages] = useState(1);
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState('');
  const [appliedSearch, setAppliedSearch] = useState('');
  const [category, setCategory] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [cachedAt, setCachedAt] = useState<number | null>(null);
  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState<Product | null>(null);
  const [adjusting, setAdjusting] = useState<Product | null>(null);
  const [scannerOpen, setScannerOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState('');

  useEffect(() => {
    const timer = window.setTimeout(() => {
      setPage(1);
      setAppliedSearch(search.trim());
    }, 300);
    return () => window.clearTimeout(timer);
  }, [search]);

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const result = await api.listProducts({
        page,
        limit: 20,
        search: appliedSearch,
        category,
      });
      setItems(result.items);
      setTotal(result.total);
      setPages(result.pages);
      setCachedAt(null);
      if (user?.businessId && page === 1 && !appliedSearch && !category) {
        void cacheProducts(user.businessId, result.items);
      }
    } catch (err) {
      const apiError = err instanceof ApiError ? err : null;
      if (apiError && apiError.status === 0 && user?.businessId) {
        const cached = await getCachedProducts(user.businessId);
        if (cached) {
          setItems(cached.products);
          setTotal(cached.products.length);
          setPages(1);
          setCachedAt(cached.cachedAt);
          setError('');
          return;
        }
      }
      setError(apiError?.message ?? 'Inventory could not be loaded.');
    } finally {
      setLoading(false);
    }
  }, [page, appliedSearch, category, user?.businessId]);

  useEffect(() => {
    void load();
  }, [load]);

  const saveProduct = async (payload: ProductInput) => {
    setBusy(true);
    setError('');
    try {
      if (editing) {
        await api.updateProduct(editing.id, payload);
        setNotice('Product updated.');
      } else {
        await api.createProduct(payload);
        setNotice('Product created.');
      }
      setFormOpen(false);
      setEditing(null);
      await load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Product could not be saved.');
    } finally {
      setBusy(false);
    }
  };

  const removeProduct = async (product: Product) => {
    if (!window.confirm(`Delete "${product.name}"? Its recorded movements remain in the audit trail.`)) {
      return;
    }
    setError('');
    try {
      await api.deleteProduct(product.id);
      setNotice('Product deleted.');
      await load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Product could not be deleted.');
    }
  };

  const recordMovement = async (payload: {
    movementType: 'in' | 'out';
    quantityChange: number;
    reason: Exclude<MovementReason, 'sale'>;
    note?: string;
  }) => {
    if (!adjusting) {
      return;
    }
    setBusy(true);
    setError('');
    try {
      await api.createMovement({ productId: adjusting.id, ...payload });
      setNotice('Stock movement recorded.');
      setAdjusting(null);
      await load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Movement could not be recorded.');
    } finally {
      setBusy(false);
    }
  };

  const startCreate = () => {
    setEditing(null);
    setFormOpen(true);
  };

  const startEdit = (product: Product) => {
    setEditing(product);
    setFormOpen(true);
  };

  return (
    <div className="stack">
      <PageHeader
        eyebrow="Inventory"
        title="The shelf, itemised."
        description="Search, filter and maintain products. Stock quantities only change through audited movements or sales."
        actions={
          <>
            <button type="button" className="btn btn-ghost" onClick={() => setScannerOpen(true)}>
              <Icon name="scan" /> Scan barcode
            </button>
            {isAdmin ? (
              <button type="button" className="btn btn-primary" onClick={startCreate}>
                <Icon name="plus" /> Add product
              </button>
            ) : null}
          </>
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
      {cachedAt ? (
        <p className="offline-note">
          Showing the cached snapshot from {new Date(cachedAt).toLocaleString()}. Changes require a
          connection.
        </p>
      ) : null}

      <section className="toolbar">
        <label className="search-field">
          <Icon name="search" />
          <input
            type="search"
            placeholder="Search name, SKU or barcode"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
          />
        </label>
        <label className="field field-inline">
          <span>Category</span>
          <input
            placeholder="All categories"
            value={category}
            onChange={(event) => {
              setCategory(event.target.value);
              setPage(1);
            }}
          />
        </label>
      </section>

      <section className="panel panel-table">
        {loading ? (
          <Spinner label="Loading inventory…" />
        ) : items.length === 0 ? (
          <EmptyState
            title={appliedSearch || category ? 'No products match' : 'No products yet'}
            body={
              appliedSearch || category
                ? 'Try a different search or clear the category filter.'
                : isAdmin
                  ? 'Add the first product to start tracking stock and sales.'
                  : 'An administrator has not added products yet.'
            }
            action={
              isAdmin && !appliedSearch && !category ? (
                <button type="button" className="btn btn-primary" onClick={startCreate}>
                  Add product
                </button>
              ) : null
            }
          />
        ) : (
          <div className="table-scroll">
            <table>
              <thead>
                <tr>
                  <th>Product</th>
                  <th>Barcode</th>
                  <th className="num">On hand</th>
                  <th className="num">Threshold</th>
                  <th className="num">Sell price</th>
                  <th className="num">Lead</th>
                  {isAdmin ? <th aria-label="Actions" /> : null}
                </tr>
              </thead>
              <tbody>
                {items.map((product) => {
                  const out = product.currentQuantity === 0;
                  const low = product.currentQuantity <= product.minimumStockThreshold;
                  return (
                    <tr key={product.id}>
                      <td>
                        <div className="cell-title">
                          <strong>{product.name}</strong>
                          <span>
                            {product.sku} · {product.category}
                          </span>
                        </div>
                      </td>
                      <td className="mono">{product.barcode}</td>
                      <td className="num">
                        <span className="qty">{product.currentQuantity}</span>
                        {out ? <span className="badge badge-danger">Out</span> : null}
                        {!out && low ? <span className="badge badge-warn">Low</span> : null}
                      </td>
                      <td className="num mono">{product.minimumStockThreshold}</td>
                      <td className="num mono">{money(product.sellingPrice)}</td>
                      <td className="num mono">{product.supplierLeadTime}d</td>
                      {isAdmin ? (
                        <td>
                          <div className="row-actions">
                            <button
                              type="button"
                              className="icon-btn"
                              title="Adjust stock"
                              aria-label={`Adjust stock for ${product.name}`}
                              onClick={() => setAdjusting(product)}
                            >
                              <Icon name="shelf" />
                            </button>
                            <button
                              type="button"
                              className="icon-btn"
                              title="Edit product"
                              aria-label={`Edit ${product.name}`}
                              onClick={() => startEdit(product)}
                            >
                              <Icon name="edit" />
                            </button>
                            <button
                              type="button"
                              className="icon-btn icon-btn-danger"
                              title="Delete product"
                              aria-label={`Delete ${product.name}`}
                              onClick={() => void removeProduct(product)}
                            >
                              <Icon name="trash" />
                            </button>
                          </div>
                        </td>
                      ) : null}
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
        <Pagination page={page} pages={pages} total={total} onChange={setPage} />
      </section>

      {formOpen ? (
        <Modal
          title={editing ? `Edit ${editing.name}` : 'Add product'}
          onClose={() => {
            setFormOpen(false);
            setEditing(null);
          }}
          wide
        >
          <ProductForm
            initial={
              editing
                ? {
                    name: editing.name,
                    sku: editing.sku,
                    barcode: editing.barcode,
                    category: editing.category,
                    purchasePrice: editing.purchasePrice,
                    sellingPrice: editing.sellingPrice,
                    currentQuantity: editing.currentQuantity,
                    minimumStockThreshold: editing.minimumStockThreshold,
                    supplierLeadTime: editing.supplierLeadTime,
                  }
                : emptyForm
            }
            isEdit={Boolean(editing)}
            busy={busy}
            onCancel={() => {
              setFormOpen(false);
              setEditing(null);
            }}
            onSubmit={saveProduct}
          />
        </Modal>
      ) : null}

      {adjusting ? (
        <Modal title="Record stock movement" onClose={() => setAdjusting(null)}>
          <AdjustStockForm
            product={adjusting}
            busy={busy}
            onCancel={() => setAdjusting(null)}
            onSubmit={recordMovement}
          />
        </Modal>
      ) : null}

      {scannerOpen ? (
        <Modal title="Scan a barcode" onClose={() => setScannerOpen(false)}>
          <BarcodeScanner
            onDetected={(code) => {
              setSearch(code);
              setScannerOpen(false);
              setNotice(`Barcode ${code} scanned into the search.`);
            }}
            onClose={() => setScannerOpen(false)}
          />
        </Modal>
      ) : null}
    </div>
  );
};
