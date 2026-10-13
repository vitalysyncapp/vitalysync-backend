import {
  AlignmentType,
  BorderStyle,
  Document,
  HeadingLevel,
  LevelFormat,
  PageOrientation,
  Packer,
  Paragraph,
  ShadingType,
  Table,
  TableCell,
  TableLayoutType,
  TableRow,
  TextRun,
  VerticalAlign,
  WidthType,
} from 'docx';
import { readFile } from 'node:fs/promises';

import { formatDateOnly } from './burnoutScoringEngine.js';
import { reportText } from '../i18n/reportCopy.js';

const PAGE_WIDTH = 12240;
const PAGE_HEIGHT = 15840;
const ONE_CENTIMETER = 567;
const TABLE_INDENT = 120;
const TABLE_WIDTH = PAGE_WIDTH - (ONE_CENTIMETER * 2) - TABLE_INDENT;
const REPORT_FONT = 'Inter';
const REPORT_FONT_URL = new URL('../../assets/fonts/Inter-Regular.ttf', import.meta.url);

const COLORS = {
  ink: '1F2937',
  muted: '5F6368',
  border: 'DADCE0',
  good: { text: '2E7D32', fill: 'E8F5E9' },
  okay: { text: '1565C0', fill: 'E3F2FD' },
  warning: { text: '9A6700', fill: 'FFF3CD' },
  high: { text: 'C62828', fill: 'FDECEC' },
  unknown: { text: '6B7280', fill: 'F3F4F6' },
  ai: { text: '6A1B9A', fill: 'F3E8FF' },
};

const TABLE_BORDERS = {
  top: { style: BorderStyle.SINGLE, size: 4, color: COLORS.border },
  bottom: { style: BorderStyle.SINGLE, size: 4, color: COLORS.border },
  left: { style: BorderStyle.SINGLE, size: 4, color: COLORS.border },
  right: { style: BorderStyle.SINGLE, size: 4, color: COLORS.border },
  insideHorizontal: { style: BorderStyle.SINGLE, size: 4, color: COLORS.border },
  insideVertical: { style: BorderStyle.SINGLE, size: 4, color: COLORS.border },
};

const PERIOD_ROWS = [
  ['week', 'Last 7 days'],
  ['month', 'Last 30 days'],
  ['previousMonth', 'Previous 30 days'],
  ['year', 'Last 365 days'],
];

function run(text, options = {}) {
  return new TextRun({
    text: String(text),
    font: REPORT_FONT,
    size: 21,
    color: COLORS.ink,
    ...options,
  });
}

function bodyParagraph(children, options = {}) {
  return new Paragraph({
    style: 'Normal',
    spacing: { after: 120, line: 276 },
    children: Array.isArray(children) ? children : [run(children)],
    ...options,
  });
}

function heading(text, level = HeadingLevel.HEADING_1) {
  return new Paragraph({
    heading: level,
    keepNext: true,
    children: [run(text, { bold: true, color: '000000' })],
  });
}

function tableParagraph(children, alignment = AlignmentType.LEFT) {
  return new Paragraph({
    style: 'ReportTableText',
    alignment,
    spacing: { before: 0, after: 0, line: 240 },
    children,
  });
}

function tableCell(width, paragraphs, options = {}) {
  return new TableCell({
    width: { size: width, type: WidthType.DXA },
    margins: { top: 100, bottom: 100, left: 120, right: 120 },
    verticalAlign: VerticalAlign.CENTER,
    children: paragraphs,
    ...options,
  });
}

function headerCell(text, width, alignment = AlignmentType.CENTER) {
  return tableCell(
    width,
    [tableParagraph([run(text, { bold: true, size: 19, color: '000000' })], alignment)],
  );
}

function plainCell(text, width, alignment = AlignmentType.LEFT) {
  return tableCell(
    width,
    [tableParagraph([run(text, { size: 19 })], alignment)],
  );
}

function semanticCell(valueText, metric, value, width, options = {}) {
  return plainCell(valueText, width, AlignmentType.CENTER);
}

function reportTable(headers, widths, rows) {
  return new Table({
    width: { size: TABLE_WIDTH, type: WidthType.DXA },
    indent: { size: TABLE_INDENT, type: WidthType.DXA },
    columnWidths: widths,
    layout: TableLayoutType.FIXED,
    borders: TABLE_BORDERS,
    margins: { top: 100, bottom: 100, left: 120, right: 120 },
    rows: [
      new TableRow({
        tableHeader: true,
        cantSplit: true,
        children: headers.map((header, index) => headerCell(header, widths[index])),
      }),
      ...rows,
    ],
  });
}

