import pool from '../config/db.js';
import { Document, Packer, Paragraph, TextRun, Table, TableRow, TableCell, WidthType, AlignmentType } from 'docx';
import { getUserProfileSummary } from './onboarding.service.js';

export async function generateUserReportDocx(userId) {
  const profile = await getUserProfileSummary(userId);
  if (!profile) {
    throw new Error('User not found');
  }

  const logsResult = await pool.query(
    `SELECT
       log_date, sleep_hours, sleep_quality, mood_index, energy_level, perceived_stress_level
     FROM daily_logs
     WHERE user_id = $1 AND log_date >= (CURRENT_DATE - INTERVAL '30 days')
     ORDER BY log_date DESC`,
    [userId]
  );
  const logs = logsResult.rows;

  const burnoutResult = await pool.query(
    `SELECT overall_score AS burnout_score, risk_level AS status_category
     FROM burnout_score_history
     WHERE user_id = $1
     ORDER BY score_date DESC LIMIT 1`,
    [userId]
  );
  const burnout = burnoutResult.rows[0];

  let avgSleep = 0, avgMood = 0, avgEnergy = 0, avgStress = 0;
  if (logs.length > 0) {
    avgSleep = (logs.reduce((acc, log) => acc + Number(log.sleep_hours || 0), 0) / logs.length).toFixed(1);
    avgMood = (logs.reduce((acc, log) => acc + Number(log.mood_index || 0), 0) / logs.length).toFixed(1);
    avgEnergy = (logs.reduce((acc, log) => acc + Number(log.energy_level || 0), 0) / logs.length).toFixed(1);
    avgStress = (logs.reduce((acc, log) => acc + Number(log.perceived_stress_level || 0), 0) / logs.length).toFixed(1);
  }

  const userName = profile.user.username || "N/A";
  const userGender = profile.user.gender || "N/A";
  const userRole = profile.user.role || "N/A";

  const doc = new Document({
    sections: [
      {
        properties: {},
        children: [
          new Paragraph({
            alignment: AlignmentType.CENTER,
            children: [
              new TextRun({ text: "Wellness Report", bold: true, size: 32, font: "Arial" })
            ]
          }),
          new Paragraph({
            spacing: { before: 200, after: 100 },
            children: [
              new TextRun({ text: "Patient / User Information", bold: true, size: 28, font: "Arial" })
            ]
          }),
          new Table({
            width: { size: 100, type: WidthType.PERCENTAGE },
            rows: [
              new TableRow({
                children: [
                  new TableCell({ children: [new Paragraph({ children: [new TextRun({ text: "Name", bold: true, font: "Arial", size: 24 })] })] }),
                  new TableCell({ children: [new Paragraph({ children: [new TextRun({ text: userName, font: "Arial", size: 24 })] })] }),
                ],
              }),
              new TableRow({
                children: [
                  new TableCell({ children: [new Paragraph({ children: [new TextRun({ text: "Gender", bold: true, font: "Arial", size: 24 })] })] }),
                  new TableCell({ children: [new Paragraph({ children: [new TextRun({ text: userGender, font: "Arial", size: 24 })] })] }),
                ],
              }),
              new TableRow({
                children: [
                  new TableCell({ children: [new Paragraph({ children: [new TextRun({ text: "Role", bold: true, font: "Arial", size: 24 })] })] }),
                  new TableCell({ children: [new Paragraph({ children: [new TextRun({ text: userRole, font: "Arial", size: 24 })] })] }),
                ],
              }),
              new TableRow({
                children: [
                  new TableCell({ children: [new Paragraph({ children: [new TextRun({ text: "Date of Report", bold: true, font: "Arial", size: 24 })] })] }),
                  new TableCell({ children: [new Paragraph({ children: [new TextRun({ text: new Date().toLocaleDateString(), font: "Arial", size: 24 })] })] }),
                ],
              }),
            ],
          }),
          new Paragraph({
            spacing: { before: 400, after: 100 },
            children: [
              new TextRun({ text: "Burnout & Wellness Status", bold: true, size: 28, font: "Arial" })
            ]
          }),
          new Paragraph({
            children: [
              new TextRun({ text: "Latest Burnout Status: ", bold: true, font: "Arial", size: 24 }),
              new TextRun({ text: burnout ? burnout.status_category : "Unknown", font: "Arial", size: 24 }),
            ],
          }),
          new Paragraph({
            children: [
              new TextRun({ text: "Latest Burnout Score: ", bold: true, font: "Arial", size: 24 }),
              new TextRun({ text: burnout ? String(burnout.burnout_score) : "N/A", font: "Arial", size: 24 }),
            ],
          }),
          new Paragraph({
            spacing: { before: 400, after: 100 },
            children: [
              new TextRun({ text: "30-Day Averages", bold: true, size: 28, font: "Arial" })
            ]
          }),
          new Table({
            width: { size: 100, type: WidthType.PERCENTAGE },
            rows: [
              new TableRow({
                children: [
                  new TableCell({ children: [new Paragraph({ children: [new TextRun({ text: "Metric", bold: true, font: "Arial", size: 24 })] })] }),
                  new TableCell({ children: [new Paragraph({ children: [new TextRun({ text: "Average Value", bold: true, font: "Arial", size: 24 })] })] }),
                ],
              }),
              new TableRow({
                children: [
                  new TableCell({ children: [new Paragraph({ children: [new TextRun({ text: "Sleep Hours", font: "Arial", size: 24 })] })] }),
                  new TableCell({ children: [new Paragraph({ children: [new TextRun({ text: avgSleep + " hours", font: "Arial", size: 24 })] })] }),
                ],
              }),
              new TableRow({
                children: [
                  new TableCell({ children: [new Paragraph({ children: [new TextRun({ text: "Mood Index (1-5)", font: "Arial", size: 24 })] })] }),
                  new TableCell({ children: [new Paragraph({ children: [new TextRun({ text: avgMood, font: "Arial", size: 24 })] })] }),
                ],
              }),
              new TableRow({
                children: [
                  new TableCell({ children: [new Paragraph({ children: [new TextRun({ text: "Energy Level (1-5)", font: "Arial", size: 24 })] })] }),
                  new TableCell({ children: [new Paragraph({ children: [new TextRun({ text: avgEnergy, font: "Arial", size: 24 })] })] }),
                ],
              }),
              new TableRow({
                children: [
                  new TableCell({ children: [new Paragraph({ children: [new TextRun({ text: "Stress Level (1-5)", font: "Arial", size: 24 })] })] }),
                  new TableCell({ children: [new Paragraph({ children: [new TextRun({ text: avgStress, font: "Arial", size: 24 })] })] }),
                ],
              }),
            ],
          }),
          new Paragraph({
            spacing: { before: 400, after: 100 },
            children: [
              new TextRun({ text: "Recent Logs (Last 5 Days)", bold: true, size: 28, font: "Arial" })
            ]
          }),
          new Table({
            width: { size: 100, type: WidthType.PERCENTAGE },
            rows: [
              new TableRow({
                children: [
                  new TableCell({ children: [new Paragraph({ children: [new TextRun({ text: "Date", bold: true, font: "Arial", size: 24 })] })] }),
                  new TableCell({ children: [new Paragraph({ children: [new TextRun({ text: "Sleep", bold: true, font: "Arial", size: 24 })] })] }),
                  new TableCell({ children: [new Paragraph({ children: [new TextRun({ text: "Mood", bold: true, font: "Arial", size: 24 })] })] }),
                  new TableCell({ children: [new Paragraph({ children: [new TextRun({ text: "Energy", bold: true, font: "Arial", size: 24 })] })] }),
                  new TableCell({ children: [new Paragraph({ children: [new TextRun({ text: "Stress", bold: true, font: "Arial", size: 24 })] })] }),
                ],
              }),
              ...logs.slice(0, 5).map(log => 
                new TableRow({
                  children: [
                    new TableCell({ children: [new Paragraph({ children: [new TextRun({ text: log.log_date ? new Date(log.log_date).toLocaleDateString() : 'N/A', font: "Arial", size: 24 })] })] }),
                    new TableCell({ children: [new Paragraph({ children: [new TextRun({ text: String(log.sleep_hours || '-'), font: "Arial", size: 24 })] })] }),
                    new TableCell({ children: [new Paragraph({ children: [new TextRun({ text: String(log.mood_index || '-'), font: "Arial", size: 24 })] })] }),
                    new TableCell({ children: [new Paragraph({ children: [new TextRun({ text: String(log.energy_level || '-'), font: "Arial", size: 24 })] })] }),
                    new TableCell({ children: [new Paragraph({ children: [new TextRun({ text: String(log.perceived_stress_level || '-'), font: "Arial", size: 24 })] })] }),
                  ],
                })
              )
            ],
          }),
          new Paragraph({
            alignment: AlignmentType.CENTER,
            spacing: { before: 800 },
            children: [
              new TextRun({
                text: "Disclaimer: This report is generated for personal wellness tracking and is not a substitute for professional medical advice, diagnosis, or treatment.",
                italics: true,
                size: 20,
                font: "Arial",
              })
            ]
          })
        ],
      },
    ],
  });

  return await Packer.toBuffer(doc);
}
