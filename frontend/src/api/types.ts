export type UserRole = 'admin' | 'staff';

export interface User {
  id: string;
  name: string;
  email: string;
  role: UserRole;
  businessId: string;
}

export interface Business {
  id: string;
  name: string;
}

export interface Product {
  id: string;
  name: string;
  sku: string;
  barcode: string;
  category: string;
  purchasePrice: number;
  sellingPrice: number;
  currentQuantity: number;
  minimumStockThreshold: number;
  supplierLeadTime: number;
  businessId: string;
  createdAt?: string;
  updatedAt?: string;
}

export interface ProductInput {
  name: string;
  sku: string;
  barcode: string;
  category: string;
  purchasePrice: number;
  sellingPrice: number;
  currentQuantity?: number;
  minimumStockThreshold: number;
  supplierLeadTime: number;
}

export interface Paginated<T> {
  items: T[];
  total: number;
  page: number;
  pages: number;
}

export interface SaleItem {
  productId: string;
  productName: string;
  quantity: number;
  unitPrice: number;
  total: number;
}

export interface Sale {
  id: string;
  businessId: string;
  items: SaleItem[];
  totalAmount: number;
  paymentMethod?: 'cash' | 'card' | 'transfer' | 'other';
  notes?: string;
  timestamp: string;
}

export interface SaleInput {
  items: Array<{ productId: string; quantity: number }>;
  paymentMethod: 'cash' | 'card' | 'transfer' | 'other';
  notes?: string;
}

export type MovementReason =
  | 'sale'
  | 'adjustment'
  | 'return'
  | 'transfer'
  | 'waste'
  | 'purchase';

export interface StockMovement {
  id: string;
  productId: string;
  movementType: 'in' | 'out';
  quantityChange: number;
  reason: MovementReason;
  note?: string;
  notedBy?: string;
  timestamp: string;
}

export interface LowStockItem {
  id: string;
  name: string;
  sku: string;
  barcode: string;
  currentQuantity: number;
  minimumStockThreshold: number;
  stockShortfall: number;
  isLowStock: boolean;
  isOutOfStock: boolean;
  category: string;
}

export interface Prediction {
  productId: string;
  productName: string;
  sku: string;
  currentQuantity: number;
  minimumStockThreshold: number;
  supplierLeadTime: number;
  averageDailyDemand: number;
  leadTimeDays: number;
  safetyStock: number;
  reorderPoint: number;
  suggestedOrderQuantity: number;
  isBelowThreshold: boolean;
  urgency: 'HIGH' | 'NORMAL';
}

export interface ApiEnvelope<T> {
  status: 'success' | 'error';
  message: string;
  data: T;
}
