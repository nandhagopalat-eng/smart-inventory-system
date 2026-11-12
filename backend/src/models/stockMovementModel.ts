/**
 * Smart Inventory System - Stock Movement Model
 * 
 * Mongoose schema for tracking stock movements (in/out).
 * Maintains a history of all inventory changes.
 * 
 * Problem solved: Provides a complete audit trail of every
 * stock quantity change, essential for accountability,
 * loss prevention, and reconciliation.
 * 
 * How it works:
 * - movementType: 'in' (stock arrival) or 'out' (sale/issue)
 * - quantityChange: positive number (absolute change)
 * - reason: categorization (sale, adjustment, return, transfer, waste)
 * - businessId + productId: scoping and query filtering
 * - timestamp: when the movement occurred
 * - Methods: calculate remaining stock after movement
 * 
 * Why chosen over alternatives:
 * - Separate collection from products keeps inventory current
 * *   quantity separate from historical movements
 * - Allows querying stock history per product per business
 * - Movement reasons enable reporting and analysis
 * - Schema validation ensures data consistency
 */
import { Schema, model, type Model } from 'mongoose';

/**
 * Interface for stock movement document fields.
 */
interface IStockMovement {
  businessId: string;
  productId: string;
  movementType: 'in' | 'out';
  quantityChange: number;
  reason: 'sale' | 'adjustment' | 'return' | 'transfer' | 'waste' | 'purchase';
  timestamp: Date;
  notedBy?: string; // User ID who recorded the movement
  note?: string;
  createdAt?: Date;
  updatedAt?: Date;
}

/** Instance methods available on a hydrated stock movement document. */
interface StockMovementMethods {
  getSummary(): string;
}

/** Static methods available on the StockMovement model. */
interface StockMovementStatics {
  findByProductWithPagination(
    businessId: string,
    productId?: string,
    page?: number,
    limit?: number
  ): Promise<{ items: unknown[]; total: number; page: number; pages: number }>;
  findByBusinessWithPagination(
    businessId: string,
    page?: number,
    limit?: number
  ): Promise<{ items: unknown[]; total: number; page: number; pages: number }>;
}

type StockMovementModel = Model<IStockMovement, {}, StockMovementMethods> &
  StockMovementStatics;

/**
 * Stock Movement Schema — defines fields and validators.
 * 
 * Field explanations:
 * - businessId: Scoping to business owner (required)
 * - productId: Link to product (required, references Product)
 * - movementType: 'in' for stock arrival, 'out' for reduction (required)
 * - quantityChange: absolute quantity being moved (required, positive)
 * - reason: categorization for reporting (required, enum-like)
 * - timestamp: automatic via timestamps option
 * - notedBy: optional — who recorded this movement (user ID)
 */
const stockMovementSchema = new Schema<
  IStockMovement,
  StockMovementModel,
  StockMovementMethods
>(
  {
    businessId: {
      type: String,
      required: [true, 'Business ID is required'],
    },
    productId: {
      type: String,
      required: [true, 'Product ID is required'],
    },
    movementType: {
      type: String,
      required: true,
      enum: {
        values: ['in', 'out'],
        message: 'Movement type must be either "in" or "out"',
      },
    },
    quantityChange: {
      type: Number,
      required: [true, 'Quantity change is required'],
      min: [1, 'Quantity change must be at least 1'],
    },
    reason: {
      type: String,
      required: [true, 'Reason is required'],
      enum: {
        values: ['sale', 'adjustment', 'return', 'transfer', 'waste', 'purchase'],
        message:
          'Reason must be one of: sale, adjustment, return, transfer, waste, purchase',
      },
    },
    timestamp: {
      type: Date,
      required: true,
      default: Date.now,
    },
    notedBy: {
      type: String,
      // Reference to user who recorded the movement
    },
    note: {
      type: String,
      trim: true,
      maxlength: [250, 'Note cannot exceed 250 characters'],
    },
  },
  { timestamps: true }
);

/** --- Schema Methods --- */

/**
 * Get a summary of this movement for display purposes.
 * 
 * @returns Human-readable movement summary
 */
stockMovementSchema.methods.getSummary = function (this: IStockMovement): string {
  const direction = this.movementType === 'in' ? 'Added' : 'Removed';
  return `${direction} ${this.quantityChange} ${this.movementType} stock. Reason: ${this.reason}`;
};

/** --- Static Methods --- */

/**
 * Find stock movements by product and business with pagination.
 * 
 * @param businessId - Scoping business ID
 * @param productId - Product ID to filter by (optional)
 * @param page - Page number (1-based)
 * @param limit - Items per page
 * @returns Paginated movements
 */
stockMovementSchema.statics.findByProductWithPagination = async function (
  businessId: string,
  productId?: string,
  page = 1,
  limit = 20
) {
  const query: { businessId: string; productId?: string } = { businessId };
  if (productId) {
    query.productId = productId;
  }

  const skip = (page - 1) * limit;

  const [items, total] = await Promise.all([
    this.find(query)
      .sort({ timestamp: -1 }) // Most recent first
      .skip(skip)
      .limit(limit)
      .lean(),
    this.countDocuments(query),
  ]);

  return {
    items,
    total,
    page,
    pages: Math.ceil(total / limit),
  };
};

/**
 * Get stock movement history for a business (all products or filtered).
 * 
 * @param businessId - Scoping business ID
 * @param page - Page number
 * @param limit - Items per page
 * @returns Paginated movements
 */
stockMovementSchema.statics.findByBusinessWithPagination = async function (
  businessId: string,
  page = 1,
  limit = 20
) {
  const query = { businessId };
  const skip = (page - 1) * limit;

  const [items, total] = await Promise.all([
    this.find(query)
      .sort({ timestamp: -1 })
      .skip(skip)
      .limit(limit)
      .lean(),
    this.countDocuments(query),
  ]);

  return {
    items,
    total,
    page,
    pages: Math.ceil(total / limit),
  };
};

/** --- Export Model --- */

stockMovementSchema.index({ businessId: 1, timestamp: -1 });
stockMovementSchema.index({ businessId: 1, productId: 1, timestamp: -1 });

export type { IStockMovement };

export default model<IStockMovement, StockMovementModel>(
  'StockMovement',
  stockMovementSchema
);