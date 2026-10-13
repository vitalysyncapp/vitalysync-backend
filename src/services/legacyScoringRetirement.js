// Release-level retirement is permanent, independent of the CBI rollout switch.
// Disabling assessment submissions must never restart the retired formula.
export const legacyScoringRetirement = Object.freeze({
  code: 'LEGACY_SCORING_RETIRED',
  message: 'This assessment method has been retired. Update the app to submit a CBI assessment.'
});

export function rejectLegacyScoring() {
  throw Object.assign(new Error(legacyScoringRetirement.message), {
    statusCode: 410,
    code: legacyScoringRetirement.code
  });
}

export function retiredScoringResponse(_req, res) {
  return res.status(410).json(legacyScoringRetirement);
}
