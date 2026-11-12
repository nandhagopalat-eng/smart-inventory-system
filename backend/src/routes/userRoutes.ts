import { Router } from 'express';

import { createUser, listUsers, updateUserRole } from '../controllers/userController';
import { authenticate, authorize } from '../middleware/authMiddleware';

const router = Router();

// User management is an admin-only, business-scoped capability.
router.use(authenticate, authorize('admin'));

router.get('/', listUsers);
router.post('/', createUser);
router.patch('/:id/role', updateUserRole);

export default router;
