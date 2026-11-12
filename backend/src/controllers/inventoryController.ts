/**
 * Smart Inventory System - Inventory Controller
 *
 * Handles product CRUD with business scoping, pagination, search,
 * filtering, and consistent error responses.
 */
import type { NextFunction, Request, Response } from 'express';
import { isValidObjectId, type QueryFilter } from 'mongoose';

import Product, { type IProduct } from '../models/productModel';

type ScopedRequest = Request & { businessId?: string };

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

const escapeRegex = (value: string): string =>
  value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/**
 * lean() bypasses the schema's toJSON transform, so list responses are
 * normalized here to expose the same `id` shape as create/update responses.
 */
const serializeProduct = <T extends { _id: unknown; __v?: unknown }>(product: T) => {
  const { _id, __v, ...rest } = product;
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

/**
 * Maps common Mongoose write failures to 4xx responses.
 * Returns true when the error was handled.
 */
const handleWriteError = (err: unknown, res: Response): boolean => {
  if (err instanceof Error && err.name === 'ValidationError') {
    const messages = Object.values(
      (err as Error & { errors: Record<string, { message: string }> }).errors
    ).map((fieldError) => fieldError.message);
    errorResponse(res, messages.join(', '), 400);
    return true;
  }

  if (typeof err === 'object' && err !== null) {
    const duplicate = err as { code?: number; keyPattern?: Record<string, unknown> };
    if (duplicate.code === 11000) {
      const field = Object.keys(duplicate.keyPattern ?? {})[0] ?? 'field';
      errorResponse(res, `${field} already exists`, 409);
      return true;
    }
  }

  if (err instanceof Error && err.name === 'CastError') {
    errorResponse(res, 'Invalid identifier', 400);
    return true;
  }

  return false;
};

/**
 * GET /api/inventory
 * Query: page, limit, category, search
 */
export const getAllProducts = async (
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> => {
  try {
    const businessId = (req as ScopedRequest).businessId;
    const { page, limit } = parsePagination(req.query.page, req.query.limit);
    const { category, search } = req.query;

    if (!businessId) {
      // Authentication middleware will provide this in Milestone 2.
      successResponse(
        res,
        { items: [], total: 0, page, pages: 0 },
        'No business context'
      );
      return;
    }

    const filter: QueryFilter<IProduct> = { businessId };

    if (typeof category === 'string' && category.trim() !== '') {
      filter.category = category.trim();
    }

    if (typeof search === 'string' && search.trim() !== '') {
      const regex = new RegExp(escapeRegex(search.trim()), 'i');
      filter.$or = [{ name: regex }, { sku: regex }, { barcode: regex }];
    }

    const skip = (page - 1) * limit;
    const [items, total] = await Promise.all([
      Product.find(filter).sort({ name: 1 }).skip(skip).limit(limit).lean(),
      Product.countDocuments(filter),
    ]);

    successResponse(res, {
      items: items.map(serializeProduct),
      total,
      page,
      pages: Math.ceil(total / limit),
    }, 'Products retrieved successfully');
  } catch (err) {
    next(err);
  }
};

/**
 * GET /api/inventory/:id
 */
export const getProductById = async (
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> => {
  try {
    const { id } = req.params;
    const businessId = (req as ScopedRequest).businessId;

    if (!id || !isValidObjectId(id)) {
      errorResponse(res, 'Invalid product ID', 400);
      return;
    }

    const product = await Product.findOne({ _id: id, businessId }).lean();

    if (!product) {
      errorResponse(res, 'Product not found', 404);
      return;
    }

    successResponse(res, serializeProduct(product), 'Product retrieved successfully');
  } catch (err) {
    next(err);
  }
};

/**
 * POST /api/inventory
 */
export const createProduct = async (
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> => {
  try {
    const businessId = (req as ScopedRequest).businessId;

    if (!businessId) {
      errorResponse(res, 'Authentication required', 401);
      return;
    }

    const {
      name,
      sku,
      barcode,
      category,
      purchasePrice,
      sellingPrice,
      currentQuantity,
      minimumStockThreshold,
      supplierLeadTime,
    } = req.body as Partial<IProduct>;

    const product = await Product.create({
      name,
      sku,
      barcode,
      category,
      purchasePrice,
      sellingPrice,
      currentQuantity: currentQuantity ?? 0,
      minimumStockThreshold,
      supplierLeadTime,
      businessId,
    });

    successResponse(res, product, 'Product created successfully', 201);
  } catch (err) {
    if (!handleWriteError(err, res)) {
      next(err);
    }
  }
};

/**
 * PUT /api/inventory/:id
 *
 * Stock quantity is intentionally excluded: quantities must change
 * through a recorded stock movement, not a product edit.
 */
export const updateProduct = async (
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> => {
  try {
    const { id } = req.params;
    const businessId = (req as ScopedRequest).businessId;

    if (!businessId) {
      errorResponse(res, 'Authentication required', 401);
      return;
    }

    if (!id || !isValidObjectId(id)) {
      errorResponse(res, 'Invalid product ID', 400);
      return;
    }

    const {
      name,
      sku,
      barcode,
      category,
      purchasePrice,
      sellingPrice,
      minimumStockThreshold,
      supplierLeadTime,
    } = req.body as Partial<IProduct>;

    const product = await Product.findOne({ _id: id, businessId });

    if (!product) {
      errorResponse(res, 'Product not found', 404);
      return;
    }

    // Assign then save so cross-field validators (selling >= purchase) see
    // the merged document; update validators cannot read sibling paths.
    if (name !== undefined) product.name = name;
    if (sku !== undefined) product.sku = sku;
    if (barcode !== undefined) product.barcode = barcode;
    if (category !== undefined) product.category = category;
    if (purchasePrice !== undefined) product.purchasePrice = purchasePrice;
    if (sellingPrice !== undefined) product.sellingPrice = sellingPrice;
    if (minimumStockThreshold !== undefined) product.minimumStockThreshold = minimumStockThreshold;
    if (supplierLeadTime !== undefined) product.supplierLeadTime = supplierLeadTime;

    await product.save();

    successResponse(res, serializeProduct(product.toObject()), 'Product updated successfully');
  } catch (err) {
    if (!handleWriteError(err, res)) {
      next(err);
    }
  }
};

/**
 * DELETE /api/inventory/:id
 */
export const deleteProduct = async (
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> => {
  try {
    const { id } = req.params;
    const businessId = (req as ScopedRequest).businessId;

    if (!businessId) {
      errorResponse(res, 'Authentication required', 401);
      return;
    }

    if (!id || !isValidObjectId(id)) {
      errorResponse(res, 'Invalid product ID', 400);
      return;
    }

    const deleted = await Product.deleteOne({ _id: id, businessId });

    if (deleted.deletedCount === 0) {
      errorResponse(res, 'Product not found', 404);
      return;
    }

    successResponse(res, {}, 'Product deleted successfully');
  } catch (err) {
    next(err);
  }
};
