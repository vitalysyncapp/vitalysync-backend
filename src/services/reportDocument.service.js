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

import { classifyReportMetric } from './reportInsights.service.js';

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

function semanticCell(valueText, metric, value, width, {
  appendLabel = true,
  compactCoverageLabel = false,
} = {}) {
  const indicator = classifyReportMetric(metric, value);
  const palette = COLORS[indicator.level];
  const coverageLabels = {
    good: 'Good',
    okay: 'Okay',
    warning: 'Limited',
    high: 'Very limited',
    unknown: 'No data',
  };
  const label = compactCoverageLabel
    ? coverageLabels[indicator.level]
    : indicator.label;

  return tableCell(
    width,
    [
      tableParagraph(
        [
          run(valueText, { bold: true, size: 19, color: palette.text }),
          ...(appendLabel
            ? [run(` ${label}`, { size: 16, color: palette.text })]
            : []),
        ],
        AlignmentType.CENTER,
      ),
    ],
    { shading: { type: ShadingType.CLEAR, fill: palette.fill } },
  );
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

function burnoutTable(metrics) {
  const widths = [4800, 2200, TABLE_WIDTH - 7000];
  const latest = metrics.latestBurnout;
  const rows = latest
    ? [
        ['Latest risk level', String(latest.status_category ?? 'Unknown'), 'burnoutRisk', latest.status_category],
        ['Overall burnout score', format(latest.burnout_score, '/100'), 'burnoutScore', latest.burnout_score],
        ['Emotional exhaustion', format(latest.emotional_exhaustion_score, '/100'), 'burnoutDimension', latest.emotional_exhaustion_score],
        ['Detachment', format(latest.detachment_score, '/100'), 'burnoutDimension', latest.detachment_score],
        ['Reduced accomplishment', format(latest.reduced_accomplishment_score, '/100'), 'burnoutDimension', latest.reduced_accomplishment_score],
      ]
    : [['Latest result', 'N/A', 'burnoutScore', null]];

  return reportTable(
    ['Metric', 'Value', 'Indicator'],
    widths,
    rows.map(([label, valueText, metric, value]) => {
      const indicator = classifyReportMetric(metric, value);
      return new TableRow({
        cantSplit: true,
        children: [
          plainCell(label, widths[0]),
          plainCell(valueText, widths[1], AlignmentType.CENTER),
          semanticCell(indicator.label, metric, value, widths[2], { appendLabel: false }),
        ],
      });
    }),
  );
}

function wellnessTable(metrics) {
  const widths = [2300, 1800, 1800, 1800, 1800, TABLE_WIDTH - 9500];
  const rows = PERIOD_ROWS.map(([key, label]) => {
    const period = metrics.wellness[key];
    return new TableRow({
      cantSplit: true,
      children: [
        plainCell(label, widths[0]),
        semanticCell(format(period.sleep, ' h'), 'sleep', period.sleep, widths[1]),
        semanticCell(format(period.mood, '/5'), 'mood', period.mood, widths[2]),
        semanticCell(format(period.energy, '/5'), 'energy', period.energy, widths[3]),
        semanticCell(format(period.stress, '/5'), 'stress', period.stress, widths[4]),
        semanticCell(
          `${period.count}/${period.expectedDays}`,
          'coverage',
          period.count / period.expectedDays,
          widths[5],
          { compactCoverageLabel: true },
        ),
      ],
    });
  });

  return reportTable(
    ['Period', 'Sleep', 'Mood', 'Energy', 'Stress', 'Logged days'],
    widths,
    rows,
  );
}

function activityTable(metrics) {
  const widths = [2400, 2100, 2300, 2300, TABLE_WIDTH - 9100];
  const rows = PERIOD_ROWS.map(([key, label]) => {
    const period = metrics.activity[key];
    return new TableRow({
      cantSplit: true,
      children: [
        plainCell(label, widths[0]),
        semanticCell(
          format(period.steps),
          'steps',
          period.steps,
          widths[1],
          { appendLabel: false },
        ),
        semanticCell(
          format(period.activeMinutes, ' min'),
          'activeMinutes',
          period.activeMinutes,
          widths[2],
          { appendLabel: false },
        ),
        plainCell(format(period.calories), widths[3], AlignmentType.CENTER),
        semanticCell(
          `${period.count}/${period.expectedDays}`,
          'coverage',
          period.count / period.expectedDays,
          widths[4],
          { compactCoverageLabel: true },
        ),
      ],
    });
  });

  return reportTable(
    ['Period', 'Avg steps/day', 'Avg active time', 'Avg calories/logged day', 'Logged days'],
    widths,
    rows,
  );
}

function insightParagraph(text, level) {
  const palette = COLORS[level] ?? COLORS.unknown;
  return bodyParagraph([
    run('Insight: ', { bold: true, color: '000000' }),
    run(text, { color: palette.text }),
  ], { spacing: { before: 180, after: 140, line: 276 }, keepNext: true });
}

function signalParagraph(item) {
  const palette = COLORS[item.level] ?? COLORS.unknown;
  return bodyParagraph([
    run('● ', { bold: true, color: palette.text }),
    run(`${item.label}: `, { bold: true, color: palette.text }),
    run(item.text),
  ], { spacing: { after: 70, line: 264 }, indent: { left: 180, hanging: 180 } });
}

function signalsBlock(section) {
  return [
    new Paragraph({
      style: 'ReportSignalHeading',
      keepNext: true,
      children: [run('Signals', { bold: true, size: 21, color: '000000' })],
    }),
    ...section.signals.map(signalParagraph),
  ];
}

function indicatorGuide() {
  return bodyParagraph([
    run('Indicator guide: ', { bold: true, color: '000000' }),
    run('Good', { bold: true, color: COLORS.good.text }),
    run('  |  '),
    run('Okay', { bold: true, color: COLORS.okay.text }),
    run('  |  '),
    run('Warning', { bold: true, color: COLORS.warning.text }),
    run('  |  '),
    run('High risk', { bold: true, color: COLORS.high.text }),
    run('  |  '),
    run('AI-generated', { bold: true, color: COLORS.ai.text }),
  ], { alignment: AlignmentType.CENTER, spacing: { after: 240 } });
}

function recommendationParagraph(text, aiGenerated) {
  return new Paragraph({
    style: 'Normal',
    numbering: { reference: 'report-recommendations', level: 0 },
    spacing: { after: 100, line: 276 },
    children: [run(text, { color: aiGenerated ? COLORS.ai.text : COLORS.ink })],
  });
}

export async function buildUserReportDocx({
  profile,
  metrics,
  insights,
  aiContent = null,
  reportDate = new Date(),
}) {
  const user = profile?.user ?? {};
  const recommendations = aiContent?.recommendations?.length
    ? aiContent.recommendations
    : insights.recommendations;
  const aiRecommendations = Boolean(aiContent?.recommendations?.length);
  const overviewPalette = COLORS[insights.overallLevel] ?? COLORS.unknown;

  const children = [
    new Paragraph({
      style: 'ReportTitle',
      alignment: AlignmentType.CENTER,
      children: [run('VitalySync User Wellness Report', { bold: true, size: 36, color: '000000' })],
    }),
    bodyParagraph('A personal summary of logged wellness, burnout, and activity patterns.', {
      alignment: AlignmentType.CENTER,
      spacing: { after: 180 },
    }),
    indicatorGuide(),

    heading('User information'),
    bodyParagraph([run('Name: ', { bold: true }), run(user.username ?? 'N/A')], { spacing: { after: 60 } }),
    bodyParagraph([run('Gender: ', { bold: true }), run(user.gender ?? 'N/A')], { spacing: { after: 60 } }),
    bodyParagraph([run('Role: ', { bold: true }), run(user.role ?? 'N/A')], { spacing: { after: 60 } }),
    bodyParagraph([
      run('Report date: ', { bold: true }),
      run(reportDate.toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' })),
    ]),

    heading('Report overview'),
    bodyParagraph([run(insights.overview, { color: overviewPalette.text })]),
    ...(aiContent?.highlight
      ? [bodyParagraph([
          run('AI-generated highlight: ', { bold: true, color: '000000' }),
          run(aiContent.highlight, { color: COLORS.ai.text }),
        ])]
      : []),

    heading('Burnout status and dimensions'),
    burnoutTable(metrics),
    insightParagraph(insights.sections.burnout.insight, insights.sections.burnout.level),
    ...signalsBlock(insights.sections.burnout),

    heading('Wellness averages'),
    wellnessTable(metrics),
    insightParagraph(insights.sections.wellness.insight, insights.sections.wellness.level),
    ...signalsBlock(insights.sections.wellness),

    heading('Exercise and activity'),
    activityTable(metrics),
    insightParagraph(insights.sections.activity.insight, insights.sections.activity.level),
    ...signalsBlock(insights.sections.activity),

    bodyParagraph([
      run('Important: ', { bold: true }),
      run('This report supports personal wellness tracking and is not medical advice, a diagnosis, or treatment. Color indicators summarize app-defined patterns and should be read alongside the underlying values and data coverage.'),
    ], { spacing: { before: 260, after: 160 }, style: 'ReportNote' }),

    heading('Recommendations'),
    ...(aiRecommendations
      ? [bodyParagraph([run('The following suggestions are AI-generated from the aggregated values in this report.', { color: COLORS.ai.text })])]
      : []),
    ...recommendations.map((item) => recommendationParagraph(item, aiRecommendations)),
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
