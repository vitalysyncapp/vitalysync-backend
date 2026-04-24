import express from 'express';
import multer from 'multer';

import {
  analyzeNutrition,
  confirmNutrition,
  discardNutritionAttempt,
  getDailyNutrition,
  getNutritionHistory,
} from '../controllers/nutrition.controller.js';

const router = express.Router();

const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: 8 * 1024 * 1024,
  },
  fileFilter: (_req, file, cb) => {
    if (file.mimetype?.startsWith('image/')) {
      cb(null, true);
      return;
    }

    cb(new Error('Only image uploads are allowed'));
  },
});

function uploadImage(req, res, next) {
  upload.single('image')(req, res, (error) => {
    if (error) {
      return res.status(400).json({
        message: error.message || 'Invalid image upload',
      });
    }

    return next();
  });
}

router.post('/analyze', uploadImage, analyzeNutrition);
router.post('/confirm', confirmNutrition);
router.post('/discard-attempt', discardNutritionAttempt);
router.get('/daily', getDailyNutrition);
router.get('/history', getNutritionHistory);

export default router;
