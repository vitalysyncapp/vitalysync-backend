import express from 'express';
import { definition, history, latest, submit } from '../controllers/assessment.controller.js';

const router = express.Router();
router.get('/definition', definition);
router.post('/', submit);
router.get('/latest', latest);
router.get('/history', history);
export default router;
