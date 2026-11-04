import { Router } from 'express';
import { getApiInfo } from '../controllers/health.controller.js';
import authRoutes from '../modules/auth/auth.routes.js';
import clientsRoutes from '../modules/clients/clients.routes.js';
import sitesRoutes from '../modules/sites/sites.routes.js';
import auditsRoutes from '../modules/audits/audits.routes.js';

const router = Router();

router.get('/', getApiInfo);
router.use('/auth', authRoutes);
router.use('/clients', clientsRoutes);
router.use('/sites', sitesRoutes);
router.use('/audits', auditsRoutes);

export default router;
