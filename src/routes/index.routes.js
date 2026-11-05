import { Router } from 'express';
import { getApiInfo } from '../controllers/health.controller.js';
import authRoutes from '../modules/auth/auth.routes.js';
import clientsRoutes from '../modules/clients/clients.routes.js';
import sitesRoutes from '../modules/sites/sites.routes.js';
import auditsRoutes from '../modules/audits/audits.routes.js';
import crawlerRoutes from '../modules/crawler/crawler.routes.js';
import reportsRoutes, {
  auditReportRoutes,
} from '../modules/reports/reports.routes.js';

const router = Router();

router.get('/', getApiInfo);
router.use('/auth', authRoutes);
router.use('/clients', clientsRoutes);
router.use('/sites', sitesRoutes);
// Nested report generation before generic audit :id handlers
router.use('/audits/:auditId/reports', auditReportRoutes);
// Crawl routes before generic audit :id handlers
router.use('/audits', crawlerRoutes);
router.use('/audits', auditsRoutes);
router.use('/reports', reportsRoutes);

export default router;