function format(value, suffix = '') {
  return value == null ? 'N/A' : `${value}${suffix}`;
}

function assessmentTable(metrics) {
  const widths = [4000, 2500, TABLE_WIDTH - 6500];
  const records = metrics.assessments ?? [];
  return reportTable(['Completed at (UTC)', 'CBI Personal Burnout', 'Status / scoring version'], widths,
    (records.length ? records : [null]).map((item) => new TableRow({ cantSplit: true, children: [
      plainCell(item ? new Date(item.completed_at).toISOString() : 'No completed assessment', widths[0]),
      plainCell(item ? `${Number(item.cbi_score).toFixed(1)} / 100` : 'Not available', widths[1]),
      plainCell(item ? `${item.completion_status} / ${item.scoring_version}` : 'Not available', widths[2])
    ] })));
}

function legacyTable(metrics) {
  const widths = [4000, 2500, TABLE_WIDTH - 6500];
  return reportTable(['Legacy date', 'Stored composite', 'Stored legacy label'], widths,
    (metrics.legacyHistory ?? []).map((item) => new TableRow({ cantSplit: true, children: [
      plainCell(formatDateOnly(item.score_date), widths[0]),
      plainCell(format(item.burnout_score, ' / 100'), widths[1]),
      plainCell(item.status_category ?? 'Not available', widths[2])
    ] })));
}

function observed(value, suffix, count) {
  return `${format(value, suffix)} (${count ?? 0} days)`;
}

function wellnessTable(metrics, locale) {
  const widths = [2700, 1900, 1900, 1900, TABLE_WIDTH - 8400];
  const rows = PERIOD_ROWS.map(([key, label]) => {
    const period = metrics.wellness[key];
    return new TableRow({
      cantSplit: true,
      children: [
        plainCell(reportText(label, locale), widths[0]),
        semanticCell(observed(period.sleep, ' h', period.sleepDays), 'sleep', period.sleep, widths[1], { locale }),
        semanticCell(observed(period.mood, '/5', period.moodDays), 'mood', period.mood, widths[2], { locale }),
        semanticCell(observed(period.energy, '/5', period.energyDays), 'energy', period.energy, widths[3], { locale }),
        semanticCell(
          `${period.count}/${period.expectedDays}`,
          'coverage',
          period.count / period.expectedDays,
          widths[4],
          { compactCoverageLabel: true, locale },
        ),
      ],
    });
  });

  return reportTable(
    ['Period', 'Sleep', 'Mood', 'Energy', 'Logged days'].map((item) => reportText(item, locale)),
    widths,
    rows,
  );
}

function weeklyPulseTable(metrics, locale) {
  const widths = [1800, 1450, 1450, 1450, 1450, 1450, TABLE_WIDTH - 9050];
  const rows = PERIOD_ROWS.map(([key, label]) => {
    const period = metrics.pulse[key];
    return new TableRow({
      cantSplit: true,
      children: [
        plainCell(reportText(label, locale), widths[0]),
        semanticCell(format(period.pressure, '/5'), 'stress', period.pressure, widths[1], { locale }),
        semanticCell(format(period.recoveryRest, '/5'), 'likertHighGood', period.recoveryRest, widths[2], { locale }),
        semanticCell(format(period.detachment, '/5'), 'stress', period.detachment, widths[3], { locale }),
        semanticCell(format(period.productivityFocus, '/5'), 'likertHighGood', period.productivityFocus, widths[4], { locale }),
        semanticCell(format(period.accomplishment, '/5'), 'likertHighGood', period.accomplishment, widths[5], { locale }),
        semanticCell(
          `${period.count}/${period.expectedPulses}`,
          'coverage',
          period.count / period.expectedPulses,
          widths[6],
          { compactCoverageLabel: true, locale },
        ),
      ],
    });
  });

  return reportTable(
    ['Period', 'Pressure', 'Recovery', 'Detachment', 'Focus', 'Accomplishment', 'Pulses'].map((item) => reportText(item, locale)),
    widths,
    rows,
  );
}

