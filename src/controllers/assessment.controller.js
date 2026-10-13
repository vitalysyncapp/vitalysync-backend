import { getAuthenticatedUserId } from '../middleware/auth.middleware.js';
import { AssessmentError, DEFINITION_ETAG, getAssessmentDefinition, requireAssessmentEnabled } from '../services/assessmentDefinition.js';
import { assessmentHistory, latestAssessment, submitAssessment } from '../services/assessment.service.js';

export function assessmentErrorResponse(error, res) {
  if (error instanceof AssessmentError) {
    return res.status(error.statusCode).json({
      message: error.message, code: error.code, ...(error.details ? { details: error.details } : {}),
    });
  }
  // Assessment payloads and raw SQL errors may contain sensitive answers.
  return res.status(500).json({ message: 'Unable to process assessment.', code: 'ASSESSMENT_SERVER_ERROR' });
}

export function definition(req, res) {
  try {
    requireAssessmentEnabled();
    const data = getAssessmentDefinition(req.query);
    res.set('ETag', DEFINITION_ETAG).set('Cache-Control', 'private, no-cache');
    if (req.get('If-None-Match') === DEFINITION_ETAG) return res.status(304).end();
    return res.json({ definition: data });
  } catch (error) { return assessmentErrorResponse(error, res); }
}

export async function submit(req, res) {
  try {
    // Existing auth middleware injects user_id. It is never trusted as ownership.
    const { user_id: ignoredOwner, ...payload } = req.body ?? {};
    const result = await submitAssessment(getAuthenticatedUserId(req), payload);
    return res.status(result.idempotent_replay ? 200 : 201).json(result);
  } catch (error) { return assessmentErrorResponse(error, res); }
}

export async function latest(req, res) {
  try {
    return res.json(await latestAssessment(getAuthenticatedUserId(req), { instrument: req.query.instrument }));
  } catch (error) { return assessmentErrorResponse(error, res); }
}

export async function history(req, res) {
  try {
    const { instrument, limit, cursor } = req.query;
    return res.json(await assessmentHistory(getAuthenticatedUserId(req), { instrument, limit, cursor }));
  } catch (error) { return assessmentErrorResponse(error, res); }
}
