import { Router } from 'express';
import authenticate from '../../middleware/authenticate.middleware.js';
import authorize from '../../middleware/authorize.middleware.js';
import validate from '../../middleware/validate.middleware.js';
import * as authController from './auth.controller.js';
import {
  loginRules,
  logoutRules,
  refreshRules,
} from './auth.validator.js';

const router = Router();

router.post('/login', loginRules, validate, authController.login);
router.post('/refresh', refreshRules, validate, authController.refresh);
router.post('/logout', logoutRules, validate, authController.logout);
router.get('/me', authenticate, authController.me);

// RBAC probe used by admin portal guards / auth verification
router.get(
  '/admin-check',
  authenticate,
  authorize('ADMIN'),
  authController.adminCheck
);

export default router;
