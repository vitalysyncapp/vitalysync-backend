import assert from 'node:assert/strict';
import test from 'node:test';

import JSZip from 'jszip';

import { buildUserReportDocx } from '../src/services/reportDocument.service.js';
import {
  buildReportInsights,
  classifyReportMetric,
} from '../src/services/reportInsights.service.js';
import { buildReportMetrics } from '../src/services/reportMetrics.service.js';

const NOW = new Date('2026-07-26T12:00:00.000Z');

function dateDaysAgo(days) {
  const value = new Date(NOW);
  value.setUTCDate(value.getUTCDate() - days);
  return value.toISOString().slice(0, 10);
}

function sampleMetrics() {
  return buildReportMetrics({
    now: NOW,
    logs: [
      { log_date: dateDaysAgo(0), sleep_hours: 7, mood_index: 0, energy_level: 2 },
      { log_date: dateDaysAgo(6), sleep_hours: 8, mood_index: 4, energy_level: 4 },
      { log_date: dateDaysAgo(7), sleep_hours: 6, mood_index: null, energy_level: null },
      { log_date: dateDaysAgo(29), sleep_hours: null, mood_index: null, energy_level: null },
      { log_date: dateDaysAgo(30), sleep_hours: 5, mood_index: 1, energy_level: 2 },
      { log_date: dateDaysAgo(59), sleep_hours: 7, mood_index: 3, energy_level: 3 },
      { log_date: dateDaysAgo(60), sleep_hours: 9, mood_index: 4, energy_level: 5 },
      { log_date: dateDaysAgo(364), sleep_hours: 8, mood_index: 3, energy_level: 4 },
      { log_date: dateDaysAgo(365), sleep_hours: 2, mood_index: 0, energy_level: 1 },
    ],
    weeklyPulses: [
      { response_date: dateDaysAgo(0), perceived_pressure_level: 5, recovery_rest_level: 2, detachment_level: 4, productivity_focus_level: 2, accomplishment_level: 3 },
      { response_date: dateDaysAgo(14), perceived_pressure_level: 3, recovery_rest_level: 4, detachment_level: 2, productivity_focus_level: 4, accomplishment_level: 4 },
      { response_date: dateDaysAgo(35), perceived_pressure_level: 2, recovery_rest_level: 4, detachment_level: 2, productivity_focus_level: 4, accomplishment_level: 5 },
    ],
    exercises: [
      { log_date: dateDaysAgo(0), steps: 9000, active_minutes: 35, calories_burned: 400 },
      { log_date: dateDaysAgo(6), steps: null, active_minutes: 25, calories_burned: null },
      { log_date: dateDaysAgo(7), steps: 3000, active_minutes: 12, calories_burned: 150 },
      { log_date: dateDaysAgo(30), steps: 2000, active_minutes: 8, calories_burned: 100 },
    ],
    burnoutHistory: [
      {
        score_date: dateDaysAgo(0),
        burnout_score: 82,
        status_category: 'critical',
        emotional_exhaustion_score: 84,
        detachment_score: 62,
        reduced_accomplishment_score: 48,
      },
    ],
  });
}

test('report metrics use exact windows, a 1-5 mood scale, and logged-day activity averages', () => {
  const metrics = sampleMetrics();

  assert.equal(metrics.wellness.week.count, 2);
  assert.equal(metrics.wellness.month.count, 4);
  assert.equal(metrics.wellness.previousMonth.count, 2);
  assert.equal(metrics.wellness.year.count, 8);
  assert.equal(metrics.wellness.month.sleep, 7);
  assert.equal(metrics.wellness.month.mood, 3);
  assert.equal(metrics.wellness.month.stress, undefined);
  assert.equal(metrics.pulse.month.count, 2);
  assert.equal(metrics.pulse.month.pressure, 4);
  assert.equal(metrics.pulse.month.recoveryRest, 3);
  assert.equal(metrics.activity.week.steps, 9000);
  assert.equal(metrics.activity.week.activeMinutes, 30);
  assert.equal(metrics.activity.week.calories, 200);
  assert.equal(metrics.activity.month.steps, 6000);
  assert.equal(metrics.activity.month.calories, 183);
});

