import {
  UserSettingsError,
  getUserSettings,
  updateUserSettings,
} from '../services/userSettings.service.js';
import { getAuthenticatedUserId } from '../middleware/auth.middleware.js';

export async function getUserSettingsHandler(req, res) {
  try {
    const userId = getAuthenticatedUserId(req) ?? req.params.userId;
    const settings = await getUserSettings(userId);

    if (!settings) {
      return res.status(404).json({ message: 'User not found' });
    }

    return res.status(200).json(settings);
  } catch (error) {
    if (error instanceof UserSettingsError) {
      return res.status(error.statusCode).json({ message: error.message });
    }

    console.error('Get user settings error:', error);
    return res.status(500).json({ message: 'Failed to fetch user settings' });
  }
}

export async function updateUserSettingsHandler(req, res) {
  try {
    const userId = getAuthenticatedUserId(req) ?? req.params.userId;
    const { hide_from_leaderboard } = req.body ?? {};

    const settings = await updateUserSettings(userId, {
      hideFromLeaderboard: hide_from_leaderboard,
    });

    if (!settings) {
      return res.status(404).json({ message: 'User not found' });
    }

    return res.status(200).json(settings);
  } catch (error) {
    if (error instanceof UserSettingsError) {
      return res.status(error.statusCode).json({ message: error.message });
    }

    console.error('Update user settings error:', error);
    return res.status(500).json({ message: 'Failed to update user settings' });
  }
}
