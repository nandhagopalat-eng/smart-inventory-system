/**
 * Smart Inventory System - Sale Model
 * 
 * Mongoose schema for recording sales transactions.
 * Captures what was sold, to whom (business), and at what price.
 * 
 * Problem solved: Provides a permanent sales history essential
 * for revenue tracking, business analysis, and tax records.
 * 
 * How it works:
 * - Products sold: array of product IDs with quantities and prices
 * - Total amount: calculated from sale items
 * - Business ID: ownership scoping
 * - Timestamp: when the sale occurred
 * - Methods: calculate total, validate stock availability
 * 
 * Why chosen over alternatives:
 * - Storing sales in a separate collection with line items
 *   allows flexible product compositions per sale
 * - Total amount stored denotiavely for quick reporting
 * - Business scoping enables per-business revenue reporting
 * - Sale records work with stock movements for full audit trail
 */
import { Schema, model, type Model } from 'mongoose';

/**
 * Interface for sale item (product + quantity + price).
 */
interface ISaleItem {
  productId: string;
  productName: string;
  quantity: number;
  unitPrice: number; // Price at time of sale
  total: number; // quantity * unitPrice
}

/**
 * Interface for sale document fields.
 */
interface ISale {
  businessId: string;
  items: ISaleItem[];
  totalAmount: number;
  paymentMethod?: 'cash' | 'card' | 'transfer' | 'other';
  notes?: string;
  timestamp: Date;
  createdAt?: Date;
  updatedAt?: Date;
}

/** Instance methods available on a hydrated sale document. */
interface SaleMethods {
  calculateTotal(): number;
  validateStockAvailability(
    ProductModel: Model<any>
  ): Promise<{ isValid: boolean; message?: string }>;
}

/** Static methods available on the Sale model. */
interface SaleStatics {
  findByBusinessWithPagination(
    businessId: string,
    page?: number,
    limit?: number
  ): Promise<{ items: unknown[]; total: number; page: number; pages: number }>;
  findByDateRange(
    businessId: string,
    startDate: Date,
    endDate: Date
  ): Promise<unknown[]>;
}

type SaleModel = Model<ISale, {}, SaleMethods> & SaleStatics;

/**
 * Sale Schema — defines fields and validators.
 * 
 * Field explanations:
 * - businessId: Scoping to business owner (required)
 * - items: Array of sold products with quantities and prices (required)
 * - totalAmount: calculated total (required, min 0)
 * - paymentMethod: how payment was received (optional)
 * - notes: additional comments (optional)
 * - timestamp: automatic via timestamps option
 */
const saleSchema = new Schema<ISale, SaleModel, SaleMethods>(
  {
    businessId: {
      type: String,
      required: [true, 'Business ID is required'],
    },
    items: {
      type: [
        {
          productId: {
            type: String,
            required: true,
          },
          productName: {
            type: String,
            required: true,
          },
          quantity: {
            type: Number,
            required: true,
            min: [1, 'Quantity must be at least 1'],
          },
          unitPrice: {
            type: Number,
            required: true,
            min: [0, 'Unit price must be non-negative'],
          },
          total: {
            type: Number,
            required: true,
            min: [0, 'Total must be non-negative'],
            // Validate that total = quantity * unitPrice
            validate: {
              validator: function (this: any, val: number) {
                return val === this.quantity * this.unitPrice;
              },
              message: 'Total must equal quantity × unit price',
            },
          },
        },
      ],
      validate: {
        // Ensure at least one item
        validator: function (items: any) {
          return items && items.length > 0;
        },
        message: 'Sale must have at least one item',
      },
    },
    totalAmount: {
      type: Number,
      required: true,
      min: [0, 'Total amount must be non-negative'],
    },
    paymentMethod: {
      type: String,
      enum: {
        values: ['cash', 'card', 'transfer', 'other'],
        message: 'Payment method must be one of: cash, card, transfer, other',
      },
    },
    notes: {
      type: String,
      trim: true,
    },
    timestamp: {
      type: Date,
      required: true,
      default: Date.now,
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

/** --- Schema Methods --- */

/**
 * Calculate the total amount from items.
 * This is also stored denotiavely in totalAmount, but the method
 * ensures consistency if items are ever modified.
 * 
 * @returns Calculated total
 */
saleSchema.methods.calculateTotal = function (this: ISale): number {
  return this.items.reduce(
    (total, item) => total + item.total,
    0 as number
  );
};

/**
 * Validate that sufficient stock exists for this sale.
 * 
 * @param Product Mongoose model
 * @returns Object with isValid boolean and shortfall message if invalid
 */
saleSchema.methods.validateStockAvailability = async function (
  this: ISale,
  ProductModel: Model<any>
): Promise<{ isValid: boolean; message?: string }> {
  try {
    // Check each item's stock availability
    for (const item of this.items) {
      const product = await ProductModel.findById(item.productId);
      if (!product) {
        return {
          isValid: false,
          message: `Product "${item.productName}" not found`,
        };
      }

      if (product.currentQuantity < item.quantity) {
        return {
          isValid: false,
          message: `Insufficient stock for "${item.productName}". ` +
            `Available: ${product.currentQuantity}, Requested: ${item.quantity}`,
        };
      }
    }

    return { isValid: true };
  } catch (err) {
    throw new Error('Stock validation failed');
  }
};

/** --- Static Methods --- */

/**
 * Find sales by business ID with pagination.
 * 
 * @param businessId - Scoping business ID
 * @param page - Page number (1-based)
 * @param limit - Items per page
 * @returns Paginated sales
 */
saleSchema.statics.findByBusinessWithPagination = async function (
  businessId: string,
  page = 1,
  limit = 20
) {
  const skip = (page - 1) * limit;

  const [items, total] = await Promise.all([
    this.find({ businessId })
      .sort({ timestamp: -1 })
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
 * Find sales by date range for a business.
 * 
 * @param businessId - Scoping business ID
 * @param startDate - Start date (inclusive)
 * @param endDate - End date (inclusive)
 * @returns Matching sales
 */
saleSchema.statics.findByDateRange = async function (
  businessId: string,
  startDate: Date,
  endDate: Date
) {
  return this.find({
    businessId,
    timestamp: {
      $gte: startDate,
      $lte: endDate,
    },
  }).sort({ timestamp: -1 });
};

/** --- Export Model --- */

saleSchema.index({ businessId: 1, timestamp: -1 });
saleSchema.index({ businessId: 1, 'items.productId': 1, timestamp: -1 });

export type { ISale, ISaleItem };

export default model<ISale, SaleModel>('Sale', saleSchema);