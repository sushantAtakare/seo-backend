import { Router } from 'express';
import { getApiInfo } from '../controllers/health.controller.js';
import authRoutes from '../modules/auth/auth.routes.js';

const router = Router();

router.get('/', getApiInfo);
router.use('/auth', authRoutes);

export default router;
