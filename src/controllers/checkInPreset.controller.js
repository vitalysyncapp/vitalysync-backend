import { getAuthenticatedUserId } from '../middleware/auth.middleware.js';
import {
  CheckInPresetError,
  createCheckInPreset,
  deleteCheckInPreset,
  listCheckInPresets,
  updateCheckInPreset,
} from '../services/checkInPreset.service.js';

function sendError(res, error, fallbackMessage) {
  if (error instanceof CheckInPresetError) {
    return res.status(error.statusCode).json({ message: error.message });
  }
  console.error(fallbackMessage, error);
  return res.status(500).json({ message: fallbackMessage });
}

export async function getCheckInPresets(req, res) {
  try {
    const presets = await listCheckInPresets(getAuthenticatedUserId(req));
    return res.status(200).json({ presets });
  } catch (error) {
    return sendError(res, error, 'Failed to fetch check-in presets');
  }
}

export async function createCheckInPresetHandler(req, res) {
  try {
    const preset = await createCheckInPreset(
      getAuthenticatedUserId(req),
      req.body
    );
    return res.status(201).json({
      message: 'Check-in preset created successfully',
      preset,
    });
  } catch (error) {
    return sendError(res, error, 'Failed to create check-in preset');
  }
}

export async function updateCheckInPresetHandler(req, res) {
  try {
    const preset = await updateCheckInPreset(
      getAuthenticatedUserId(req),
      req.params.presetId,
      req.body
    );
    return res.status(200).json({
      message: 'Check-in preset updated successfully',
      preset,
    });
  } catch (error) {
    return sendError(res, error, 'Failed to update check-in preset');
  }
}

export async function deleteCheckInPresetHandler(req, res) {
  try {
    const presetId = await deleteCheckInPreset(
      getAuthenticatedUserId(req),
      req.params.presetId
    );
    return res.status(200).json({
      message: 'Check-in preset deleted successfully',
      preset_id: presetId,
    });
  } catch (error) {
    return sendError(res, error, 'Failed to delete check-in preset');
  }
}
