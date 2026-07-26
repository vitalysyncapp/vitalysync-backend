import express from 'express';
import multer from 'multer';

import { enforceAuthenticatedUser } from '../middleware/auth.middleware.js';
import { rateLimiters } from '../middleware/rateLimit.middleware.js';

import {
  analyzeNutrition,
  confirmNutrition,
  discardNutritionAttempt,
  getAssistantNutritionNudge,
  getDailyNutrition,
  getNutritionHistory,
} from '../controllers/nutrition.controller.js';

const router = express.Router();
const OPENAI_SUPPORTED_IMAGE_MIMES = new Set([
  'image/jpeg',
  'image/png',
  'image/webp',
]);

const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: 8 * 1024 * 1024,
    files: 1,
    fields: 16,
    parts: 18,
    fieldSize: 32 * 1024,
  },
});

function detectImageMime(buffer) {
  if (!Buffer.isBuffer(buffer) || buffer.length < 4) {
    return null;
  }

  if (isValidJpeg(buffer)) {
    return 'image/jpeg';
  }

  if (
    buffer.length >= 33 &&
    buffer[0] === 0x89 &&
    buffer[1] === 0x50 &&
    buffer[2] === 0x4e &&
    buffer[3] === 0x47 &&
    buffer[4] === 0x0d &&
    buffer[5] === 0x0a &&
    buffer[6] === 0x1a &&
    buffer[7] === 0x0a &&
    buffer.toString('ascii', 12, 16) === 'IHDR' &&
    buffer.readUInt32BE(16) > 0 &&
    buffer.readUInt32BE(20) > 0 &&
    buffer.readUInt32BE(buffer.length - 12) === 0 &&
    buffer.toString('ascii', buffer.length - 8, buffer.length - 4) === 'IEND'
  ) {
    return 'image/png';
  }

  if (
    buffer.length >= 20 &&
    buffer.toString('ascii', 0, 4) === 'RIFF' &&
    buffer.toString('ascii', 8, 12) === 'WEBP' &&
    buffer.readUInt32LE(4) + 8 === buffer.length &&
    ['VP8 ', 'VP8L', 'VP8X'].includes(buffer.toString('ascii', 12, 16))
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

function isValidJpeg(buffer) {
  if (
    buffer.length < 12 ||
    buffer[0] !== 0xff ||
    buffer[1] !== 0xd8 ||
    buffer[buffer.length - 2] !== 0xff ||
    buffer[buffer.length - 1] !== 0xd9
  ) {
    return false;
  }

  let offset = 2;
  let hasFrame = false;
  while (offset < buffer.length - 2) {
    if (buffer[offset] !== 0xff) {
      return false;
    }
    while (buffer[offset] === 0xff) {
      offset += 1;
    }

    const marker = buffer[offset];
    offset += 1;
    if (marker === 0xd9) {
      break;
    }
    if (marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) {
      continue;
    }
    if (offset + 2 > buffer.length - 2) {
      return false;
    }

    const segmentLength = buffer.readUInt16BE(offset);
    if (segmentLength < 2 || offset + segmentLength > buffer.length - 2) {
      return false;
    }

    const isFrameMarker =
      marker >= 0xc0 &&
      marker <= 0xcf &&
      ![0xc4, 0xc8, 0xcc].includes(marker);
    if (isFrameMarker) {
      if (
        segmentLength < 7 ||
        buffer.readUInt16BE(offset + 3) === 0 ||
        buffer.readUInt16BE(offset + 5) === 0
      ) {
        return false;
      }
      hasFrame = true;
    }

    if (marker === 0xda) {
      return hasFrame;
    }
    offset += segmentLength;
  }

  return false;
}

function uploadImage(req, res, next) {
  upload.single('image')(req, res, (error) => {
    if (error) {
      const isTooLarge = error.code === 'LIMIT_FILE_SIZE';
      return res.status(isTooLarge ? 413 : 400).json({
        message: isTooLarge
          ? 'Food photo must be smaller than 8 MB'
          : error.message || 'Invalid image upload',
      });
    }

    if (req.file) {
      const detectedMime = detectImageMime(req.file.buffer);

      if (!detectedMime) {
        return res.status(400).json({
          message: 'Upload a valid food photo',
        });
      }

      if (!OPENAI_SUPPORTED_IMAGE_MIMES.has(detectedMime)) {
        return res.status(415).json({
          message: 'Use a JPEG, PNG, or WebP food photo',
        });
      }

      req.file.mimetype = detectedMime;
    }

    return next();
  });
}

router.post(
  '/analyze',
  rateLimiters.nutritionAnalysis,
  uploadImage,
  enforceAuthenticatedUser,
  analyzeNutrition
);
router.post('/confirm', confirmNutrition);
router.post('/discard-attempt', discardNutritionAttempt);
router.get(
  '/assistant-nudge',
  rateLimiters.aiNudge,
  getAssistantNutritionNudge
);
router.get('/daily', getDailyNutrition);
router.get('/history', getNutritionHistory);

export default router;
