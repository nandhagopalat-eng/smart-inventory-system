/**
 * Smart Inventory System - Alerts Controller
 *
 * Returns products at or below their minimum stock threshold.
 * Alert state is derived from current product quantities, so results
 * always reflect the latest recorded stock movements.
 */
import type { NextFunction, Request, Response } from 'express';

import Product from '../models/productModel';

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

/**
 * GET /api/alerts/low-stock
 */
export const getLowStockProducts = async (
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> => {
  try {
    const businessId = (req as ScopedRequest).businessId;

    if (!businessId) {
      // Authentication middleware will provide this in Milestone 2.
      successResponse(res, { items: [], total: 0 }, 'No business context');
      return;
    }

    const lowStockProducts = await Product.find({
      businessId,
      $expr: { $lte: ['$currentQuantity', '$minimumStockThreshold'] },
    }).sort({ currentQuantity: 1 });

    const formattedProducts = lowStockProducts.map((product) => ({
      id: product._id.toString(),
      name: product.name,
      sku: product.sku,
      barcode: product.barcode,
      currentQuantity: product.currentQuantity,
      minimumStockThreshold: product.minimumStockThreshold,
      stockShortfall: product.getStockShortfall(),
      isLowStock: product.isLowStock(),
      isOutOfStock: product.currentQuantity === 0,
      category: product.category,
      daysOfStockRemaining: '—',
    }));

    successResponse(res, {
      items: formattedProducts,
      total: formattedProducts.length,
    }, 'Low-stock products retrieved');
  } catch (err) {
    next(err);
  }
};
