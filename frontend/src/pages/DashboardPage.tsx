import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  Area,
  AreaChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';

import { api, ApiError } from '../api/client';
import type { LowStockItem, Prediction, Product, Sale } from '../api/types';
import { useAuth } from '../context/AuthContext';
import {
  EmptyState,
  ErrorNote,
  PageHeader,
  Spinner,
  Stat,
  formatDate,
  money,
} from '../components/ui';
import { Icon } from '../components/Icons';

interface DashboardData {
  products: { items: Product[]; total: number };
  sales: { items: Sale[]; total: number };
  alerts: { items: LowStockItem[]; total: number };
  predictions: { items: Prediction[]; total: number; urgentCount: number };
}

const localDayKey = (date: Date): string => {
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${date.getFullYear()}-${month}-${day}`;
};

const loadDashboard = async (): Promise<DashboardData> => {
  const start = new Date();
  start.setDate(start.getDate() - 6);
  start.setHours(0, 0, 0, 0);

  const [products, sales, alerts, predictions] = await Promise.all([
    api.listProducts({ limit: 100 }),
    api.listSales({ limit: 100, startDate: start.toISOString() }),
    api.lowStock(),
    api.predictions(),
  ]);

  return { products, sales, alerts, predictions };
};

export const DashboardPage = () => {
  const { user, business } = useAuth();
  const [data, setData] = useState<DashboardData | null>(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      setData(await loadDashboard());
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Dashboard data could not be loaded.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    const reload = () => void load();
    window.addEventListener('sales:synced', reload);
    return () => window.removeEventListener('sales:synced', reload);
  }, [load]);

  const metrics = useMemo(() => {
    if (!data) {
      return null;
    }

    const units = data.products.items.reduce((sum, product) => sum + product.currentQuantity, 0);
    const costValue = data.products.items.reduce(
      (sum, product) => sum + product.currentQuantity * product.purchasePrice,
      0
    );
    const retailValue = data.products.items.reduce(
      (sum, product) => sum + product.currentQuantity * product.sellingPrice,
      0
    );

    const todayKey = localDayKey(new Date());
    const todaySales = data.sales.items.filter(
      (sale) => localDayKey(new Date(sale.timestamp)) === todayKey
    );
    const todayRevenue = todaySales.reduce((sum, sale) => sum + sale.totalAmount, 0);

    const weekRevenue = data.sales.items.reduce((sum, sale) => sum + sale.totalAmount, 0);
    const averageOrder = data.sales.items.length
      ? weekRevenue / data.sales.items.length
      : 0;

    const days = Array.from({ length: 7 }, (_, index) => {
      const date = new Date();
      date.setDate(date.getDate() - (6 - index));
      const key = localDayKey(date);
      const daySales = data.sales.items.filter(
        (sale) => localDayKey(new Date(sale.timestamp)) === key
      );
      return {
        day: date.toLocaleDateString('en-IN', { weekday: 'short' }),
        revenue: Math.round(daySales.reduce((sum, sale) => sum + sale.totalAmount, 0)),
        orders: daySales.length,
      };
    });

    const itemTotals = new Map<string, { name: string; units: number; revenue: number }>();
    data.sales.items.forEach((sale) => {
      sale.items.forEach((item) => {
        const current = itemTotals.get(item.productId) ?? {
          name: item.productName,
          units: 0,
          revenue: 0,
        };
        current.units += item.quantity;
        current.revenue += item.total;
        itemTotals.set(item.productId, current);
      });
    });

    const topSellers = [...itemTotals.values()].sort((a, b) => b.units - a.units).slice(0, 5);

    const restock = data.predictions.items
      .filter(
        (prediction) =>
          prediction.currentQuantity <= prediction.reorderPoint ||
          prediction.isBelowThreshold
      )
      .sort((a, b) => a.currentQuantity - b.currentQuantity)
      .slice(0, 5);

    return {
      units,
      costValue,
      retailValue,
      todayRevenue,
      todayOrders: todaySales.length,
      weekRevenue,
      averageOrder,
      days,
      topSellers,
      restock,
    };
  }, [data]);

  if (loading && !data) {
    return <Spinner label="Reading the ledger…" />;
  }

  if (error && !data) {
    return (
      <div className="stack">
        <ErrorNote>{error}</ErrorNote>
        <button type="button" className="btn btn-ghost" onClick={() => void load()}>
          Retry
        </button>
      </div>
    );
  }

  if (!data || !metrics) {
    return null;
  }

  const outOfStock = data.alerts.items.filter((item) => item.isOutOfStock).length;
  const bestDay = [...metrics.days].sort((a, b) => b.revenue - a.revenue)[0];

  return (
    <div className="stack">
      <PageHeader
        eyebrow={`${business?.name ?? 'Workspace'} · live ledger`}
        title={`Good ${new Date().getHours() < 12 ? 'morning' : new Date().getHours() < 17 ? 'afternoon' : 'evening'}, ${user?.name?.split(' ')[0] ?? 'there'}.`}
        description="What is on the shelf, what sold, and what needs reordering — computed from this business's records."
        actions={
          <button type="button" className="btn btn-ghost" onClick={() => void load()} disabled={loading}>
            <Icon name="history" /> Refresh
          </button>
        }
      />

      {error ? <ErrorNote>{error}</ErrorNote> : null}

      <section className="stats-grid">
        <Stat
          label="Stock on hand"
          value={`${metrics.units.toLocaleString('en-IN')} units`}
          hint={`${data.products.total.toLocaleString('en-IN')} SKUs tracked`}
        />
        <Stat
          label="Inventory at cost"
          value={money(metrics.costValue)}
          hint={`Retail value ${money(metrics.retailValue)}`}
          tone="accent"
        />
        <Stat
          label="Revenue today"
          value={money(metrics.todayRevenue)}
          hint={`${metrics.todayOrders} order${metrics.todayOrders === 1 ? '' : 's'} recorded`}
          tone="good"
        />
        <Stat
          label="Needs attention"
          value={`${data.alerts.total} low`}
          hint={`${outOfStock} out of stock · ${data.predictions.urgentCount} urgent reorders`}
          tone={data.alerts.total > 0 ? 'warn' : 'default'}
        />
      </section>

      <section className="dashboard-grid">
        <article className="panel panel-chart">
          <div className="panel-head">
            <div>
              <p className="eyebrow">Last 7 days</p>
              <h2>Revenue rhythm</h2>
            </div>
            <span className="panel-tag">{money(metrics.weekRevenue)}</span>
          </div>
          <div className="chart-wrap">
            <ResponsiveContainer width="100%" height={280}>
              <AreaChart data={metrics.days} margin={{ top: 12, right: 8, left: -12, bottom: 0 }}>
                <defs>
                  <linearGradient id="revenueFill" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor="#e4572e" stopOpacity={0.34} />
                    <stop offset="100%" stopColor="#e4572e" stopOpacity={0.02} />
                  </linearGradient>
                </defs>
                <CartesianGrid stroke="#d6cdb8" strokeDasharray="2 6" vertical={false} />
                <XAxis dataKey="day" tickLine={false} axisLine={false} tick={{ fill: '#6b6353', fontSize: 12 }} />
                <YAxis tickLine={false} axisLine={false} tick={{ fill: '#6b6353', fontSize: 12 }} width={56} />
                <Tooltip
                  cursor={{ stroke: '#161a1d', strokeWidth: 1 }}
                  contentStyle={{
                    background: '#fbf8f1',
                    border: '1px solid #161a1d',
                    borderRadius: 2,
                    boxShadow: '4px 4px 0 rgba(22,26,29,.15)',
                  }}
                  formatter={(value) => [money(Number(value)), 'Revenue']}
                />
                <Area
                  type="monotone"
                  dataKey="revenue"
                  stroke="#e4572e"
                  strokeWidth={2.4}
                  fill="url(#revenueFill)"
                  activeDot={{ r: 5, fill: '#161a1d' }}
                />
              </AreaChart>
            </ResponsiveContainer>
          </div>
          <footer className="panel-foot">
            <span>
              Average order <strong>{money(metrics.averageOrder)}</strong>
            </span>
            <span>
              Peak day <strong>{bestDay?.day ?? '—'}</strong>
            </span>
            <span className="muted">Based on the latest {data.sales.items.length} sales in the window</span>
          </footer>
        </article>

        <article className="panel">
          <div className="panel-head">
            <div>
              <p className="eyebrow">Movement</p>
              <h2>Top sellers</h2>
            </div>
            <Link className="text-link" to="/sales">
              Open POS <Icon name="arrowRight" size={14} />
            </Link>
          </div>
          {metrics.topSellers.length === 0 ? (
            <EmptyState
              title="No sales in this window"
              body="Record a sale from the POS and the ranking will fill from real transactions."
              action={
                <Link className="btn btn-primary" to="/sales">
                  Record a sale
                </Link>
              }
            />
          ) : (
            <ol className="rank-list">
              {metrics.topSellers.map((seller, index) => (
                <li key={seller.name}>
                  <span className="rank-index">{String(index + 1).padStart(2, '0')}</span>
                  <div className="rank-body">
                    <strong>{seller.name}</strong>
                    <span>{seller.units} units sold</span>
                  </div>
                  <span className="rank-value">{money(seller.revenue)}</span>
                </li>
              ))}
            </ol>
          )}
        </article>
      </section>

      <section className="dashboard-grid">
        <article className="panel">
          <div className="panel-head">
            <div>
              <p className="eyebrow">Reorder advice</p>
              <h2>Restock next</h2>
            </div>
            <Link className="text-link" to="/forecast">
              Full forecast <Icon name="arrowRight" size={14} />
            </Link>
          </div>
          {metrics.restock.length === 0 ? (
            <EmptyState
              title="Stock is above reorder points"
              body="Forecasts refresh as sales are recorded. Nothing needs restocking right now."
            />
          ) : (
            <ul className="suggest-list">
              {metrics.restock.map((prediction) => (
                <li key={prediction.productId}>
                  <div>
                    <strong>{prediction.productName}</strong>
                    <span>
                      {prediction.currentQuantity} on hand · reorder at {prediction.reorderPoint}
                    </span>
                  </div>
                  <span className="order-chip">+{prediction.suggestedOrderQuantity}</span>
                </li>
              ))}
            </ul>
          )}
        </article>

        <article className="panel">
          <div className="panel-head">
            <div>
              <p className="eyebrow">Audit trail</p>
              <h2>Recent sales</h2>
            </div>
            <Link className="text-link" to="/movements">
              Movements <Icon name="arrowRight" size={14} />
            </Link>
          </div>
          {data.sales.items.length === 0 ? (
            <EmptyState title="No sales yet" body="Completed sales will appear here with their totals." />
          ) : (
            <ul className="sale-list">
              {data.sales.items.slice(0, 5).map((sale) => (
                <li key={sale.id}>
                  <div>
                    <strong>{money(sale.totalAmount)}</strong>
                    <span>
                      {sale.items.reduce((sum, item) => sum + item.quantity, 0)} units ·{' '}
                      {sale.paymentMethod ?? 'cash'}
                    </span>
                  </div>
                  <span className="muted">{formatDate(sale.timestamp)}</span>
                </li>
              ))}
            </ul>
          )}
        </article>
      </section>
    </div>
  );
};
