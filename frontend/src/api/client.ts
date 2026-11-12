import type {
  ApiEnvelope,
  Business,
  LowStockItem,
  Paginated,
  Prediction,
  Product,
  ProductInput,
  Sale,
  SaleInput,
  StockMovement,
  User,
  UserRole,
} from './types';

const TOKEN_KEY = 'sis.token';
const API_BASE = import.meta.env.VITE_API_URL ?? '';

export class ApiError extends Error {
  status: number;

  constructor(message: string, status: number) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
  }
}

export const getToken = (): string | null => localStorage.getItem(TOKEN_KEY);

export const setToken = (token: string): void => localStorage.setItem(TOKEN_KEY, token);

export const clearToken = (): void => localStorage.removeItem(TOKEN_KEY);

const buildQuery = (params: Record<string, string | number | undefined>): string => {
  const search = new URLSearchParams();
  Object.entries(params).forEach(([key, value]) => {
    if (value !== undefined && value !== '') {
      search.set(key, String(value));
    }
  });
  const query = search.toString();
  return query ? `?${query}` : '';
};

async function request<T>(
  path: string,
  options: RequestInit = {},
  authenticated = true
): Promise<T> {
  const headers = new Headers(options.headers);
  if (options.body !== undefined) {
    headers.set('Content-Type', 'application/json');
  }

  if (authenticated) {
    const token = getToken();
    if (token) {
      headers.set('Authorization', `Bearer ${token}`);
    }
  }

  let response: Response;
  try {
    response = await fetch(`${API_BASE}${path}`, { ...options, headers });
  } catch {
    throw new ApiError('Network unavailable. Check your connection.', 0);
  }

  let body: ApiEnvelope<T> | null = null;
  try {
    body = (await response.json()) as ApiEnvelope<T>;
  } catch {
    body = null;
  }

  if (!response.ok) {
    if (response.status === 401 && authenticated) {
      clearToken();
      window.dispatchEvent(new Event('auth:logout'));
    }
    throw new ApiError(body?.message || `Request failed (${response.status})`, response.status);
  }

  if (!body) {
    throw new ApiError('The server returned an invalid response.', response.status);
  }

  return body.data;
}

interface AuthPayload {
  token: string;
  tokenType: string;
  expiresIn: string | number;
  user: User;
}

interface MePayload {
  user: User;
  business: Business | null;
}

interface ProductListParams {
  page?: number;
  limit?: number;
  search?: string;
  category?: string;
}

interface SaleListParams {
  page?: number;
  limit?: number;
  startDate?: string;
  endDate?: string;
}

interface MovementListParams {
  page?: number;
  limit?: number;
  productId?: string;
}

interface MovementInput {
  productId: string;
  movementType: 'in' | 'out';
  quantityChange: number;
  reason: Exclude<StockMovement['reason'], 'sale'>;
  note?: string;
}

export const api = {
  register: (payload: {
    name: string;
    email: string;
    password: string;
    businessName: string;
  }) =>
    request<{ user: User; business: Business }>(
      '/api/auth/register',
      { method: 'POST', body: JSON.stringify(payload) },
      false
    ),

  login: (payload: { email: string; password: string }) =>
    request<AuthPayload>(
      '/api/auth/login',
      { method: 'POST', body: JSON.stringify(payload) },
      false
    ),

  me: () => request<MePayload>('/api/auth/me'),

  listProducts: (params: ProductListParams = {}) =>
    request<Paginated<Product>>(`/api/inventory${buildQuery({ ...params })}`),

  getProduct: (id: string) => request<Product>(`/api/inventory/${id}`),

  createProduct: (payload: ProductInput) =>
    request<Product>('/api/inventory', { method: 'POST', body: JSON.stringify(payload) }),

  updateProduct: (id: string, payload: Partial<ProductInput>) =>
    request<Product>(`/api/inventory/${id}`, {
      method: 'PUT',
      body: JSON.stringify(payload),
    }),

  deleteProduct: (id: string) =>
    request<Record<string, never>>(`/api/inventory/${id}`, { method: 'DELETE' }),

  recordSale: (payload: SaleInput) =>
    request<{ sale: Sale; products: Array<{ id: string; currentQuantity: number }> }>(
      '/api/sales/record',
      { method: 'POST', body: JSON.stringify(payload) }
    ),

  listSales: (params: SaleListParams = {}) =>
    request<Paginated<Sale>>(`/api/sales${buildQuery({ ...params })}`),

  listMovements: (params: MovementListParams = {}) =>
    request<Paginated<StockMovement>>(`/api/stock-movements${buildQuery({ ...params })}`),

  createMovement: (payload: MovementInput) =>
    request<{ movement: StockMovement; product: Product }>('/api/stock-movements', {
      method: 'POST',
      body: JSON.stringify(payload),
    }),

  lowStock: () => request<{ items: LowStockItem[]; total: number }>('/api/alerts/low-stock'),

  predictions: () =>
    request<{ items: Prediction[]; total: number; urgentCount: number }>('/api/predictions'),

  listUsers: () => request<{ items: User[]; total: number }>('/api/users'),

  createUser: async (payload: { name: string; email: string; password: string; role: UserRole }) =>
    (await request<{ user: User }>('/api/users', { method: 'POST', body: JSON.stringify(payload) }))
      .user,

  updateUserRole: async (id: string, role: UserRole) =>
    (
      await request<{ user: User }>(`/api/users/${id}/role`, {
        method: 'PATCH',
        body: JSON.stringify({ role }),
      })
    ).user,
};
