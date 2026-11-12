/**
 * Smart Inventory System - Prediction Routes
 * 
 * Defines HTTP routes for predictive restocking operations.
 * Mounts at /api/predictions.
 * 
 * Problem solved: Organizes API endpoints related to demand
 * forecasting and restocking suggestions in one place.
 * 
 * How it works:
 * - Uses Express Router for modular route definitions
 * - GET /api/predictions/reorder-point — Calculate reorder point
 *   for a specific product or all products
 * - Query parameters: productId (optional), days (window for moving avg)
 * - Middleware authCheck (Phase 4) will scope data to authenticated business
 * - Error handling with next(err) for async error propagation
 * 
 * Why chosen over alternatives:
 * - Express Router enables module-based route organization
 * - Keeps prediction logic decoupled from server configuration
 * - Clear separation: routes → controllers → models
 * - Single endpoint for reorder point calculation simplifies
 *   frontend design (one API call per product)
 */
import { Router, Request, Response, NextFunction } from 'express';

import { 
  calculateReorderPoint, 
  getReorderPointsForBusiness 
} from '../controllers/predictionController';
import { authenticate } from '../middleware/authMiddleware';

const router = Router();

router.use(authenticate);

// --- GET /api/predictions/reorder-point ---
// Calculate reorder point for a specific product.
// 
// Query parameters:
// - productId: Product ID (required)
// - days: Number of historical days to use for moving average (optional, default: 30)
// - alpha: Smoothing factor for exponential smoothing (optional, default: 0.3)
//
// Response includes:
// - product details, predicted demand, suggested reorder quantity
// - reorder point calculation, safety stock rationale
//
// Typical response:
// {
//   "status": "success",
//   "data": {
//     "productId": "prod_1",
//     "productName": "Widget A",
//     "averageDailyDemand": 2.5,
//     "leadTimeDays": 7,
//     "safetyStock": 5,
//     "reorderPoint": 22.5,
//     "suggestedOrderQuantity": 50,
//     "calculationDate": "2024-01-15"
//   }
// }
router.get('/reorder-point', async (req: Request, res: Response, next: NextFunction) => {
  try {
    await calculateReorderPoint(req, res, next);
  } catch (err) {
    next(err);
  }
});

// --- GET /api/predictions/reorder-points ---
// Calculate reorder points for all products in a business.
//
// Query parameters:
// - days: Number of historical days to use for moving average (optional, default: 30)
// - alpha: Smoothing factor for exponential smoothing (optional, default: 0.3)
//
// Returns reorder points for all products, prioritized by urgency.
//
// Response:
// {
//   "status": "success",
//   "data": {
//     "items": [...],
//     "total": 10,
//     "urgentCount": 3, // Products below reorder point
//     "page": 1
//   }
// }
router.get('/', async (req: Request, res: Response, next: NextFunction) => {
  try {
    await getReorderPointsForBusiness(req, res, next);
  } catch (err) {
    next(err);
  }
});

export default router;