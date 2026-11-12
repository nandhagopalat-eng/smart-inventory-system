import { Router } from 'express';

import {
  createStockMovement,
  listStockMovements,
} from '../controllers/stockMovementController';
import { authenticate, authorize } from '../middleware/authMiddleware';

const router = Router();

router.use(authenticate);

// Reading the audit trail is allowed for both roles; recording a manual
// movement changes stock and is therefore admin-only.
router.get('/', listStockMovements);
router.post('/', authorize('admin'), createStockMovement);

export default router;
