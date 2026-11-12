/**
 * Smart Inventory System - Alerts Routes
 * 
 * Defines HTTP routes for inventory alert operations.
 * Mounts at /api/alerts.
 * 
 * Problem solved: Organizes API endpoints related to low-stock
 * alerts in one place, keeping route definitions separated from
 * controller logic.
 * 
 * How it works:
 * - Uses Express Router for modular route definitions
 * - GET /api/alerts/low-stock — Returns products below threshold
 * - Middleware authCheck (Phase 4) will scope data to authenticated business
 * - Error handling with next(err) for async error propagation
 * 
 * Why chosen over alternatives:
 * - Express Router enables module-based route organization
 * - Keeps alert logic decoupled from server configuration
 * - Clear separation: routes → controllers → models
 * - Single endpoint for low-stock query simplifies frontend design
 */
import { Router, Request, Response, NextFunction } from 'express';

import { getLowStockProducts } from '../controllers/alertsController';
import { authenticate } from '../middleware/authMiddleware';

const router = Router();

router.use(authenticate);

// --- GET /api/alerts/low-stock ---
// Get all products that are at or below their minimum stock threshold.
// This triggers low-stock alerts for the business.
//
// Query: none required (all scoped to authenticated business)
//
// Response: Array of products with their current stock and threshold info.
//
// Typical response format:
// {
//   "status": "success",
//   "message": "Low-stock products retrieved",
//   "data": {
//     "items": [...],
//     "total": 5,
//     "page": 1,
//     "pages": 1
//   }
// }
router.get('/low-stock', async (req: Request, res: Response, next: NextFunction) => {
  try {
    await getLowStockProducts(req, res, next);
  } catch (err) {
    next(err);
  }
});

export default router;