function activityTable(metrics, locale) {
  const widths = [2400, 2100, 2300, 2300, TABLE_WIDTH - 9100];
  const rows = PERIOD_ROWS.map(([key, label]) => {
    const period = metrics.activity[key];
    return new TableRow({
      cantSplit: true,
      children: [
        plainCell(reportText(label, locale), widths[0]),
        semanticCell(
          observed(period.steps, '', period.stepsDays),
          'steps',
          period.steps,
          widths[1],
          { appendLabel: false, locale },
        ),
        semanticCell(
          observed(period.activeMinutes, ' min', period.activeMinutesDays),
          'activeMinutes',
          period.activeMinutes,
          widths[2],
          { appendLabel: false, locale },
        ),
        plainCell(observed(period.calories, '', period.caloriesDays), widths[3], AlignmentType.CENTER),
        semanticCell(
          `${period.count}/${period.expectedDays}`,
          'coverage',
          period.count / period.expectedDays,
          widths[4],
          { compactCoverageLabel: true, locale },
        ),
      ],
    });
  });

  return reportTable(
    ['Period', 'Avg recorded steps', 'Avg active time', 'Avg recorded calories', 'Logged days'].map((item) => reportText(item, locale)),
    widths,
    rows,
  );
}

function insightParagraph(text, level, locale) {
  const palette = COLORS[level] ?? COLORS.unknown;
  return bodyParagraph([
    run(reportText('Insight: ', locale), { bold: true, color: '000000' }),
    run(text, { color: palette.text }),
  ], { spacing: { before: 180, after: 140, line: 276 }, keepNext: true });
}

function signalParagraph(item, locale) {
  const palette = COLORS[item.level] ?? COLORS.unknown;
  return bodyParagraph([
    run('● ', { bold: true, color: palette.text }),
    run(`${reportText(item.label, locale)}: `, { bold: true, color: palette.text }),
    run(item.text),
  ], { spacing: { after: 70, line: 264 }, indent: { left: 180, hanging: 180 } });
}

function signalsBlock(section, locale) {
  return [
    new Paragraph({
      style: 'ReportSignalHeading',
      keepNext: true,
      children: [run(reportText('Signals', locale), { bold: true, size: 21, color: '000000' })],
    }),
    ...section.signals.map((item) => signalParagraph(item, locale)),
  ];
}

function recommendationParagraph(text) {
  return new Paragraph({
    style: 'Normal',
    numbering: { reference: 'report-recommendations', level: 0 },
    spacing: { after: 100, line: 276 },
    children: [run(text, { color: COLORS.ink })],
  });
}

