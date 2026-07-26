import express from 'express';
import { exportUserReport } from '../controllers/report.controller.js';

const router = express.Router();

router.get('/export', exportUserReport);
router.get('/export/:userId', exportUserReport);

export default router;
