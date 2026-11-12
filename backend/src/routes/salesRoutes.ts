/**
 * Smart Inventory System - Sales Routes
 * 
 * Defines HTTP routes for sales recording and inventory updates.
 * Mounts at /api/sales.
 * 
 * Problem solved: Organizes API endpoints related to sales
 * and inventory updates in one place, keeping route definitions
 * separated from controller logic.
 * 
 * How it works:
 * - Uses Express Router for modular route definitions
 * - POST /api/sales/record — Records a sale, validates stock,
 *   deducts inventory, and creates movement history
 * - Middleware authCheck (Phase 4) will scope data to authenticated business
 * - Error handling with next(err) for async error propagation
 * 
 * Why chosen over alternatives:
 * - Express Router enables module-based route organization
 * - Keeps sales logic decoupled from server configuration
 * - Clear separation: routes → controllers → models
 * - Single endpoint for sale recording simplifies frontend API design
 */
import { Router, Request, Response, NextFunction } from 'express';

import { recordSale, getSalesByBusiness } from '../controllers/salesController';
import { authenticate } from '../middleware/authMiddleware';

const router = Router();

// Sales belong to the authenticated business; both roles may record and read.
router.use(authenticate);

// --- POST /api/sales/record ---
// Record a new sale transaction.
// - Validates sufficient stock exists before completing
// - Atomically deducts stock quantities
// - Creates sale record and stock movement history
// - Returns the sale record and updated stock levels
//
// Typical request body:
// {
//   "businessId": "business_123",
//   "items": [
//     {
//       "productId": "prod_1",
//       "productName": "Widget A",
//       "quantity": 2,
//       "unitPrice": 10.99
//     }
//   ],
//   "paymentMethod": "cash",
//   "notes": "Counter sale - customer John Doe"
// }
router.post('/record', async (req: Request, res: Response, next: NextFunction) => {
  try {
    await recordSale(req, res, next);
  } catch (err) {
    next(err);
  }
});

// --- GET /api/sales ---
// Get sales history for a business with pagination and filtering.
// Query parameters: page (default: 1), limit (default: 20), startDate, endDate
router.get('/', async (req: Request, res: Response, next: NextFunction) => {
  try {
    await getSalesByBusiness(req, res, next);
  } catch (err) {
    next(err);
  }
});

export default router;