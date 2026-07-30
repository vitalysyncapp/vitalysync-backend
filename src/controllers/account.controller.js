import { getAuthenticatedUserId } from '../middleware/auth.middleware.js';
import {
  AccountLifecycleError,
  clearAccountData,
  deactivateAccount,
  reactivateAccount,
} from '../services/accountLifecycle.service.js';
import { logApiError } from '../utils/errorLogging.js';

function lifecycleError(req, res, label, error) {
  if (error instanceof AccountLifecycleError) {
    return res.status(error.status).json({
      message: error.message,
      ...(error.code ? { code: error.code } : {}),
    });
  }
  logApiError(req, label, error);
  return res.status(500).json({
    message: 'Unable to update this account right now',
  });
}

export async function deactivate(req, res) {
  try {
    const result = await deactivateAccount({
      userId: getAuthenticatedUserId(req),
      currentPassword: req.body?.current_password,
      confirmation: req.body?.confirmation,
    });
    return res.status(200).json({
      message: 'Account deactivated successfully',
      reactivation_deadline: result.reactivation_deadline,
      retention_expires_at: result.retention_expires_at,
      sessions_revoked: true,
    });
  } catch (error) {
    return lifecycleError(req, res, 'Deactivate account error', error);
  }
}

export async function reactivate(req, res) {
  try {
    const session = await reactivateAccount({
      reactivationToken: req.body?.reactivation_token,
    });
    return res.status(200).json({
      message: 'Account reactivated successfully',
      ...session,
    });
  } catch (error) {
    return lifecycleError(req, res, 'Reactivate account error', error);
  }
}

export async function clearData(req, res) {
  try {
    await clearAccountData({
      userId: getAuthenticatedUserId(req),
      currentPassword: req.body?.current_password,
    });
    return res.status(200).json({
      message: 'Account data cleared successfully',
      sessions_revoked: true,
    });
  } catch (error) {
    return lifecycleError(req, res, 'Clear account data error', error);
  }
}
