import { Router } from 'express';
import authenticate from '../../middleware/authenticate.middleware.js';
import authorize from '../../middleware/authorize.middleware.js';
import validate from '../../middleware/validate.middleware.js';
import * as sitesController from './sites.controller.js';
import { siteIdParam, updateSiteRules } from './sites.validator.js';

const router = Router();

router.use(authenticate);

router.get(
  '/:id',
  authorize('ADMIN', 'CLIENT'),
  siteIdParam,
  validate,
  sitesController.getSite
);

router.patch(
  '/:id',
  authorize('ADMIN'),
  updateSiteRules,
  validate,
  sitesController.updateSite
);

router.delete(
  '/:id',
  authorize('ADMIN'),
  siteIdParam,
  validate,
  sitesController.deleteSite
);

export default router;