export async function buildUserReportDocx({
  profile,
  metrics,
  insights,
  reportDate = new Date(),
  locale = 'en',
}) {
  const user = profile?.user ?? {};
  const recommendations = insights.recommendations;
  const overviewPalette = COLORS[insights.overallLevel] ?? COLORS.unknown;

  const children = [
    new Paragraph({
      style: 'ReportTitle',
      alignment: AlignmentType.CENTER,
      children: [run(reportText('VitalySync User Wellness Report', locale), { bold: true, size: 36, color: '000000' })],
    }),
    bodyParagraph(reportText('A personal summary of CBI assessments and recorded wellness and activity.', locale), {
      alignment: AlignmentType.CENTER,
      spacing: { after: 180 },
    }),
    bodyParagraph('Missing observations are shown as N/A. CBI results are observed assessments only; no daily interpolation or clinical cutoffs are used.'),

    heading(reportText('User information', locale)),
    bodyParagraph([run(reportText('Name: ', locale), { bold: true }), run(user.username ?? 'N/A')], { spacing: { after: 60 } }),
    bodyParagraph([run(reportText('Gender: ', locale), { bold: true }), run(user.gender ?? 'N/A')], { spacing: { after: 60 } }),
    bodyParagraph([run(reportText('Role: ', locale), { bold: true }), run(user.role ?? 'N/A')], { spacing: { after: 60 } }),
    bodyParagraph([
      run(reportText('Report date: ', locale), { bold: true }),
      run(reportDate.toLocaleDateString(locale === 'fil' ? 'fil-PH' : 'en-US', { year: 'numeric', month: 'long', day: 'numeric' })),
    ]),

    heading(reportText('Report overview', locale)),
    bodyParagraph([run(insights.overview, { color: overviewPalette.text })]),
    heading('Exhaustion assessment - CBI Personal Burnout'),
    assessmentTable(metrics),
    insightParagraph(insights.sections.burnout.insight, insights.sections.burnout.level, locale),
    ...signalsBlock(insights.sections.burnout, locale),

    ...((metrics.legacyHistory?.length ?? 0) > 0 ? [heading('Legacy composite history - retired methodology'), bodyParagraph('Stored results from the earlier app formula. These are not CBI assessments and are not comparable to them.'), legacyTable(metrics)] : []),

    heading(reportText('Wellness averages', locale)),
    wellnessTable(metrics, locale),
    insightParagraph(insights.sections.wellness.insight, insights.sections.wellness.level, locale),
    ...signalsBlock(insights.sections.wellness, locale),

    heading(reportText('Weekly pulse context', locale)),
    weeklyPulseTable(metrics, locale),
    insightParagraph(insights.sections.pulse.insight, insights.sections.pulse.level, locale),
    ...signalsBlock(insights.sections.pulse, locale),

    heading(reportText('Exercise and activity', locale)),
    activityTable(metrics, locale),
    insightParagraph(insights.sections.activity.insight, insights.sections.activity.level, locale),
    ...signalsBlock(insights.sections.activity, locale),

    bodyParagraph([
      run(reportText('Important: ', locale), { bold: true }),
      run(reportText('This report supports personal wellness tracking and is not medical advice, a diagnosis, or treatment. Read the values alongside their dates and recorded-day counts.', locale)),
    ], { spacing: { before: 260, after: 160 }, style: 'ReportNote' }),

    heading(reportText('Recommendations', locale)),
    ...recommendations.map((item) => recommendationParagraph(item)),
  ];

  const doc = new Document({
    fonts: [{ name: REPORT_FONT, data: await readFile(REPORT_FONT_URL) }],
    styles: {
      default: {
        document: {
          run: { font: REPORT_FONT, size: 21, color: COLORS.ink },
          paragraph: { spacing: { after: 120, line: 276 } },
        },
      },
      paragraphStyles: [
        {
          id: 'ReportTitle',
          name: 'Report Title',
          basedOn: 'Normal',
          next: 'Normal',
          quickFormat: true,
          run: { font: REPORT_FONT, size: 36, bold: true, color: '000000' },
          paragraph: { spacing: { before: 0, after: 80 }, alignment: AlignmentType.CENTER },
        },
        {
          id: 'Heading1',
          name: 'Heading 1',
          basedOn: 'Normal',
          next: 'Normal',
          quickFormat: true,
          run: { font: REPORT_FONT, size: 28, bold: true, color: '000000' },
          paragraph: { spacing: { before: 300, after: 100 }, keepNext: true, outlineLevel: 0 },
        },
        {
          id: 'ReportSignalHeading',
          name: 'Report Signal Heading',
          basedOn: 'Normal',
          next: 'Normal',
          run: { font: REPORT_FONT, size: 21, bold: true, color: '000000' },
          paragraph: { spacing: { before: 80, after: 70 }, keepNext: true },
        },
        {
          id: 'ReportTableText',
          name: 'Report Table Text',
          basedOn: 'Normal',
          next: 'Normal',
          run: { font: REPORT_FONT, size: 19, color: COLORS.ink },
          paragraph: { spacing: { before: 0, after: 0, line: 240 } },
        },
        {
          id: 'ReportNote',
          name: 'Report Note',
          basedOn: 'Normal',
          next: 'Normal',
          run: { font: REPORT_FONT, size: 18, color: COLORS.muted },
          paragraph: { spacing: { before: 260, after: 160, line: 252 } },
        },
      ],
    },
    numbering: {
      config: [
        {
          reference: 'report-recommendations',
          levels: [
            {
              level: 0,
              format: LevelFormat.DECIMAL,
              text: '%1.',
              alignment: AlignmentType.LEFT,
              style: {
                paragraph: {
                  indent: { left: 540, hanging: 270 },
                  spacing: { after: 100, line: 276 },
                },
                run: { font: REPORT_FONT, size: 21, bold: true, color: '000000' },
              },
            },
          ],
        },
      ],
    },
    sections: [
      {
        properties: {
          page: {
            size: { width: PAGE_WIDTH, height: PAGE_HEIGHT, orientation: PageOrientation.PORTRAIT },
            margin: {
              top: ONE_CENTIMETER,
              right: ONE_CENTIMETER,
              bottom: ONE_CENTIMETER,
              left: ONE_CENTIMETER,
              header: 360,
              footer: 360,
            },
          },
        },
        children,
      },
    ],
  });

  return Packer.toBuffer(doc);
}
