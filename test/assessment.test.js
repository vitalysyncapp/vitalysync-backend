import assert from 'node:assert/strict';
import test from 'node:test';
import { randomUUID } from 'node:crypto';
import { ASSESSMENT_IDENTITY, CBI_DEFINITION, getAssessmentDefinition, isAssessmentEnabled, requireAssessmentEnabled } from '../src/services/assessmentDefinition.js';
import { scorePersonalBurnout } from '../src/services/assessmentScoring.js';
import { prepareAssessment, submitAssessment } from '../src/services/assessment.service.js';

const answers = (values) => values.map((response, i) => ({ question_id: `PB${i + 1}`, response }));
const payload = () => ({ ...ASSESSMENT_IDENTITY, submission_id: randomUUID(),
  completed_at: '2026-10-13T12:00:00.000Z', answers: answers([1, 2, 3, 4, 5, 1]) });

test('CBI endpoints and mixed responses follow the exact ascending mapping without reversal', () => {
  for (const [response, expected] of [[1, 0], [3, 50], [5, 100]]) {
    assert.equal(scorePersonalBurnout(answers(Array(6).fill(response))).score, expected);
  }
  const mixed = scorePersonalBurnout(answers([1, 2, 3, 4, 5, 1]));
  assert.equal(mixed.mapped_total, 250);
  assert.equal(mixed.display_score, '41.7');
  assert.deepEqual(scorePersonalBurnout([...answers([1, 2, 3, 4, 5, 1]),
    { question_id: 'context2', response: 5 }, { question_id: 'context4', response: 1 }]), mixed);
});

test('published missing-item scoring is distinct from complete-six submission policy', () => {
  assert.equal(scorePersonalBurnout([]).score, null);
  assert.equal(scorePersonalBurnout(answers([5, 5])).score, null);
  assert.equal(scorePersonalBurnout(answers([1, 3, 5])).score, 50);
  assert.equal(scorePersonalBurnout(answers([1, 1, 1, 2])).display_score, '6.3');
  assert.throws(() => prepareAssessment({ ...payload(), answers: answers([1, 3, 5]) }), { code: 'ASSESSMENT_INCOMPLETE' });
});

test('answers reject coercion, unknown IDs, duplicates and injected scores', () => {
  for (const value of [null, '3', true, 0, 6, 2.5, NaN]) {
    assert.throws(() => scorePersonalBurnout(answers([value])), { code: 'INVALID_ASSESSMENT_RESPONSE' });
  }
  for (const invalid of [[...answers([1]), ...answers([2])], [{ question_id: 'ee_01', response: 3 }],
    [{ question_id: 'PB1', response: 3, score: 100 }]]) {
    assert.throws(() => scorePersonalBurnout(invalid), { code: 'INVALID_ASSESSMENT_PAYLOAD' });
  }
  assert.throws(() => prepareAssessment({ ...payload(), result: { score: 0 } }), { code: 'INVALID_ASSESSMENT_PAYLOAD' });
});

test('version identity and real timezone-bearing completion dates are mandatory', () => {
  for (const key of Object.keys(ASSESSMENT_IDENTITY)) {
    assert.throws(() => prepareAssessment({ ...payload(), [key]: 'unsupported' }), { code: 'UNSUPPORTED_ASSESSMENT_VERSION' });
  }
  for (const completed_at of ['2026-02-30T12:00:00Z', '2026-10-13', '2026-10-13T12:00:00', 'bad']) {
    assert.throws(() => prepareAssessment({ ...payload(), completed_at }), { code: 'INVALID_COMPLETION_TIME' });
  }
  assert.throws(() => getAssessmentDefinition({ definition_version: 'old' }), { code: 'UNSUPPORTED_ASSESSMENT_VERSION' });
});

test('canonical fingerprints ignore answer order, JSON key order and equivalent timestamp offsets', () => {
  const first = payload();
  const second = { ...first, completed_at: '2026-10-13T20:00:00+08:00', answers: [...first.answers].reverse() };
  assert.equal(prepareAssessment(first).request_fingerprint, prepareAssessment(second).request_fingerprint);
  second.answers = answers([5, 2, 3, 4, 5, 1]);
  assert.notEqual(prepareAssessment(first).request_fingerprint, prepareAssessment(second).request_fingerprint);
});

test('release defaults to enabled while an explicit off switch rejects before database work', async () => {
  const previous = process.env.CBI_ASSESSMENT_ENABLED;
  delete process.env.CBI_ASSESSMENT_ENABLED;
  try {
    assert.equal(isAssessmentEnabled(), true);
    assert.doesNotThrow(requireAssessmentEnabled);
    process.env.CBI_ASSESSMENT_ENABLED = 'false';
    assert.equal(isAssessmentEnabled(), false);
    await assert.rejects(submitAssessment(1, payload(), { db: { connect() { assert.fail('Database touched'); } } }),
      { code: 'ASSESSMENT_NOT_ENABLED', statusCode: 503 });
    process.env.CBI_ASSESSMENT_ENABLED = 'true';
    assert.doesNotThrow(requireAssessmentEnabled);
    process.env.CBI_ASSESSMENT_ENABLED = 'invalid';
    assert.throws(requireAssessmentEnabled, { code: 'ASSESSMENT_NOT_ENABLED' });
  } finally {
    if (previous === undefined) delete process.env.CBI_ASSESSMENT_ENABLED;
    else process.env.CBI_ASSESSMENT_ENABLED = previous;
  }
});

test('English definition and all response labels are frozen', () => {
  assert.deepEqual(CBI_DEFINITION.presentation_order, ['PB1', 'PB2', 'context1', 'PB3', 'context2', 'PB4', 'context3', 'PB5', 'context4', 'PB6']);
  assert.deepEqual(CBI_DEFINITION.response_options.map((option) => option.label), ['Never/almost never', 'Seldom', 'Sometimes', 'Often', 'Always']);
  assert.throws(() => { CBI_DEFINITION.items[0].text = 'changed'; }, TypeError);
});
