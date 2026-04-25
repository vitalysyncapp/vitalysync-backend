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
});

function detectImageMime(buffer) {
  if (!Buffer.isBuffer(buffer) || buffer.length < 4) {
    return null;
  }

  if (buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) {
    return 'image/jpeg';
  }

  if (
    buffer.length >= 8 &&
    buffer[0] === 0x89 &&
    buffer[1] === 0x50 &&
    buffer[2] === 0x4e &&
    buffer[3] === 0x47 &&
    buffer[4] === 0x0d &&
    buffer[5] === 0x0a &&
    buffer[6] === 0x1a &&
    buffer[7] === 0x0a
  ) {
    return 'image/png';
  }

  if (
    buffer.length >= 12 &&
    buffer.toString('ascii', 0, 4) === 'RIFF' &&
    buffer.toString('ascii', 8, 12) === 'WEBP'
  ) {
    return 'image/webp';
  }

  const gifHeader = buffer.length >= 6 ? buffer.toString('ascii', 0, 6) : '';
  if (gifHeader === 'GIF87a' || gifHeader === 'GIF89a') {
    return 'image/gif';
  }

  if (buffer[0] === 0x42 && buffer[1] === 0x4d) {
    return 'image/bmp';
  }

  if (buffer.length >= 12 && buffer.toString('ascii', 4, 8) === 'ftyp') {
    const brand = buffer.toString('ascii', 8, 12);
    if (['heic', 'heix', 'hevc', 'hevx'].includes(brand)) {
      return 'image/heic';
    }
    if (['mif1', 'msf1'].includes(brand)) {
      return 'image/heif';
    }
    if (brand === 'avif') {
      return 'image/avif';
    }
  }

  return null;
}

function uploadImage(req, res, next) {
  upload.single('image')(req, res, (error) => {
    if (error) {
      return res.status(400).json({
        message: error.message || 'Invalid image upload',
      });
    }

    if (req.file) {
      const detectedMime = detectImageMime(req.file.buffer);
      const declaredMime = String(req.file.mimetype ?? '').toLowerCase();

      if (!detectedMime && !declaredMime.startsWith('image/')) {
        return res.status(400).json({
          message: 'Only image uploads are allowed',
        });
      }

      req.file.mimetype = detectedMime ?? declaredMime;
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
