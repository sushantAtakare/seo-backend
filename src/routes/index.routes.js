import { Router } from 'express';
import { getApiInfo } from '../controllers/health.controller.js';

const router = Router();

router.get('/', getApiInfo);

export default router;
