/**
 * Smart Inventory System - Prediction Controller
 *
 * Explainable reorder-point forecasting from recorded sales history:
 *   Reorder Point = Average Daily Demand x Lead Time + Safety Stock
 *
 * Milestone 6 will replace the per-product queries with a single
 * aggregation pipeline and use calendar days in the demand average.
 */
import type { NextFunction, Request, Response } from 'express';
import { isValidObjectId } from 'mongoose';

import Product from '../models/productModel';
import Sale from '../models/saleModel';
import { getDaysAgoISO } from '../utils/dateUtils';

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

interface DemandResult {
  averageDailyDemand: number;
  salesRecorded: number;
  demandValues: number[];
}

/**
 * Builds daily product demand from sales in chronological order.
 */
const calculateDailyDemand = async (
  businessId: string,
  productId: string,
  days: number
): Promise<DemandResult> => {
  const startDate = new Date(getDaysAgoISO(days));

  const sales = await Sale.find({
    businessId,
    'items.productId': productId,
    timestamp: { $gte: startDate },
  })
    .sort({ timestamp: 1 })
    .lean();

  const dailyDemands = new Map<string, number>();

  sales.forEach((sale) => {
    const dayKey = sale.timestamp.toISOString().slice(0, 10);
    const item = sale.items.find((saleItem) => saleItem.productId === productId);
    if (!item) {
      return;
    }

    dailyDemands.set(dayKey, (dailyDemands.get(dayKey) ?? 0) + item.quantity);
  });

  const demandValues = Array.from(dailyDemands.values());
  const totalDemand = demandValues.reduce((sum, value) => sum + value, 0);
  const averageDailyDemand = demandValues.length > 0 ? totalDemand / demandValues.length : 0;

  return {
    averageDailyDemand,
    salesRecorded: sales.length,
    demandValues,
  };
};

/**
 * GET /api/predictions/reorder-point?productId=...
 */
export const calculateReorderPoint = async (
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> => {
  try {
    const { productId, days = '30', alpha = '0.3' } = req.query as {
      productId?: string;
      days?: string;
      alpha?: string;
    };
    const businessId = (req as ScopedRequest).businessId;

    if (!productId) {
      errorResponse(res, 'Product ID is required', 400);
      return;
    }

    if (!isValidObjectId(productId)) {
      errorResponse(res, 'Invalid product ID', 400);
      return;
    }

    if (!businessId) {
      successResponse(res, { items: [], total: 0 }, 'No business context');
      return;
    }

    const product = await Product.findOne({
      _id: productId,
      businessId,
    }).lean();

    if (!product) {
      errorResponse(res, 'Product not found', 404);
      return;
    }

    const daysNum = Math.max(1, Number(days) || 30);
    const alphaNum = Math.min(1, Math.max(0.01, Number(alpha) || 0.3));

    const { averageDailyDemand: sma, salesRecorded, demandValues } =
      await calculateDailyDemand(businessId, productId, daysNum);

    let exponentialSmoothing = sma;
    for (let i = 0; i < demandValues.length; i += 1) {
      const currentDemand = demandValues[i] ?? 0;
      exponentialSmoothing =
        alphaNum * currentDemand + (1 - alphaNum) * exponentialSmoothing;
    }

    const safetyStock = Math.max(1, Math.round(sma * 0.5));
    const leadTime = product.supplierLeadTime || 7;
    const reorderPoint = Math.round(sma * leadTime + safetyStock);
    const suggestedOrderQuantity = Math.max(
      1,
      reorderPoint - product.currentQuantity + safetyStock
    );

    successResponse(res, {
      product: {
        id: product._id.toString(),
        name: product.name,
        sku: product.sku,
        barcode: product.barcode,
        category: product.category,
        currentQuantity: product.currentQuantity,
        minimumStockThreshold: product.minimumStockThreshold,
        supplierLeadTime: product.supplierLeadTime,
      },
      prediction: {
        averageDailyDemand: Math.round(sma * 10) / 10,
        leadTimeDays: leadTime,
        safetyStock,
        reorderPoint,
        suggestedOrderQuantity,
        calculationDate: new Date().toISOString().slice(0, 10),
        demandBreakdown: {
          historicalDaysUsed: daysNum,
          salesRecorded,
          simpleMovingAverage: Math.round(sma * 10) / 10,
          exponentialSmoothing: Math.round(exponentialSmoothing * 10) / 10,
          alpha: alphaNum,
        },
      },
    }, 'Reorder point calculated successfully');
  } catch (err) {
    next(err);
  }
};

/**
 * GET /api/predictions
 */
export const getReorderPointsForBusiness = async (
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> => {
  try {
    const businessId = (req as ScopedRequest).businessId;

    if (!businessId) {
      successResponse(res, { items: [], total: 0, urgentCount: 0 }, 'No business context');
      return;
    }

    const products = await Product.find({ businessId }).lean();

    const reorderPoints = await Promise.all(
      products.map(async (product) => {
        const productId = product._id.toString();
        const leadTime = product.supplierLeadTime || 7;
        const { averageDailyDemand: sma } = await calculateDailyDemand(
          businessId,
          productId,
          30
        );

        const safetyStock = Math.max(1, Math.round(sma * 0.5));
        const reorderPoint = Math.round(sma * leadTime + safetyStock);
        const suggestedOrderQuantity = Math.max(
          1,
          reorderPoint - product.currentQuantity + safetyStock
        );

        return {
          productId,
          productName: product.name,
          sku: product.sku,
          currentQuantity: product.currentQuantity,
          minimumStockThreshold: product.minimumStockThreshold,
          supplierLeadTime: leadTime,
          averageDailyDemand: Math.round(sma * 10) / 10,
          leadTimeDays: leadTime,
          safetyStock,
          reorderPoint,
          suggestedOrderQuantity,
          isBelowThreshold: product.currentQuantity <= product.minimumStockThreshold,
          urgency:
            product.currentQuantity <= product.minimumStockThreshold ? 'HIGH' : 'NORMAL',
        };
      })
    );

    reorderPoints.sort((a, b) => {
      if (a.urgency === b.urgency) {
        return a.currentQuantity - b.currentQuantity;
      }
      return a.urgency === 'HIGH' ? -1 : 1;
    });

    const urgentCount = reorderPoints.filter((item) => item.urgency === 'HIGH').length;

    successResponse(res, {
      items: reorderPoints,
      total: reorderPoints.length,
      urgentCount,
    }, 'Reorder points calculated for all products');
  } catch (err) {
    next(err);
  }
};
