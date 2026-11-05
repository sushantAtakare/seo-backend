import { Router } from 'express';
import authenticate from '../../middleware/authenticate.middleware.js';
import authorize from '../../middleware/authorize.middleware.js';
import validate from '../../middleware/validate.middleware.js';
import * as crawlerController from './crawler.controller.js';
import { crawlAuditRules } from './crawler.validator.js';

const router = Router();

router.post(
  '/:id/crawl',
  authenticate,
  authorize('ADMIN', 'CLIENT'),
  crawlAuditRules,
  validate,
  crawlerController.crawlAudit
);

export default router;
