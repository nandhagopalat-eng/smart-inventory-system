# Stockroom — Smart Inventory System

A full-stack inventory management system for small businesses. Stockroom combines
inventory tracking, point-of-sale billing, an auditable stock ledger, low-stock
alerts, explainable reorder forecasting, barcode scanning, and offline sales in a
single multi-tenant web application.

Built as a full-stack development (FSD-2) course project with a React frontend and
an Express + MongoDB backend.

---

## Features

### Authentication and access control
- Business registration: the first user becomes the administrator of a new,
  isolated business workspace.
- Passwords are hashed with bcrypt; sessions use signed JWT access tokens.
- Two roles:
  - **Admin** — manage products, record stock movements, manage team members.
  - **Staff** — view the dashboard, inventory, alerts and forecasts, and record sales.
- Role checks are enforced by API middleware, not just hidden in the UI.

### Inventory management
- Create, edit, search, filter and delete products.
- Product record: name, SKU, barcode, category, purchase price, selling price,
  current quantity, minimum stock threshold, and supplier lead time.
- Search by name, SKU or barcode; filter by category; paginated results.
- SKU and barcode are unique within a business (not globally).
- Selling price cannot be set below purchase price.

### Sales and point of sale
- Multi-item cart with cash, card, transfer or other payment methods.
- Prices, product names and totals are calculated on the server from the database,
  never trusted from the client.
- Stock is decremented with a guarded atomic write, so concurrent sales cannot
  oversell.
- Every sale creates an `out` stock movement per product with reason `sale`.
- Sale history is permanent, even if a product is later edited or deleted.

### Auditable stock movements
- Record stock **in** (purchase, return, transfer) or **out** (waste, adjustment)
  with a quantity, reason and optional note.
- Each movement stores the product, direction, quantity, reason, note, the user who
  recorded it, and a timestamp.
- If the audit record cannot be written, the stock change is rolled back.
- Sale movements cannot be created manually; they only come from the sales endpoint,
  so stock is never double-counted.

### Alerts and restocking
- Low-stock list flags products at or below their minimum threshold and identifies
  items that are completely out of stock.
- Admins can restock directly from the alert list; this creates a recorded
  `purchase` movement.

### Explainable reorder forecasting
For each product, using the last 30 days of recorded sales:

```
average daily demand = units sold / days that had sales
safety stock         = max(1, round(average daily demand x 0.5))
reorder point        = round(average daily demand x supplier lead time + safety stock)
suggested order      = max(1, reorder point - current quantity + safety stock)
urgency              = HIGH when quantity <= minimum threshold, otherwise NORMAL
```

The interface shows the inputs and the result, so every recommendation can be
explained rather than treated as a black box. A single-product endpoint also returns
simple moving average and exponential smoothing values.

### Barcode scanning
- Camera-based scanning with ZXing and manual barcode entry.
- A scanned code is used as the inventory search term, both in Inventory and POS.
- If the camera is unavailable or permission is denied, a clear error is shown and
  manual search continues to work.

### Offline support and PWA
- The last successful product list is cached in IndexedDB per business.
- Sales recorded while offline are queued in IndexedDB instead of being lost.
- The header shows connectivity and the number of queued sales.
- When the browser comes back online, queued sales are sent automatically and each
  one is removed only after the API accepts it. The dashboard and sale history
  refresh after a successful sync.
- A service worker and web manifest are generated at build time, making the app
  installable and its static assets available offline.

### Dashboard
- Stock on hand, inventory value at cost and at retail.
- Revenue today, order count and average order value.
- Seven-day revenue area chart.
- Top sellers by units.
- Restock suggestions and recent sales.
- All metrics are computed from live database records; no hardcoded demo numbers.

---

## Tech stack

| Layer | Technology |
|---|---|
| Frontend | React 19, TypeScript, Vite, React Router, Recharts |
| Styling | Plain CSS design system, responsive layout |
| Barcode | `@zxing/browser` |
| Offline storage | IndexedDB via `idb` |
| PWA | `vite-plugin-pwa` (Workbox service worker + manifest) |
| Backend | Node.js, Express 5, TypeScript |
| Database | MongoDB with Mongoose |
| Authentication | JWT (Bearer) and bcryptjs |
| Tests | Node test runner via `tsx --test`, against a real MongoDB test database |

---

## Architecture

Stockroom is a modular monolith split into two deployable applications:

