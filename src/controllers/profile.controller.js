import {
  OnboardingServiceError,
  getUserProfileSummary
} from '../services/onboarding.service.js';

export async function getProfile(req, res) {
  try {
    const profile = await getUserProfileSummary(req.params.userId);

    if (!profile) {
      return res.status(404).json({ message: 'User not found' });
    }

    return res.status(200).json(profile);
  } catch (error) {
    if (error instanceof OnboardingServiceError) {
      return res.status(error.statusCode).json({ message: error.message });
    }

    console.error('Get profile error:', error);
    return res.status(500).json({ message: 'Failed to fetch profile' });
  }
}
