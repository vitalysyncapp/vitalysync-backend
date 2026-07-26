import express from 'express';
import { exportUserReport } from '../controllers/report.controller.js';
import { rateLimiters } from '../middleware/rateLimit.middleware.js';

const router = express.Router();

router.get('/export', rateLimiters.reportExport, exportUserReport);
router.get('/export/:userId', rateLimiters.reportExport, exportUserReport);

export default router;