```
Browser (React SPA + service worker)
        |
        |  JSON over HTTP, Bearer JWT
        v
Express API  --->  MongoDB
   |
   +-- auth middleware (authenticate / authorize)
   +-- controllers (business logic and validation)
   +-- Mongoose models (schema validation and indexes)
```

The frontend never supplies its own `businessId`. The API takes it from the verified
JWT and adds it to every query, which is what keeps business data isolated.

### Project structure

```
smart-inventory-system/
├── backend/
│   ├── src/
│   │   ├── config/          JWT configuration
│   │   ├── controllers/     auth, users, inventory, sales, movements, alerts, predictions
│   │   ├── middleware/      authenticate and authorize middleware
│   │   ├── models/          Business, User, Product, Sale, StockMovement
│   │   ├── routes/          one router per feature
│   │   ├── types/           authenticated request typing
│   │   ├── utils/           date helpers and safe user serialization
│   │   └── server.ts        app setup, routes, database connection, error handling
│   ├── test/                API smoke, auth and data integration tests
│   └── .env.example
└── frontend/
    ├── public/
    ├── src/
    │   ├── api/             typed API client and shared types
    │   ├── components/      layout, UI primitives, icons, scanner, restock modal
    │   ├── context/         authentication context
    │   ├── pages/           auth, dashboard, inventory, POS, alerts,
    │   │                    forecast, movements, team
    │   ├── services/        IndexedDB cache and offline sale queue
    │   └── App.tsx          routes and role-protected layout
    └── vite.config.ts       dev proxy and PWA configuration
```

### Data model

| Collection | Purpose |
|---|---|
| `Business` | Tenant workspace; every other record belongs to one business |
| `User` | Login identity, hashed password, role, business reference |
| `Product` | Catalog item, prices, stock level, threshold, supplier lead time |
| `Sale` | Immutable sale header with line items, payment method and total |
| `StockMovement` | Audit record for every stock change |

Indexes cover tenant-scoped listing and reporting, including:
`{ businessId, sku }` and `{ businessId, barcode }` (unique),
`{ businessId, category }`, low-stock queries,
`{ businessId, timestamp }` for sales and movements, and
`{ businessId, productId, timestamp }` for per-product movement history.

---

## Getting started

### Prerequisites

- Node.js 20 or newer
- MongoDB running locally, or a MongoDB Atlas connection string
- Git

### 1. Clone the repository

```bash
git clone https://github.com/nandhagopalat-eng/smart-inventory-system.git
cd smart-inventory-system
```

### 2. Start the backend

```bash
cd backend
npm install
cp .env.example .env
```

Edit `backend/.env` and set a real `JWT_SECRET` (32 or more random characters).
The server refuses to start without it.

```bash
npm run dev
```

Expected output:

```
MongoDB connected successfully
Server running at http://localhost:5000
Health check: http://localhost:5000/api/health
```

### 3. Start the frontend

In a second terminal:

```bash
cd frontend
npm install
npm run dev
```

Open `http://localhost:5173`. During development, Vite proxies `/api` requests to
`http://localhost:5000`, so no frontend environment file is required.

### 4. Create your workspace

1. Open `/register` and create a business with your name, email and password.
2. You are signed in as the administrator.
3. Add products from **Inventory**.
4. Record a sale from **Sell / POS**.
5. The dashboard, alerts, forecast and movements update from the new records.
6. Add staff accounts from **Team** and sign in as one to verify permissions.

---

## Environment variables

Backend (`backend/.env`):

| Variable | Required | Description |
|---|---|---|
| `PORT` | No | API port, defaults to `5000` |
| `MONGODB_URI` | No | MongoDB URI, defaults to `mongodb://127.0.0.1:27017/smart_inventory` |
| `CORS_ORIGIN` | No | Comma-separated allowed origins, defaults to `http://localhost:5173,http://localhost:5174` |
| `JWT_SECRET` | Yes | Signing secret for access tokens; server will not start without it |
| `JWT_EXPIRES_IN` | No | Token lifetime, for example `24h` or `7d` |
| `NODE_ENV` | No | `development` or `production` |

Frontend (optional, `frontend/.env`):

| Variable | Description |
|---|---|
| `VITE_API_URL` | API origin when frontend and backend are on different origins. Leave empty in development to use the Vite proxy. |

