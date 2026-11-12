/**
 * Smart Inventory System - Inventory Routes
 * 
 * Defines HTTP routes for inventory CROP operations.
 * Mounts at /api/inventory.
 * 
 * Problem solved: Organizes API endpoints related to inventory
 * in one place, keeping route definitions separated from
 * controller logic and server configuration.
 * 
 * How it works:
 * - Uses Express Router for modular route definitions
 * - Each route maps to a controller function
 * - middleware authCheck (to be added in Phase 4) will scope
 *   data to the authenticated business
 * - Route handlers use async/await with error passing
 * 
 * Why chosen over alternatives:
 * - Express Router enables module-based route organization
 * - Keeps server.ts clean by delegating route registration
 * - Clear separation: routes → controllers → models
 * - Easy to add middleware (auth, validation) between route and controller
 */
import { Router, Request, Response, NextFunction } from 'express';
import {
  getAllProducts,
  getProductById,
  createProduct,
  updateProduct,
  deleteProduct,
} from '../controllers/inventoryController';
import { authenticate, authorize } from '../middleware/authMiddleware';

const router = Router();

// Every inventory route requires a valid token; businessId comes from it.
router.use(authenticate);

// --- GET /api/inventory ---
// List all products for a business with pagination and filtering.
// Query parameters: page (default: 1), limit (default: 20), category, search
router.get('/', async (req: Request, res: Response, next: NextFunction) => {
  try {
    await getAllProducts(req, res, next);
  } catch (err) {
    next(err);
  }
});

// --- GET /api/inventory/:id ---
// Retrieve a single product by ID
router.get('/:id', async (req: Request, res: Response, next: NextFunction) => {
  try {
    await getProductById(req, res, next);
  } catch (err) {
    next(err);
  }
});

// --- POST /api/inventory ---
// Create a new product (admin only)
router.post('/', authorize('admin'), async (req: Request, res: Response, next: NextFunction) => {
  try {
    await createProduct(req, res, next);
  } catch (err) {
    next(err);
  }
});

// --- PUT /api/inventory/:id ---
// Update a product by ID (admin only)
router.put('/:id', authorize('admin'), async (req: Request, res: Response, next: NextFunction) => {
  try {
    await updateProduct(req, res, next);
  } catch (err) {
    next(err);
  }
});

// --- DELETE /api/inventory/:id ---
// Delete a product by ID (admin only)
router.delete('/:id', authorize('admin'), async (req: Request, res: Response, next: NextFunction) => {
  try {
    await deleteProduct(req, res, next);
  } catch (err) {
    next(err);
  }
});

export default router;