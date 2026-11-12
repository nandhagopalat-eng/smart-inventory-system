/**
 * Smart Inventory System - Sales Controller
 *
 * Records multi-item sales and updates stock through explicit
 * movement records. Prices come from the database, never from the
 * client, and stock decrements are guarded atomic writes.
 */
import type { NextFunction, Request, Response } from 'express';
import mongoose, { isValidObjectId, type QueryFilter } from 'mongoose';

import Product from '../models/productModel';
import Sale, { type ISale, type ISaleItem } from '../models/saleModel';
import StockMovement from '../models/stockMovementModel';
import type { AuthenticatedRequest } from '../types/auth';

const PAYMENT_METHODS = ['cash', 'card', 'transfer', 'other'] as const;
type PaymentMethod = (typeof PAYMENT_METHODS)[number];

interface SaleDocumentInput {
  businessId: string;
  items: ISaleItem[];
  totalAmount: number;
  paymentMethod: PaymentMethod;
  notes?: string;
}

interface SaleResult {
  sale: unknown;
  products: Array<{ id: string; currentQuantity: number }>;
}

class HttpError extends Error {
  statusCode: number;

  constructor(message: string, statusCode: number) {
    super(message);
    this.name = 'HttpError';
    this.statusCode = statusCode;
  }
}

const successResponse = (
  res: Response,
  data: unknown,
  message: string,
  statusCode: number = 200
): void => {
  res.status(statusCode).json({
    status: 'success',
    message,
    data,
  });
};

const errorResponse = (res: Response, message: string, statusCode: number): void => {
  res.status(statusCode).json({
    status: 'error',
    message,
  });
};

const withId = <T extends { _id: unknown; __v?: unknown }>(document: T) => {
  const { _id, __v, ...rest } = document;
  return { id: String(_id), ...rest };
};

const parsePagination = (
  pageValue: unknown,
  limitValue: unknown
): { page: number; limit: number } => {
  const page = Math.max(1, Number.parseInt(String(pageValue ?? '1'), 10) || 1);
  const parsedLimit = Number.parseInt(String(limitValue ?? '20'), 10) || 20;
  return { page, limit: Math.min(100, Math.max(1, parsedLimit)) };
};

const isPaymentMethod = (value: unknown): value is PaymentMethod =>
  typeof value === 'string' && (PAYMENT_METHODS as readonly string[]).includes(value);

/**
 * Standalone MongoDB rejects transactions. That specific failure is the only
 * case where the non-transactional fallback is used.
 */
const isTransactionUnsupported = (error: unknown): boolean => {
  const message = error instanceof Error ? error.message : '';
  return /transaction numbers|retryable writes|does not support transactions|replica set/i.test(
    message
  );
};

const buildMovementDocs = (saleDocument: SaleDocumentInput, userId: string) =>
  saleDocument.items.map((item) => ({
    businessId: saleDocument.businessId,
    productId: item.productId,
    movementType: 'out' as const,
    quantityChange: item.quantity,
    reason: 'sale' as const,
    notedBy: userId,
  }));

/**
 * Serialized sale with its stock changes applied atomically (replica set).
 */
const persistSaleWithTransaction = async (
  saleDocument: SaleDocumentInput,
  userId: string
): Promise<SaleResult> => {
  const session = await mongoose.startSession();

  try {
    session.startTransaction();

    const products: SaleResult['products'] = [];

    for (const item of saleDocument.items) {
      const updated = await Product.findOneAndUpdate(
        {
          _id: item.productId,
          businessId: saleDocument.businessId,
          currentQuantity: { $gte: item.quantity },
        },
        { $inc: { currentQuantity: -item.quantity } },
        { session, returnDocument: 'after' }
      );

      if (!updated) {
        throw new HttpError(`Insufficient stock for "${item.productName}"`, 409);
      }

      products.push({
        id: String(updated._id),
        currentQuantity: updated.currentQuantity,
      });
    }

    const [sale] = await Sale.create([saleDocument], { session });

    if (!sale) {
      throw new Error('Sale could not be created');
    }

    await StockMovement.create(buildMovementDocs(saleDocument, userId), { session });

    await session.commitTransaction();

    return { sale: withId(sale.toObject()), products };
  } catch (err) {
    try {
      await session.abortTransaction();
    } catch {
      // Standalone MongoDB cannot abort a transaction it never started.
    }

    if (err instanceof HttpError || !isTransactionUnsupported(err)) {
      throw err;
    }

    // Standalone MongoDB: nothing was committed, so the writes can be replayed
    // one by one with a compensating rollback.
    return persistSaleWithoutTransactions(saleDocument, userId);
  } finally {
    await session.endSession();
  }
};

/**
 * Compensating fallback for deployments without transaction support. The sale
 * is written last; any earlier failure restores stock and removes movements.
 */
const persistSaleWithoutTransactions = async (
  saleDocument: SaleDocumentInput,
  userId: string
): Promise<SaleResult> => {
  const appliedItems: ISaleItem[] = [];
  const products: SaleResult['products'] = [];

  try {
    for (const item of saleDocument.items) {
      const updated = await Product.findOneAndUpdate(
        {
          _id: item.productId,
          businessId: saleDocument.businessId,
          currentQuantity: { $gte: item.quantity },
        },
        { $inc: { currentQuantity: -item.quantity } },
        { returnDocument: 'after' }
      ).lean();

      if (!updated) {
        throw new HttpError(`Insufficient stock for "${item.productName}"`, 409);
      }

      appliedItems.push(item);
      products.push({
        id: String(updated._id),
        currentQuantity: updated.currentQuantity,
      });
    }

    const movements = await StockMovement.create(buildMovementDocs(saleDocument, userId));

    try {
      const sale = await Sale.create(saleDocument);
      return { sale: withId(sale.toObject()), products };
    } catch (err) {
      await StockMovement.deleteMany({
        _id: { $in: movements.map((movement) => movement._id) },
      }).catch(() => undefined);
      throw err;
    }
  } catch (err) {
    await Promise.all(
      appliedItems.map((item) =>
        Product.updateOne(
          { _id: item.productId, businessId: saleDocument.businessId },
          { $inc: { currentQuantity: item.quantity } }
        ).catch(() => undefined)
      )
    );
    throw err;
  }
};

