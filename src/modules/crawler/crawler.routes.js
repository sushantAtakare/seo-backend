import { Router } from 'express';
import authenticate from '../../middleware/authenticate.middleware.js';
import authorize from '../../middleware/authorize.middleware.js';
import validate from '../../middleware/validate.middleware.js';
import * as crawlerController from './crawler.controller.js';
import { crawlAuditRules } from './crawler.validator.js';
import { param } from 'express-validator';

const router = Router();

router.post(
  '/:id/crawl',
  authenticate,
  authorize('ADMIN', 'CLIENT'),
  crawlAuditRules,
  validate,
  crawlerController.crawlAudit
);

router.get(
  '/:id/jobs',
  authenticate,
  authorize('ADMIN', 'CLIENT'),
  param('id').trim().notEmpty().withMessage('Audit id is required'),
  validate,
  crawlerController.getAuditJobs
);

export default router;