test('report indicators consistently map values to semantic colors', () => {
  assert.equal(classifyReportMetric('burnoutRisk', 'low').level, 'good');
  assert.equal(classifyReportMetric('burnoutRisk', 'moderate').level, 'okay');
  assert.equal(classifyReportMetric('burnoutRisk', 'high').level, 'high');
  assert.equal(classifyReportMetric('burnoutRisk', 'critical').level, 'high');
  assert.equal(classifyReportMetric('sleep', 7.5).level, 'good');
  assert.equal(classifyReportMetric('sleep', 6.5).level, 'okay');
  assert.equal(classifyReportMetric('sleep', 5.5).level, 'warning');
  assert.equal(classifyReportMetric('sleep', 4.5).level, 'high');
  assert.equal(classifyReportMetric('mood', 4).level, 'good');
  assert.equal(classifyReportMetric('mood', 3).level, 'okay');
  assert.equal(classifyReportMetric('mood', 2).level, 'warning');
  assert.equal(classifyReportMetric('mood', 1).level, 'high');
  assert.equal(classifyReportMetric('stress', null).level, 'unknown');
  assert.equal(classifyReportMetric('coverage', null).label, 'No data');
  assert.equal(classifyReportMetric('coverage', 0.1).label, 'Very limited data');
});

test('report insights describe table values and keep recommendations last in the document', async () => {
  const metrics = sampleMetrics();
  const insights = buildReportInsights(metrics);
  const buffer = await buildUserReportDocx({
    profile: { user: { username: 'Sample User', gender: 'Other', role: 'Student' } },
    metrics,
    insights,
    aiContent: {
      highlight: 'Stress is higher than the previous period while activity is mixed.',
      recommendations: ['Protect a short recovery block each day.', 'Keep logging to clarify the pattern.'],
    },
    reportDate: NOW,
  });
  const zip = await JSZip.loadAsync(buffer);
  const documentXml = await zip.file('word/document.xml').async('string');
  const stylesXml = await zip.file('word/styles.xml').async('string');
  const fontTableXml = await zip.file('word/fontTable.xml').async('string');
  const embeddedFont = zip.file('word/fonts/font1.odttf');

  assert.match(documentXml, /w:pgMar[^>]*w:top="567"[^>]*w:right="567"[^>]*w:bottom="567"[^>]*w:left="567"/);
  assert.doesNotMatch(documentXml, /Explanation|Main Drivers/);
  assert.doesNotMatch(documentXml, /w:type="pct"/);
  assert.ok(documentXml.indexOf('Recommendations') > documentXml.indexOf('Exercise and activity'));
  assert.ok(documentXml.indexOf('Recommendations') > documentXml.indexOf('This report supports personal wellness tracking'));
  assert.match(documentXml, /The latest burnout result is 82\/100 with a critical status/);
  assert.match(documentXml, /AI-generated highlight/);
  assert.match(documentXml, /Mood averaged 3\/5/);
  assert.match(documentXml, /Weekly pulse context/);
  assert.match(documentXml, /Pressure/);
  assert.match(documentXml, /Avg calories\/logged day/);

  for (const color of ['2E7D32', '1565C0', '9A6700', 'C62828', '6A1B9A']) {
    assert.match(documentXml, new RegExp(color));
  }

  const firstHeaderRow = documentXml.match(/<w:tr[\s\S]*?<w:t[^>]*>Metric<\/w:t>[\s\S]*?<\/w:tr>/)?.[0];
  assert.ok(firstHeaderRow);
  assert.doesNotMatch(firstHeaderRow, /<w:shd/);
  const activityWeekRow = documentXml
    .match(/<w:tr[\s\S]*?<\/w:tr>/g)
    ?.find((row) => row.includes('9000') && row.includes('30 min'));
  assert.ok(activityWeekRow);
  assert.doesNotMatch(activityWeekRow, /Good|Okay|Warning|High risk/);
  assert.match(stylesXml, /w:styleId="Heading1"[\s\S]*?w:color w:val="000000"/);
  assert.match(stylesXml, /w:rFonts[^>]*w:ascii="Inter"[^>]*w:hAnsi="Inter"/);
  assert.match(fontTableXml, /w:font w:name="Inter"[\s\S]*?w:embedRegular/);
  assert.ok(embeddedFont);
  assert.ok((await embeddedFont.async('nodebuffer')).length > 0);
});
