import { useCallback, useEffect, useState } from 'react';

import { api, ApiError } from '../api/client';
import type { Product, Sale, SaleInput } from '../api/types';
import { useAuth } from '../context/AuthContext';
import { queueSale } from '../services/offlineService';
import { BarcodeScanner } from '../components/BarcodeScanner';
import { Icon } from '../components/Icons';
import {
  EmptyState,
  ErrorNote,
  Modal,
  PageHeader,
  Spinner,
  formatDate,
  money,
} from '../components/ui';

interface CartLine {
  product: Product;
  quantity: number;
}

const PAYMENT_METHODS: Array<SaleInput['paymentMethod']> = ['cash', 'card', 'transfer', 'other'];

export const SalesPage = () => {
  const { user } = useAuth();
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<Product[]>([]);
  const [searching, setSearching] = useState(false);
  const [cart, setCart] = useState<CartLine[]>([]);
  const [paymentMethod, setPaymentMethod] = useState<SaleInput['paymentMethod']>('cash');
  const [notes, setNotes] = useState('');
  const [recent, setRecent] = useState<Sale[]>([]);
  const [recentTotal, setRecentTotal] = useState(0);
  const [loadingRecent, setLoadingRecent] = useState(true);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [receipt, setReceipt] = useState<Sale | null>(null);
  const [scannerOpen, setScannerOpen] = useState(false);
  const [busy, setBusy] = useState(false);

  const loadRecent = useCallback(async () => {
    setLoadingRecent(true);
    try {
      const result = await api.listSales({ limit: 10 });
      setRecent(result.items);
      setRecentTotal(result.total);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Recent sales could not be loaded.');
    } finally {
      setLoadingRecent(false);
    }
  }, []);

  useEffect(() => {
    void loadRecent();
  }, [loadRecent]);

  useEffect(() => {
    const reload = () => {
      setNotice('');
      void loadRecent();
    };
    window.addEventListener('sales:synced', reload);
    return () => window.removeEventListener('sales:synced', reload);
  }, [loadRecent]);

  useEffect(() => {
    const term = query.trim();
    if (term === '') {
      setResults([]);
      setSearching(false);
      return;
    }

    let cancelled = false;
    setSearching(true);
    const timer = window.setTimeout(async () => {
      try {
        const result = await api.listProducts({ search: term, limit: 8 });
        if (!cancelled) {
          setResults(result.items);
        }
      } catch (err) {
        if (!cancelled) {
          setError(err instanceof ApiError ? err.message : 'Product search failed.');
        }
      } finally {
        if (!cancelled) {
          setSearching(false);
        }
      }
    }, 250);

    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [query]);

  const addToCart = (product: Product) => {
    setError('');
    setReceipt(null);
    if (product.currentQuantity === 0) {
      setError(`"${product.name}" is out of stock.`);
      return;
    }
    setCart((current) => {
      const existing = current.find((line) => line.product.id === product.id);
      if (existing) {
        if (existing.quantity >= product.currentQuantity) {
          setError(`Only ${product.currentQuantity} unit(s) of "${product.name}" are on hand.`);
          return current;
        }
        return current.map((line) =>
          line.product.id === product.id ? { ...line, quantity: line.quantity + 1 } : line
        );
      }
      return [...current, { product, quantity: 1 }];
    });
  };

  const changeQuantity = (productId: string, quantity: number) => {
    setCart((current) =>
      current.map((line) => {
        if (line.product.id !== productId) {
          return line;
        }
        const next = Math.max(1, Math.min(line.product.currentQuantity, Math.floor(quantity) || 1));
        return { ...line, quantity: next };
      })
    );
  };

  const removeLine = (productId: string) => {
    setCart((current) => current.filter((line) => line.product.id !== productId));
  };

  const total = cart.reduce((sum, line) => sum + line.quantity * line.product.sellingPrice, 0);
  const unitCount = cart.reduce((sum, line) => sum + line.quantity, 0);

  const handleScan = async (code: string) => {
    setScannerOpen(false);
    setQuery(code);
    setError('');
    try {
      const result = await api.listProducts({ search: code, limit: 5 });
      const match = result.items.find((product) => product.barcode === code) ?? result.items[0];
      if (!match) {
        setError(`No product found for barcode ${code}.`);
        return;
      }
      addToCart(match);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Barcode lookup failed.');
    }
  };

  const checkout = async () => {
    if (cart.length === 0) {
      return;
    }
    if (!user?.businessId) {
      setError('Your session has no business context.');
      return;
    }

    const payload: SaleInput = {
      items: cart.map((line) => ({
        productId: line.product.id,
        quantity: line.quantity,
      })),
      paymentMethod,
      ...(notes.trim() ? { notes: notes.trim() } : {}),
    };

    setBusy(true);
    setError('');

    const queueOffline = async () => {
      try {
        await queueSale(user.businessId, payload);
        setCart([]);
        setNotes('');
        setNotice('Offline: sale queued and will sync automatically when the connection returns.');
        window.dispatchEvent(new Event('sales:queued'));
      } catch (queueError) {
        setError(
          queueError instanceof Error ? queueError.message : 'The sale could not be queued offline.'
        );
      }
    };

    if (!navigator.onLine) {
      await queueOffline();
      setBusy(false);
      return;
    }

    try {
      const result = await api.recordSale(payload);
      setReceipt(result.sale);
      setCart([]);
      setNotes('');
      setNotice('');
      await loadRecent();
    } catch (err) {
      if (err instanceof ApiError && err.status === 0) {
        await queueOffline();
      } else {
        setError(err instanceof ApiError ? err.message : 'The sale could not be recorded.');
      }
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="stack">
      <PageHeader
        eyebrow="Point of sale"
        title="Ring up a sale."
        description="Prices come from the product record. Submitting writes the sale, deducts stock, and creates a sale movement together."
        actions={
          <button type="button" className="btn btn-ghost" onClick={() => setScannerOpen(true)}>
            <Icon name="scan" /> Scan barcode
          </button>
        }
      />

      {notice ? <div className="notice" role="status">{notice}</div> : null}
      {error ? <ErrorNote>{error}</ErrorNote> : null}

      {receipt ? (
        <div className="receipt" role="status">
          <div>
            <p className="eyebrow">Sale recorded</p>
            <strong>{money(receipt.totalAmount)}</strong>
            <span>
              {receipt.items.reduce((sum, item) => sum + item.quantity, 0)} units ·{' '}
              {receipt.paymentMethod ?? 'cash'} · {formatDate(receipt.timestamp)}
            </span>
          </div>
          <button type="button" className="btn btn-ghost" onClick={() => setReceipt(null)}>
            Dismiss
          </button>
        </div>
      ) : null}

      <section className="pos-grid">
        <article className="panel">
          <div className="panel-head">
            <div>
              <p className="eyebrow">Catalogue</p>
              <h2>Find a product</h2>
            </div>
            {searching ? <span className="muted">Searching…</span> : null}
          </div>

          <label className="search-field">
            <Icon name="search" />
            <input
              type="search"
              placeholder="Scan, or search name / SKU / barcode"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
            />
          </label>

          {query.trim() === '' ? (
            <div className="pos-hint">
              <Icon name="scan" size={28} />
              <p>Scan a barcode or type at least one character to search the catalogue.</p>
            </div>
          ) : results.length === 0 && !searching ? (
            <EmptyState title="No match" body="Check the barcode or search another product name." />
          ) : (
            <ul className="picker-list">
              {results.map((product) => (
                <li key={product.id}>
                  <button
                    type="button"
                    className="picker-item"
                    onClick={() => addToCart(product)}
                    disabled={product.currentQuantity === 0}
                  >
                    <div>
                      <strong>{product.name}</strong>
                      <span>
                        {product.sku} · {product.currentQuantity} on hand
                      </span>
                    </div>
                    <span className="picker-price">
                      {money(product.sellingPrice)}
                      <Icon name="plus" size={14} />
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </article>

        <article className="panel panel-cart">
          <div className="panel-head">
            <div>
              <p className="eyebrow">Current sale</p>
              <h2>Cart</h2>
            </div>
            <span className="panel-tag">{unitCount} units</span>
          </div>

          {cart.length === 0 ? (
            <EmptyState title="Cart is empty" body="Add products from the catalogue to start a sale." />
          ) : (
            <ul className="cart-list">
              {cart.map((line) => (
                <li key={line.product.id}>
                  <div className="cart-main">
                    <strong>{line.product.name}</strong>
                    <span>
                      {money(line.product.sellingPrice)} each · {line.product.currentQuantity} in stock
                    </span>
                  </div>
                  <div className="cart-controls">
                    <input
                      type="number"
                      min={1}
                      max={line.product.currentQuantity}
                      value={line.quantity}
                      aria-label={`Quantity of ${line.product.name}`}
                      onChange={(event) => changeQuantity(line.product.id, Number(event.target.value))}
                    />
                    <button
                      type="button"
                      className="icon-btn icon-btn-danger"
                      aria-label={`Remove ${line.product.name}`}
                      onClick={() => removeLine(line.product.id)}
                    >
                      <Icon name="close" size={15} />
                    </button>
                  </div>
                  <span className="cart-line-total">
                    {money(line.quantity * line.product.sellingPrice)}
                  </span>
                </li>
              ))}
            </ul>
          )}

          <div className="checkout">
            <div className="checkout-total">
              <span>Total</span>
              <strong>{money(total)}</strong>
            </div>
            <div className="checkout-fields">
              <label className="field">
                <span>Payment</span>
                <select
                  value={paymentMethod}
                  onChange={(event) =>
                    setPaymentMethod(event.target.value as SaleInput['paymentMethod'])
                  }
                >
                  {PAYMENT_METHODS.map((method) => (
                    <option key={method} value={method}>
                      {method}
                    </option>
                  ))}
                </select>
              </label>
              <label className="field">
                <span>Notes (optional)</span>
                <input
                  maxLength={250}
                  value={notes}
                  onChange={(event) => setNotes(event.target.value)}
                  placeholder="Counter sale"
                />
              </label>
            </div>
            <button
              type="button"
              className="btn btn-primary btn-block"
              disabled={cart.length === 0 || busy}
              onClick={() => void checkout()}
            >
              {busy ? 'Recording sale…' : `Complete sale · ${money(total)}`}
            </button>
            <p className="muted small">
              If the connection drops, the sale is queued locally and retried automatically.
            </p>
          </div>
        </article>
      </section>

      <section className="panel panel-table">
        <div className="panel-head">
          <div>
            <p className="eyebrow">History</p>
            <h2>Recent sales</h2>
          </div>
          <span className="muted">{recentTotal} recorded</span>
        </div>
        {loadingRecent ? (
          <Spinner label="Loading sales…" />
        ) : recent.length === 0 ? (
          <EmptyState title="No sales yet" body="Your first completed sale will appear here." />
        ) : (
          <div className="table-scroll">
            <table>
              <thead>
                <tr>
                  <th>When</th>
                  <th>Items</th>
                  <th>Payment</th>
                  <th className="num">Total</th>
                </tr>
              </thead>
              <tbody>
                {recent.map((sale) => (
                  <tr key={sale.id}>
                    <td className="mono">{formatDate(sale.timestamp)}</td>
                    <td>
                      {sale.items.map((item) => `${item.quantity}× ${item.productName}`).join(', ')}
                    </td>
                    <td className="cap">{sale.paymentMethod ?? 'cash'}</td>
                    <td className="num mono">{money(sale.totalAmount)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {scannerOpen ? (
        <Modal title="Scan a barcode" onClose={() => setScannerOpen(false)}>
          <BarcodeScanner
            onDetected={(code) => void handleScan(code)}
            onClose={() => setScannerOpen(false)}
          />
        </Modal>
      ) : null}
    </div>
  );
};
