/**
 * Smart Inventory System - Stock Movement Controller
 *
 * Every manual stock change is applied and audited together: the quantity is
 * updated with a guarded write, then the movement record is created. If the
 * audit write fails, the quantity change is reverted. Sale movements are only
 * created by the sales endpoint so they cannot be double-counted.
 */
import type { NextFunction, Request, Response } from 'express';
import { isValidObjectId, type QueryFilter } from 'mongoose';

import Product from '../models/productModel';
import StockMovement, { type IStockMovement } from '../models/stockMovementModel';
import type { AuthenticatedRequest } from '../types/auth';

const REASONS = ['adjustment', 'return', 'transfer', 'waste', 'purchase'] as const;
type MovementReason = (typeof REASONS)[number];

const successResponse = (
  res: Response,
  data: unknown,
  message: string,
  statusCode: number = 200
): void => {
  res.status(statusCode).json({ status: 'success', message, data });
};

const errorResponse = (res: Response, message: string, statusCode: number): void => {
  res.status(statusCode).json({ status: 'error', message });
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

const isReason = (value: unknown): value is MovementReason =>
  typeof value === 'string' && (REASONS as readonly string[]).includes(value);

/**
 * GET /api/stock-movements
 * Query: productId (optional), page, limit
 */
export const listStockMovements = async (
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> => {
  try {
    const businessId = (req as AuthenticatedRequest).businessId;
    if (!businessId) {
      errorResponse(res, 'Authentication required', 401);
      return;
    }

    const { page, limit } = parsePagination(req.query.page, req.query.limit);
    const { productId } = req.query;

    if (typeof productId === 'string' && productId !== '' && !isValidObjectId(productId)) {
      errorResponse(res, 'Invalid product ID', 400);
      return;
    }

    const filter: QueryFilter<IStockMovement> = { businessId };
    if (typeof productId === 'string' && productId !== '') {
      filter.productId = productId;
    }

    const skip = (page - 1) * limit;
    const [items, total] = await Promise.all([
      StockMovement.find(filter).sort({ timestamp: -1 }).skip(skip).limit(limit).lean(),
      StockMovement.countDocuments(filter),
    ]);

    successResponse(
      res,
      {
        items: items.map(withId),
        total,
        page,
        pages: Math.ceil(total / limit),
      },
      'Stock movements retrieved'
    );
  } catch (err) {
    next(err);
  }
};

/**
 * POST /api/stock-movements
 * Admin only.
 * Body: productId, movementType ('in' | 'out'), quantityChange, reason, note (optional)
 */
export const createStockMovement = async (
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> => {
  let rollback: (() => Promise<unknown>) | null = null;

  try {
    const authUser = (req as AuthenticatedRequest).user;
    const businessId = authUser?.businessId;

    if (!authUser || !businessId) {
      errorResponse(res, 'Authentication required', 401);
      return;
    }

    const body = (req.body ?? {}) as Record<string, unknown>;
    const { productId, movementType, quantityChange, reason, note } = body;

    if (typeof productId !== 'string' || !isValidObjectId(productId)) {
      errorResponse(res, 'Invalid product ID', 400);
      return;
    }

    if (movementType !== 'in' && movementType !== 'out') {
      errorResponse(res, 'Movement type must be either "in" or "out"', 400);
      return;
    }

    if (!Number.isInteger(quantityChange) || (quantityChange as number) < 1) {
      errorResponse(res, 'Quantity change must be a positive whole number', 400);
      return;
    }

    if (!isReason(reason)) {
      errorResponse(
        res,
        `Reason must be one of: ${REASONS.join(', ')}. Sale movements come from the sales endpoint.`,
        400
      );
      return;
    }

    const quantity = quantityChange as number;
    const delta = movementType === 'in' ? quantity : -quantity;

    const product = await Product.findOne({ _id: productId, businessId }).lean();
    if (!product) {
      errorResponse(res, 'Product not found', 404);
      return;
    }

    const filter =
      movementType === 'out'
        ? { _id: productId, businessId, currentQuantity: { $gte: quantity } }
        : { _id: productId, businessId };

    const updatedProduct = await Product.findOneAndUpdate(
      filter,
      { $inc: { currentQuantity: delta } },
      { returnDocument: 'after' }
    ).lean();

    if (!updatedProduct) {
      errorResponse(
        res,
        `Insufficient stock. Available: ${product.currentQuantity}, requested: ${quantity}`,
        409
      );
      return;
    }

    rollback = () =>
      Product.updateOne({ _id: productId, businessId }, { $inc: { currentQuantity: -delta } });

    const movement = await StockMovement.create({
      businessId,
      productId,
      movementType,
      quantityChange: quantity,
      reason,
      notedBy: authUser.id,
      ...(typeof note === 'string' && note.trim() ? { note: note.trim() } : {}),
    });

    rollback = null;

    successResponse(
      res,
      {
        movement: withId(movement.toObject()),
        product: withId(updatedProduct),
      },
      'Stock movement recorded',
      201
    );
  } catch (err) {
    if (rollback) {
      await rollback().catch(() => undefined);
    }
    next(err);
  }
};
