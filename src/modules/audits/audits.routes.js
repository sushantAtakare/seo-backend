import { Router } from 'express';
import authenticate from '../../middleware/authenticate.middleware.js';
import authorize from '../../middleware/authorize.middleware.js';
import validate from '../../middleware/validate.middleware.js';
import * as auditsController from './audits.controller.js';
import {
  auditIdParam,
  createAuditRules,
  listAuditRules,
  updateAuditRules,
} from './audits.validator.js';

const router = Router();

router.use(authenticate);

router.post(
  '/',
  authorize('ADMIN', 'CLIENT'),
  createAuditRules,
  validate,
  auditsController.createAudit
);

router.get(
  '/',
  authorize('ADMIN', 'CLIENT'),
  listAuditRules,
  validate,
  auditsController.listAudits
);

router.get(
  '/:id',
  authorize('ADMIN', 'CLIENT'),
  auditIdParam,
  validate,
  auditsController.getAudit
);

router.patch(
  '/:id',
  authorize('ADMIN'),
  updateAuditRules,
  validate,
  auditsController.updateAudit
);

router.delete(
  '/:id',
  authorize('ADMIN'),
  auditIdParam,
  validate,
  auditsController.deleteAudit
);

export default router;
