import { Router } from 'express';
import authenticate from '../../middleware/authenticate.middleware.js';
import authorize from '../../middleware/authorize.middleware.js';
import validate from '../../middleware/validate.middleware.js';
import * as clientsController from './clients.controller.js';
import {
  clientIdParam,
  createClientRules,
  updateClientRules,
} from './clients.validator.js';
import * as sitesController from '../sites/sites.controller.js';
import {
  clientIdParam as siteClientIdParam,
  createSiteRules,
} from '../sites/sites.validator.js';

const router = Router();

router.use(authenticate);

router.post(
  '/',
  authorize('ADMIN'),
  createClientRules,
  validate,
  clientsController.createClient
);

router.get('/', authorize('ADMIN'), clientsController.listClients);

router.post(
  '/:clientId/sites',
  authorize('ADMIN'),
  createSiteRules,
  validate,
  sitesController.createSite
);

router.get(
  '/:clientId/sites',
  authorize('ADMIN', 'CLIENT'),
  siteClientIdParam,
  validate,
  sitesController.listSites
);

router.get(
  '/:id',
  authorize('ADMIN', 'CLIENT'),
  clientIdParam,
  validate,
  clientsController.getClient
);

router.patch(
  '/:id',
  authorize('ADMIN'),
  updateClientRules,
  validate,
  clientsController.updateClient
);

router.delete(
  '/:id',
  authorize('ADMIN'),
  clientIdParam,
  validate,
  clientsController.deleteClient
);

export default router;
