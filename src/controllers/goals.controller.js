import {
  GoalsServiceError,
  getUserGoals as fetchUserGoals,
  upsertUserGoals,
} from '../services/goals.service.js';
import { getAuthenticatedUserId } from '../middleware/auth.middleware.js';

export async function getUserGoals(req, res) {
  try {
    const userId = getAuthenticatedUserId(req) ?? req.params.userId;
    const payload = await fetchUserGoals(userId);

    if (!payload) {
      return res.status(404).json({ message: 'User not found' });
    }

    return res.status(200).json(payload);
  } catch (error) {
    if (error instanceof GoalsServiceError) {
      return res.status(error.statusCode).json({ message: error.message });
    }

    console.error('Get user goals error:', error);
    return res.status(500).json({ message: 'Failed to fetch user goals' });
  }
}

export async function updateUserGoals(req, res) {
  try {
    const userId = getAuthenticatedUserId(req) ?? req.params.userId;
    const payload = await upsertUserGoals(userId, req.body);
    return res.status(200).json({
      message: 'Goals updated successfully',
      ...payload,
    });
  } catch (error) {
    if (error instanceof GoalsServiceError) {
      return res.status(error.statusCode).json({ message: error.message });
    }

    console.error('Update user goals error:', error);
    return res.status(500).json({ message: 'Failed to update user goals' });
  }
}