Never commit a real `.env` file. Only `.env.example` belongs in the repository.

---

## API reference

All protected endpoints expect `Authorization: Bearer <token>`. Responses use a
consistent envelope: `{ "status": "success", "message": "...", "data": ... }`.

| Method | Endpoint | Access | Purpose |
|---|---|---|---|
| POST | `/api/auth/register` | Public | Create a business and its admin user |
| POST | `/api/auth/login` | Public | Authenticate and receive a JWT |
| GET | `/api/auth/me` | Authenticated | Current user and business |
| GET | `/api/inventory` | Authenticated | List, search, filter and paginate products |
| GET | `/api/inventory/:id` | Authenticated | Product details |
| POST | `/api/inventory` | Admin | Create a product |
| PUT | `/api/inventory/:id` | Admin | Update product details |
| DELETE | `/api/inventory/:id` | Admin | Delete a product |
| POST | `/api/sales/record` | Authenticated | Record a multi-item sale and update stock |
| GET | `/api/sales` | Authenticated | Sale history with optional date range |
| GET | `/api/stock-movements` | Authenticated | Audit history, optionally per product |
| POST | `/api/stock-movements` | Admin | Record a stock in/out movement |
| GET | `/api/alerts/low-stock` | Authenticated | Products at or below threshold |
| GET | `/api/predictions` | Authenticated | Reorder points for all products |
| GET | `/api/predictions/reorder-point?productId=` | Authenticated | Reorder point for one product |
| GET | `/api/users` | Admin | List users in the business |
| POST | `/api/users` | Admin | Add a user |
| PATCH | `/api/users/:id/role` | Admin | Change a user's role |
| GET | `/api/health` | Public | Health check |

---

## Testing and builds

Backend:

```bash
cd backend
npx tsc --noEmit      # type-check
npm test              # integration tests (requires MongoDB)
npm run build         # compile to dist/
npm start             # run the compiled server
```

The backend tests use the Node test runner through `tsx`. They exercise real HTTP
routes against a real MongoDB test database, including authentication, business data
isolation, inventory validation, sales stock updates, stock movements, alerts and
forecasting.

Frontend:

```bash
cd frontend
npm run build         # type-check, production build and PWA assets
npm run preview       # serve the production build locally
```

The service worker and manifest are produced during `npm run build`, so offline
behavior should be tested against the production build rather than the dev server.

---

## Engineering decisions

- **Tenant isolation from the token.** `businessId` comes from the verified JWT and
  is added to every query. A client cannot request another business's data.
- **Server-authoritative pricing.** Sale totals use the current database price, so a
  tampered request cannot change what is charged.
- **No silent stock changes.** Stock is only changed through the sales endpoint or
  the stock movement endpoint, and both write an audit record. A failed audit write
  reverts the quantity change.
- **Atomic stock decrements.** Sales use a conditional update
  (`currentQuantity >= requested`) instead of read-then-write.
- **Transactions with a fallback.** Sales run in a MongoDB transaction when the
  deployment supports it. On a standalone MongoDB server, a compensating rollback
  restores stock if part of the sale fails.
- **Validation at the boundary.** Controllers validate request shape, and Mongoose
  schemas enforce types, ranges and cross-field rules. Duplicate SKU or barcode
  returns HTTP 409.
- **Centralized errors.** Async failures flow to one error handler with a consistent
  response shape; unknown routes return a JSON 404.

---

## Known limitations

- Forecasting averages demand over days that had sales, not calendar days. A product
  sold rarely can have an overstated daily average; this is a known refinement.
- The stated targets of 100,000 products and 1,000,000 daily transactions are design
  goals, not measured capacity. The dashboard currently loads up to 100 products and
  100 sales client-side and is intended for small-business volumes.
- Real transactions require a MongoDB replica set. Standalone MongoDB uses the
  compensating fallback described above.
- JWTs are stored in `localStorage` and there is no refresh token or server-side
  revocation. This is acceptable for a course project but would be revisited for
  production.
- Automated tests cover the backend API. The frontend was verified manually in a
  browser across authentication, role permissions, POS, offline queueing and the
  stock movement flows.
- The production frontend bundle is approximately 1.2 MB because of the charting and
  barcode libraries; route-level code splitting would reduce the initial load.

---

## Author

**Nandhu**
GitHub: [nandhagopalat-eng](https://github.com/nandhagopalat-eng)