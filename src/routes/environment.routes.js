import express from 'express';

import { getEnvironmentSnapshot } from '../controllers/environment.controller.js';

const router = express.Router();

router.get('/', getEnvironmentSnapshot);

export default router;
