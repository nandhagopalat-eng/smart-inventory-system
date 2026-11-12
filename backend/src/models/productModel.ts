/**
 * Smart Inventory System - Product Model
 * 
 * Mongoose schema for products with validation,
 * indexes, and business logic hooks.
 * 
 * Problem solved: Defines the structure and validation rules
 * for inventory items, ensuring data integrity across the application.
 * 
 * How it works:
 * - Schema defines field types, required status, and validators
 * - Methods add custom instance methods (e.g., isLowStock())
 * - Static methods add custom class methods (e.g., searchByName())
 * - Indexes optimize common queries (barcode lookup, category filter)
 * 
 * Why chosen over alternatives:
 * - Mongoose schema provides compile-time-like validation for MongoDB documents
 * - Eliminates invalid data at the database level
 * - Indexes improve query performance for inventory lookups
 * - Methods keep business logic close to the data
 */
import { Schema, model, type Model } from 'mongoose';

/**
 * Interface for product document fields.
 * Defines the type shape for TypeScript usage.
 */
interface IProduct {
  name: string;
  sku: string;
  barcode: string;
  category: string;
  purchasePrice: number;
  sellingPrice: number;
  currentQuantity: number;
  minimumStockThreshold: number;
  supplierLeadTime: number; // in days
  businessId: string; // Ownership scoping
  createdAt?: Date;
  updatedAt?: Date;
}

/** Instance methods available on a hydrated product document. */
interface ProductMethods {
  isLowStock(): boolean;
  getStockShortfall(): number;
}

/** Static methods available on the Product model. */
interface ProductStatics {
  findByBusinessWithPagination(
    businessId: string,
    page?: number,
    limit?: number
  ): Promise<{ items: unknown[]; total: number; page: number; pages: number }>;
  searchByNameOrSKU(businessId: string, query: string): Promise<unknown[]>;
}

type ProductModel = Model<IProduct, {}, ProductMethods> & ProductStatics;

/**
 * Product Schema — defines fields, types, and validators.
 * 
 * Field explanations:
 * - name: Product name (required, trimmed, min length 3)
 * - sku: Stock Keeping Unit (required, unique within business)
 * - barcode: ISBN-like unique identifier (required, unique within business)
 * - category: Product category (optional, for filtering)
 * - purchasePrice: Cost to acquire (required, min 0)
 * - sellingPrice: Price to sell (required, min 0, must be > purchasePrice)
 * - currentQuantity: On-hand stock (required, min 0)
 * - minimumStockThreshold: Alert trigger level (required, min 0)
 * - supplierLeadTime: Days to replenish (required, min 1)
 * - businessId: Scoping to business owner (required)
 */
const productSchema = new Schema<IProduct, ProductModel, ProductMethods>(
  {
    name: {
      type: String,
      required: [true, 'Product name is required'],
      trim: true,
      minlength: [3, 'Product name must be at least 3 characters'],
      maxlength: [100, 'Product name cannot exceed 100 characters'],
    },
    sku: {
      type: String,
      required: [true, 'SKU is required'],
      trim: true,
    },
    barcode: {
      type: String,
      required: [true, 'Barcode is required'],
      trim: true,
    },
    category: {
      type: String,
      trim: true,
      default: 'Uncategorized',
    },
    purchasePrice: {
      type: Number,
      required: [true, 'Purchase price is required'],
      min: [0, 'Purchase price must be positive'],
    },
    sellingPrice: {
      type: Number,
      required: [true, 'Selling price is required'],
      min: [0, 'Selling price must be positive'],
      // Custom validator: selling price must be >= purchase price
      validate: {
        validator: function (this: any, val: number): boolean {
          return val >= this.purchasePrice;
        },
        message: 'Selling price must be greater than or equal to purchase price',
      },
    },
    currentQuantity: {
      type: Number,
      required: [true, 'Current quantity is required'],
      min: [0, 'Current quantity must be non-negative'],
      default: 0,
    },
    minimumStockThreshold: {
      type: Number,
      required: [true, 'Minimum stock threshold is required'],
      min: [0, 'Minimum stock threshold must be non-negative'],
      default: 0,
    },
    supplierLeadTime: {
      type: Number,
      required: [true, 'Supplier lead time is required'],
      min: [1, 'Lead time must be at least 1 day'],
    },
    businessId: {
      type: String,
      required: [true, 'Business ID is required'],
    },
  },
  {
    timestamps: true,
    toJSON: {
      transform(_doc: any, ret: any) {
        ret.id = ret._id.toString();
        delete ret._id;
        delete ret.__v;
        return ret;
      },
    },
  }
);

// --- Indexes ---

// Compound index: find products by business + category (common dashboard filter)
productSchema.index({ businessId: 1, category: 1 });

// Compound index: find low-stock products by business (alerts use case)
productSchema.index({
  businessId: 1,
  minimumStockThreshold: 1,
  currentQuantity: 1,
});

// Barcode and SKU are unique within a business, not globally
productSchema.index({ businessId: 1, barcode: 1 }, { unique: true });
productSchema.index({ businessId: 1, sku: 1 }, { unique: true });

// --- Schema Methods ---

/**
 * Checks if current quantity is at or below the minimum threshold.
 * 
 * @returns true if stock is at or below threshold
 */
productSchema.methods.isLowStock = function (): boolean {
  return this.currentQuantity <= this.minimumStockThreshold;
};

/**
 * Calculates remaining stock needed to reach the minimum threshold.
 * 
 * @returns number of items needed to refill to minimum
 */
productSchema.methods.getStockShortfall = function (): number {
  return Math.max(0, this.minimumStockThreshold - this.currentQuantity);
};

// --- Schema Statics ---

/**
 * Find products by business ID with pagination.
 * 
 * @param businessId - Scoping business ID
 * @param page - Page number (1-based)
 * @param limit - Items per page
 * @returns Object with products and pagination metadata
 */
productSchema.statics.findByBusinessWithPagination = async function (
  businessId: string,
  page = 1,
  limit = 20
) {
  const skip = (page - 1) * limit;

  const [items, total] = await Promise.all([
    this.find({ businessId })
      .sort({ name: 1 })
      .skip(skip)
      .limit(limit)
      .lean(),
    this.countDocuments({ businessId }),
  ]);

  return {
    items,
    total,
    page,
    pages: Math.ceil(total / limit),
  };
};

/**
 * Search products by name or SKU for a specific business.
 * 
 * @param businessId - Scoping business ID
 * @param query - Search term (matches name or SKU)
 * @returns Array of matching products
 */
productSchema.statics.searchByNameOrSKU = async function (
  businessId: string,
  query: string
) {
  const escaped = query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const regex = new RegExp(escaped, 'i');
  return this.find({
    businessId,
    $or: [{ name: regex }, { sku: regex }],
  }).sort({ name: 1 });
};

// --- Export Model ---

// Export the Model type and the model instance
export type { IProduct };

export default model<IProduct, ProductModel>('Product', productSchema);