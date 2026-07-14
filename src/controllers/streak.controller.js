import {
  StreakServiceError,
  readLeaderboard,
  readStreakOverview,
} from '../services/streak.service.js';

export async function getStreakOverview(req, res) {
  try {
    const payload = await readStreakOverview(req.params.userId);

    if (!payload) {
      return res.status(404).json({ message: 'User not found' });
    }

    return res.status(200).json(payload);
  } catch (error) {
    if (error instanceof StreakServiceError) {
      return res.status(error.statusCode).json({
        message: error.message,
        ...error.details,
      });
    }

    console.error('Get streak overview error:', error);
    return res.status(500).json({ message: 'Failed to fetch streak overview' });
  }
}

export async function getStreakLeaderboard(req, res) {
  try {
    const payload = await readLeaderboard(req.params.userId, {
      section: String(req.query.section ?? 'global'),
      metric: String(req.query.metric ?? 'current'),
      limit: req.query.limit,
    });

    if (!payload) {
      return res.status(404).json({ message: 'User not found' });
    }

    return res.status(200).json(payload);
  } catch (error) {
    if (error instanceof StreakServiceError) {
      return res.status(error.statusCode).json({
        message: error.message,
        ...error.details,
      });
    }

    console.error('Get streak leaderboard error:', error);
    return res.status(500).json({ message: 'Failed to fetch streak leaderboard' });
  }
}