/**
 * POST /api/sales/record
 * Body: { items: [{ productId, quantity }], paymentMethod?, notes? }
 * Price and product name are taken from the product record.
 */
export const recordSale = async (
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> => {
  try {
    const authUser = (req as AuthenticatedRequest).user;
    const businessId = authUser?.businessId;

    if (!authUser || !businessId) {
      errorResponse(res, 'Authentication required', 401);
      return;
    }

    const body = (req.body ?? {}) as Record<string, unknown>;
    const { items, paymentMethod, notes } = body;

    if (!Array.isArray(items) || items.length === 0) {
      errorResponse(res, 'Sale must contain at least one item', 400);
      return;
    }

    const parsedItems: Array<{ productId: string; quantity: number }> = [];

    for (const rawItem of items) {
      if (!rawItem || typeof rawItem !== 'object') {
        errorResponse(res, 'Each sale item needs a valid product and positive quantity', 400);
        return;
      }

      const { productId, quantity } = rawItem as Record<string, unknown>;

      if (typeof productId !== 'string' || !isValidObjectId(productId)) {
        errorResponse(res, 'Each sale item needs a valid product and positive quantity', 400);
        return;
      }

      if (typeof quantity !== 'number' || !Number.isInteger(quantity) || quantity < 1) {
        errorResponse(res, 'Each sale item needs a valid product and positive quantity', 400);
        return;
      }

      parsedItems.push({ productId, quantity });
    }

    if (new Set(parsedItems.map((item) => item.productId)).size !== parsedItems.length) {
      errorResponse(res, 'Each product may only appear once per sale', 400);
      return;
    }

    if (paymentMethod !== undefined && !isPaymentMethod(paymentMethod)) {
      errorResponse(res, `Payment method must be one of: ${PAYMENT_METHODS.join(', ')}`, 400);
      return;
    }

    const productIds = parsedItems.map((item) => item.productId);
    const products = await Product.find({ _id: { $in: productIds }, businessId }).lean();

    const productMap = new Map(products.map((product) => [String(product._id), product]));

    const saleItems: ISaleItem[] = [];
    let totalAmount = 0;

    for (const item of parsedItems) {
      const product = productMap.get(item.productId);

      if (!product) {
        errorResponse(res, 'One or more products were not found in this business', 404);
        return;
      }

      if (product.currentQuantity < item.quantity) {
        errorResponse(
          res,
          `Insufficient stock for "${product.name}". Available: ${product.currentQuantity}`,
          409
        );
        return;
      }

      const lineTotal = item.quantity * product.sellingPrice;
      totalAmount += lineTotal;

      saleItems.push({
        productId: item.productId,
        productName: product.name,
        quantity: item.quantity,
        unitPrice: product.sellingPrice,
        total: lineTotal,
      });
    }

    const saleDocument: SaleDocumentInput = {
      businessId,
      items: saleItems,
      totalAmount,
      paymentMethod: paymentMethod ?? 'cash',
      ...(typeof notes === 'string' && notes.trim() !== '' ? { notes: notes.trim() } : {}),
    };

    const result = await persistSaleWithTransaction(saleDocument, authUser.id);

    successResponse(res, result, 'Sale recorded successfully', 201);
  } catch (err) {
    next(err);
  }
};

/**
 * GET /api/sales
 * Query: page, limit, startDate, endDate
 */
export const getSalesByBusiness = async (
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> => {
  try {
    const businessId = (req as AuthenticatedRequest).businessId;
    const { page, limit } = parsePagination(req.query.page, req.query.limit);
    const { startDate, endDate } = req.query;

    if (!businessId) {
      errorResponse(res, 'Authentication required', 401);
      return;
    }

    const filter: QueryFilter<ISale> = { businessId };

    if (typeof startDate === 'string' || typeof endDate === 'string') {
      const range: { $gte?: Date; $lte?: Date } = {};

      if (typeof startDate === 'string') {
        const parsedStart = new Date(startDate);
        if (Number.isNaN(parsedStart.getTime())) {
          errorResponse(res, 'Invalid startDate', 400);
          return;
        }
        range.$gte = parsedStart;
      }

      if (typeof endDate === 'string') {
        const parsedEnd = new Date(endDate);
        if (Number.isNaN(parsedEnd.getTime())) {
          errorResponse(res, 'Invalid endDate', 400);
          return;
        }
        range.$lte = parsedEnd;
      }

      filter.timestamp = range;
    }

    const skip = (page - 1) * limit;
    const [items, total] = await Promise.all([
      Sale.find(filter).sort({ timestamp: -1 }).skip(skip).limit(limit).lean(),
      Sale.countDocuments(filter),
    ]);

    successResponse(
      res,
      {
        items: items.map(withId),
        total,
        page,
        pages: Math.ceil(total / limit),
      },
      'Sales retrieved successfully'
    );
  } catch (err) {
    next(err);
  }
};
