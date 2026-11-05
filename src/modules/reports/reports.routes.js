import { Router } from 'express';
import authenticate from '../../middleware/authenticate.middleware.js';
import authorize from '../../middleware/authorize.middleware.js';
import validate from '../../middleware/validate.middleware.js';
import * as reportsController from './reports.controller.js';
import {
  auditIdParam,
  listReportRules,
  reportIdParam,
} from './reports.validator.js';

const router = Router();

// Nested under /audits — generate report for an audit
export const auditReportRoutes = Router({ mergeParams: true });

auditReportRoutes.post(
  '/',
  authenticate,
  authorize('ADMIN', 'CLIENT'),
  auditIdParam,
  validate,
  reportsController.generateReport
);

// Top-level /reports
router.use(authenticate);

router.get(
  '/',
  authorize('ADMIN', 'CLIENT'),
  listReportRules,
  validate,
  reportsController.listReports
);

router.get(
  '/:id/download',
  authorize('ADMIN', 'CLIENT'),
  reportIdParam,
  validate,
  reportsController.downloadReport
);

router.get(
  '/:id',
  authorize('ADMIN', 'CLIENT'),
  reportIdParam,
  validate,
  reportsController.getReport
);

export default router;
