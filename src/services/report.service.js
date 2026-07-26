import pool from '../config/db.js';
import { Document, Packer, Paragraph, TextRun, Table, TableRow, TableCell, WidthType, AlignmentType, BorderStyle } from 'docx';
import { getUserProfileSummary } from './onboarding.service.js';
import OpenAI from 'openai';

const BORDERLESS = {
  top: { style: BorderStyle.NONE, size: 0, color: "auto" },
  bottom: { style: BorderStyle.NONE, size: 0, color: "auto" },
  left: { style: BorderStyle.NONE, size: 0, color: "auto" },
  right: { style: BorderStyle.NONE, size: 0, color: "auto" },
  insideHorizontal: { style: BorderStyle.NONE, size: 0, color: "auto" },
  insideVertical: { style: BorderStyle.NONE, size: 0, color: "auto" }
};

const TABLE_HEADER_SHADING = { fill: "F3F4F6" };

export async function generateUserReportDocx(userId) {
  const profile = await getUserProfileSummary(userId);
  if (!profile) {
    throw new Error('User not found');
  }

  // Fetch 1 year of daily logs
  const logsResult = await pool.query(
    `SELECT
       log_date, sleep_hours, sleep_quality, mood_index, energy_level, perceived_stress_level
     FROM daily_logs
     WHERE user_id = $1 AND log_date >= (CURRENT_DATE - INTERVAL '365 days')
     ORDER BY log_date DESC`,
    [userId]
  );
  const logs = logsResult.rows;

  // Fetch 1 year of burnout scores (Maslach dimensions)
  const burnoutResult = await pool.query(
    `SELECT score_date, overall_score AS burnout_score, risk_level AS status_category,
            emotional_exhaustion_score, detachment_score, reduced_accomplishment_score
     FROM burnout_score_history
     WHERE user_id = $1 AND score_date >= (CURRENT_DATE - INTERVAL '365 days')
     ORDER BY score_date DESC`,
    [userId]
  );
  const burnoutHistory = burnoutResult.rows;
  const latestBurnout = burnoutHistory[0];

  // Fetch 1 year of exercises
  const exerciseResult = await pool.query(
    `SELECT log_date, steps, active_minutes, calories_burned, exercise_type, goal_completed
     FROM daily_activity_logs
     WHERE user_id = $1 AND log_date >= (CURRENT_DATE - INTERVAL '365 days')
     ORDER BY log_date DESC`,
    [userId]
  );
  const exercises = exerciseResult.rows;

  // Compute Averages
  const now = new Date();
  const dayMs = 24 * 60 * 60 * 1000;

  const filterByDays = (data, dateField, daysAgoStart, daysAgoEnd) => {
    return data.filter(row => {
      const d = new Date(row[dateField]);
      const diffDays = Math.floor((now - d) / dayMs);
      return diffDays >= daysAgoStart && diffDays <= daysAgoEnd;
    });
  };

  const getAverages = (data) => {
    if (!data || data.length === 0) return { sleep: 0, mood: 0, energy: 0, stress: 0, count: 0 };
    const avgSleep = data.reduce((acc, log) => acc + Number(log.sleep_hours || 0), 0) / data.length;
    const avgMood = data.reduce((acc, log) => acc + Number(log.mood_index || 0), 0) / data.length;
    const avgEnergy = data.reduce((acc, log) => acc + Number(log.energy_level || 0), 0) / data.length;
    const avgStress = data.reduce((acc, log) => acc + Number(log.perceived_stress_level || 0), 0) / data.length;
    return {
      sleep: avgSleep.toFixed(1),
      mood: avgMood.toFixed(1),
      energy: avgEnergy.toFixed(1),
      stress: avgStress.toFixed(1),
      count: data.length
    };
  };

  const logsWeek = filterByDays(logs, 'log_date', 0, 7);
  const logsMonth = filterByDays(logs, 'log_date', 0, 30);
  const logsPrevMonth = filterByDays(logs, 'log_date', 31, 60);
  const logsYear = filterByDays(logs, 'log_date', 0, 365);

  const avgWeek = getAverages(logsWeek);
  const avgMonth = getAverages(logsMonth);
  const avgPrevMonth = getAverages(logsPrevMonth);
  const avgYear = getAverages(logsYear);

  const getExerciseAverages = (data) => {
    if (!data || data.length === 0) return { steps: 0, activeMins: 0, calories: 0, count: 0 };
    const avgSteps = data.reduce((acc, log) => acc + Number(log.steps || 0), 0) / data.length;
    const avgMins = data.reduce((acc, log) => acc + Number(log.active_minutes || 0), 0) / data.length;
    const avgCals = data.reduce((acc, log) => acc + Number(log.calories_burned || 0), 0) / data.length;
    return {
      steps: Math.round(avgSteps),
      activeMins: Math.round(avgMins),
      calories: Math.round(avgCals),
      count: data.length
    };
  };

  const exWeek = getExerciseAverages(filterByDays(exercises, 'log_date', 0, 7));
  const exMonth = getExerciseAverages(filterByDays(exercises, 'log_date', 0, 30));
  const exPrevMonth = getExerciseAverages(filterByDays(exercises, 'log_date', 31, 60));
  const exYear = getExerciseAverages(filterByDays(exercises, 'log_date', 0, 365));

  const userName = profile.user.username || "N/A";
  const userGender = profile.user.gender || "N/A";
  const userRole = profile.user.role || "N/A";

  let insights = {
    description: "Analyzing current patterns...",
    drivers: "Identifying drivers...",
    recommendations: "Gathering recommendations...",
    importance: "Identifying critical signals..."
  };

  try {
    const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
    const aiPrompt = `
      You are an expert wellness and health data analyst. Provide a short insightful text analysis for the user "${userName}".
      Current 30-day Avg: Sleep ${avgMonth.sleep}h, Mood ${avgMonth.mood}/5, Energy ${avgMonth.energy}/5, Stress ${avgMonth.stress}/5.
      Prev 30-day Avg: Sleep ${avgPrevMonth.sleep}h, Mood ${avgPrevMonth.mood}/5, Energy ${avgPrevMonth.energy}/5, Stress ${avgPrevMonth.stress}/5.
      Latest Burnout Score: ${latestBurnout ? latestBurnout.burnout_score : 'N/A'}/100.
      Current 30-day Exercise: ${exMonth.steps} steps/day, ${exMonth.activeMins} active mins/day.

      Provide a JSON response with the following keys:
      - "description": A short paragraph summarizing their wellness state based on the data.
      - "drivers": What are the main drivers of their current state (e.g., lack of sleep causing high stress)?
      - "recommendations": What are 2-3 recommended improvements they can make?
      - "importance": A sentence about any critical risks or important positive signals.
    `;
    const aiModel = process.env.OPENAI_NUDGE_MODEL || 'gpt-5.4-mini';
    
    const response = await openai.chat.completions.create({
      model: aiModel,
      messages: [{ role: 'system', content: 'Return valid JSON.' }, { role: 'user', content: aiPrompt }],
      response_format: { type: "json_object" }
    });
    const parsed = JSON.parse(response.choices[0].message.content);
    if (parsed.description) insights = parsed;
  } catch (error) {
    console.warn("AI Generation for report failed:", error.message);
  }

  const doc = new Document({
    sections: [
      {
        properties: {
          page: {
            margin: {
              top: 1440, // 1 inch margins
              right: 1440,
              bottom: 1440,
              left: 1440,
            }
          }
        },
        children: [
          // Title
          new Paragraph({
            alignment: AlignmentType.CENTER,
            spacing: { after: 400 },
            children: [
              new TextRun({ text: "VitalySync User Wellness Report", bold: true, size: 36, font: "Inter", color: "008000" })
            ]
          }),

          // User Info Section
          new Paragraph({
            spacing: { before: 200, after: 100 },
            children: [
              new TextRun({ text: "User Information", bold: true, size: 28, font: "Inter" })
            ]
          }),
          new Paragraph({
            spacing: { after: 100 },
            children: [
              new TextRun({ text: "Name: ", bold: true, font: "Inter", size: 24 }),
              new TextRun({ text: userName, font: "Inter", size: 24 }),
            ]
          }),
          new Paragraph({
            spacing: { after: 100 },
            children: [
              new TextRun({ text: "Gender: ", bold: true, font: "Inter", size: 24 }),
              new TextRun({ text: userGender, font: "Inter", size: 24 }),
            ]
          }),
          new Paragraph({
            spacing: { after: 100 },
            children: [
              new TextRun({ text: "Role: ", bold: true, font: "Inter", size: 24 }),
              new TextRun({ text: userRole, font: "Inter", size: 24 }),
            ]
          }),
          new Paragraph({
            spacing: { after: 400 },
            children: [
              new TextRun({ text: "Date of Report: ", bold: true, font: "Inter", size: 24 }),
              new TextRun({ text: new Date().toLocaleDateString(), font: "Inter", size: 24 }),
            ]
          }),

          // Analysis and insights
          new Paragraph({
            spacing: { before: 200, after: 100 },
            children: [
              new TextRun({ text: "Analysis and insights", bold: true, size: 28, font: "Inter" })
            ]
          }),
          new Paragraph({
            spacing: { before: 100, after: 100 },
            children: [
              new TextRun({ text: "Status: ", bold: true, font: "Inter", size: 24, color: "0000FF" }),
              new TextRun({ text: insights.description, font: "Inter", size: 24 }) 
            ]
          }),
          new Paragraph({
            spacing: { after: 100 },
            children: [
              new TextRun({ text: "Main Drivers: ", bold: true, font: "Inter", size: 24, color: "FFD700" }),
              new TextRun({ text: insights.drivers, font: "Inter", size: 24 }) 
            ]
          }),
          new Paragraph({
            spacing: { after: 100 },
            children: [
              new TextRun({ text: "Critical Signals: ", bold: true, font: "Inter", size: 24, color: "FF0000" }),
              new TextRun({ text: insights.importance, font: "Inter", size: 24 }) 
            ]
          }),
          new Paragraph({
            spacing: { after: 400 },
            children: [
              new TextRun({ text: "Recommendations: ", bold: true, font: "Inter", size: 24, color: "800080" }),
              new TextRun({ text: insights.recommendations, font: "Inter", size: 24 }) 
            ]
          }),

          // Burnout Dimensions
          new Paragraph({
            spacing: { before: 200, after: 100 },
            children: [
              new TextRun({ text: "Burnout Status & Maslach Dimensions", bold: true, size: 28, font: "Inter" })
            ]
          }),
          new Paragraph({
            spacing: { after: 200 },
            children: [
              new TextRun({ text: "Explanation: ", bold: true, font: "Inter", size: 20, color: "0000FF" }),
              new TextRun({ text: "This table breaks down your current burnout risk using the Maslach dimensions. A higher score in exhaustion or detachment signals a ", font: "Inter", size: 20 }),
              new TextRun({ text: "critical risk", bold: true, color: "FF0000", font: "Inter", size: 20 }),
              new TextRun({ text: ", while reduced accomplishment highlights areas needing ", font: "Inter", size: 20 }),
              new TextRun({ text: "recommended improvement", bold: true, color: "800080", font: "Inter", size: 20 }),
              new TextRun({ text: ".", font: "Inter", size: 20 })
            ]
          }),
          new Table({
            width: { size: 100, type: WidthType.PERCENTAGE },
            borders: BORDERLESS,
            rows: [
              new TableRow({
                children: [
                  new TableCell({ shading: TABLE_HEADER_SHADING, children: [new Paragraph({ spacing: { before: 100, after: 100 }, children: [new TextRun({ text: "Metric", bold: true, font: "Inter", size: 22 })] })] }),
                  new TableCell({ shading: TABLE_HEADER_SHADING, children: [new Paragraph({ spacing: { before: 100, after: 100 }, children: [new TextRun({ text: "Value", bold: true, font: "Inter", size: 22 })] })] }),
                ],
              }),
              new TableRow({
                children: [
                  new TableCell({ children: [new Paragraph({ spacing: { before: 100, after: 100 }, children: [new TextRun({ text: "Latest Risk Level", font: "Inter", size: 22 })] })] }),
                  new TableCell({ children: [new Paragraph({ spacing: { before: 100, after: 100 }, children: [new TextRun({ text: latestBurnout ? latestBurnout.status_category : "Unknown", font: "Inter", size: 22 })] })] }),
                ],
              }),
              new TableRow({
                children: [
                  new TableCell({ children: [new Paragraph({ spacing: { before: 100, after: 100 }, children: [new TextRun({ text: "Overall Burnout Score", font: "Inter", size: 22 })] })] }),
                  new TableCell({ children: [new Paragraph({ spacing: { before: 100, after: 100 }, children: [new TextRun({ text: latestBurnout ? String(latestBurnout.burnout_score) : "N/A", font: "Inter", size: 22 })] })] }),
                ],
              }),
              new TableRow({
                children: [
                  new TableCell({ children: [new Paragraph({ spacing: { before: 100, after: 100 }, children: [new TextRun({ text: "Emotional Exhaustion", font: "Inter", size: 22 })] })] }),
                  new TableCell({ children: [new Paragraph({ spacing: { before: 100, after: 100 }, children: [new TextRun({ text: latestBurnout && latestBurnout.emotional_exhaustion_score != null ? String(latestBurnout.emotional_exhaustion_score) : "N/A", font: "Inter", size: 22 })] })] }),
                ],
              }),
              new TableRow({
                children: [
                  new TableCell({ children: [new Paragraph({ spacing: { before: 100, after: 100 }, children: [new TextRun({ text: "Depersonalization/Detachment", font: "Inter", size: 22 })] })] }),
                  new TableCell({ children: [new Paragraph({ spacing: { before: 100, after: 100 }, children: [new TextRun({ text: latestBurnout && latestBurnout.detachment_score != null ? String(latestBurnout.detachment_score) : "N/A", font: "Inter", size: 22 })] })] }),
                ],
              }),
              new TableRow({
                children: [
                  new TableCell({ children: [new Paragraph({ spacing: { before: 100, after: 100 }, children: [new TextRun({ text: "Reduced Accomplishment", font: "Inter", size: 22 })] })] }),
                  new TableCell({ children: [new Paragraph({ spacing: { before: 100, after: 100 }, children: [new TextRun({ text: latestBurnout && latestBurnout.reduced_accomplishment_score != null ? String(latestBurnout.reduced_accomplishment_score) : "N/A", font: "Inter", size: 22 })] })] }),
                ],
              }),
            ],
          }),

          // Time-based Averages
          new Paragraph({
            spacing: { before: 400, after: 100 },
            children: [
              new TextRun({ text: "Time-based Averages (Wellness Logs)", bold: true, size: 28, font: "Inter" })
            ]
          }),
          new Paragraph({
            spacing: { after: 200 },
            children: [
              new TextRun({ text: "Explanation: ", bold: true, font: "Inter", size: 20, color: "0000FF" }),
              new TextRun({ text: "This compares your self-reported wellness logs over time. Consistent sleep and mood are ", font: "Inter", size: 20 }),
              new TextRun({ text: "positive indicators", bold: true, color: "008000", font: "Inter", size: 20 }),
              new TextRun({ text: ", while sharp drops in energy or spikes in stress act as ", font: "Inter", size: 20 }),
              new TextRun({ text: "important warnings", bold: true, color: "FFD700", font: "Inter", size: 20 }),
              new TextRun({ text: ".", font: "Inter", size: 20 })
            ]
          }),
          new Table({
            width: { size: 100, type: WidthType.PERCENTAGE },
            borders: BORDERLESS,
            rows: [
              new TableRow({
                children: [
                  new TableCell({ shading: TABLE_HEADER_SHADING, children: [new Paragraph({ spacing: { before: 100, after: 100 }, children: [new TextRun({ text: "Period", bold: true, font: "Inter", size: 22 })] })] }),
                  new TableCell({ shading: TABLE_HEADER_SHADING, children: [new Paragraph({ spacing: { before: 100, after: 100 }, children: [new TextRun({ text: "Sleep (h)", bold: true, font: "Inter", size: 22 })] })] }),
                  new TableCell({ shading: TABLE_HEADER_SHADING, children: [new Paragraph({ spacing: { before: 100, after: 100 }, children: [new TextRun({ text: "Mood", bold: true, font: "Inter", size: 22 })] })] }),
                  new TableCell({ shading: TABLE_HEADER_SHADING, children: [new Paragraph({ spacing: { before: 100, after: 100 }, children: [new TextRun({ text: "Energy", bold: true, font: "Inter", size: 22 })] })] }),
                  new TableCell({ shading: TABLE_HEADER_SHADING, children: [new Paragraph({ spacing: { before: 100, after: 100 }, children: [new TextRun({ text: "Stress", bold: true, font: "Inter", size: 22 })] })] }),
                ],
              }),
              new TableRow({
                children: [
                  new TableCell({ children: [new Paragraph({ spacing: { before: 100, after: 100 }, children: [new TextRun({ text: "This Week", font: "Inter", size: 22 })] })] }),
                  new TableCell({ children: [new Paragraph({ spacing: { before: 100, after: 100 }, children: [new TextRun({ text: String(avgWeek.sleep), font: "Inter", size: 22 })] })] }),
                  new TableCell({ children: [new Paragraph({ spacing: { before: 100, after: 100 }, children: [new TextRun({ text: String(avgWeek.mood), font: "Inter", size: 22 })] })] }),
                  new TableCell({ children: [new Paragraph({ spacing: { before: 100, after: 100 }, children: [new TextRun({ text: String(avgWeek.energy), font: "Inter", size: 22 })] })] }),
                  new TableCell({ children: [new Paragraph({ spacing: { before: 100, after: 100 }, children: [new TextRun({ text: String(avgWeek.stress), font: "Inter", size: 22 })] })] }),
                ],
              }),
              new TableRow({
                children: [
                  new TableCell({ children: [new Paragraph({ spacing: { before: 100, after: 100 }, children: [new TextRun({ text: "This Month", font: "Inter", size: 22 })] })] }),
                  new TableCell({ children: [new Paragraph({ spacing: { before: 100, after: 100 }, children: [new TextRun({ text: String(avgMonth.sleep), font: "Inter", size: 22 })] })] }),
                  new TableCell({ children: [new Paragraph({ spacing: { before: 100, after: 100 }, children: [new TextRun({ text: String(avgMonth.mood), font: "Inter", size: 22 })] })] }),
                  new TableCell({ children: [new Paragraph({ spacing: { before: 100, after: 100 }, children: [new TextRun({ text: String(avgMonth.energy), font: "Inter", size: 22 })] })] }),
                  new TableCell({ children: [new Paragraph({ spacing: { before: 100, after: 100 }, children: [new TextRun({ text: String(avgMonth.stress), font: "Inter", size: 22 })] })] }),
                ],
              }),
              new TableRow({
                children: [
                  new TableCell({ children: [new Paragraph({ spacing: { before: 100, after: 100 }, children: [new TextRun({ text: "Last Month", font: "Inter", size: 22 })] })] }),
                  new TableCell({ children: [new Paragraph({ spacing: { before: 100, after: 100 }, children: [new TextRun({ text: String(avgPrevMonth.sleep), font: "Inter", size: 22 })] })] }),
                  new TableCell({ children: [new Paragraph({ spacing: { before: 100, after: 100 }, children: [new TextRun({ text: String(avgPrevMonth.mood), font: "Inter", size: 22 })] })] }),
                  new TableCell({ children: [new Paragraph({ spacing: { before: 100, after: 100 }, children: [new TextRun({ text: String(avgPrevMonth.energy), font: "Inter", size: 22 })] })] }),
                  new TableCell({ children: [new Paragraph({ spacing: { before: 100, after: 100 }, children: [new TextRun({ text: String(avgPrevMonth.stress), font: "Inter", size: 22 })] })] }),
                ],
              }),
              new TableRow({
                children: [
                  new TableCell({ children: [new Paragraph({ spacing: { before: 100, after: 100 }, children: [new TextRun({ text: "This Year", font: "Inter", size: 22 })] })] }),
                  new TableCell({ children: [new Paragraph({ spacing: { before: 100, after: 100 }, children: [new TextRun({ text: String(avgYear.sleep), font: "Inter", size: 22 })] })] }),
                  new TableCell({ children: [new Paragraph({ spacing: { before: 100, after: 100 }, children: [new TextRun({ text: String(avgYear.mood), font: "Inter", size: 22 })] })] }),
                  new TableCell({ children: [new Paragraph({ spacing: { before: 100, after: 100 }, children: [new TextRun({ text: String(avgYear.energy), font: "Inter", size: 22 })] })] }),
                  new TableCell({ children: [new Paragraph({ spacing: { before: 100, after: 100 }, children: [new TextRun({ text: String(avgYear.stress), font: "Inter", size: 22 })] })] }),
                ],
              }),
            ],
          }),

          // Exercise Reports
          new Paragraph({
            spacing: { before: 400, after: 100 },
            children: [
              new TextRun({ text: "Exercise & Activity Report", bold: true, size: 28, font: "Inter" })
            ]
          }),
          new Paragraph({
            spacing: { after: 200 },
            children: [
              new TextRun({ text: "Explanation: ", bold: true, font: "Inter", size: 20, color: "0000FF" }),
              new TextRun({ text: "This summarizes your physical activity. Reaching daily goals consistently contributes to ", font: "Inter", size: 20 }),
              new TextRun({ text: "positive wellness trends", bold: true, color: "008000", font: "Inter", size: 20 }),
              new TextRun({ text: " and helps mitigate burnout risk.", font: "Inter", size: 20 })
            ]
          }),
          new Table({
            width: { size: 100, type: WidthType.PERCENTAGE },
            borders: BORDERLESS,
            rows: [
              new TableRow({
                children: [
                  new TableCell({ shading: TABLE_HEADER_SHADING, children: [new Paragraph({ spacing: { before: 100, after: 100 }, children: [new TextRun({ text: "Period", bold: true, font: "Inter", size: 22 })] })] }),
                  new TableCell({ shading: TABLE_HEADER_SHADING, children: [new Paragraph({ spacing: { before: 100, after: 100 }, children: [new TextRun({ text: "Avg Steps/Day", bold: true, font: "Inter", size: 22 })] })] }),
                  new TableCell({ shading: TABLE_HEADER_SHADING, children: [new Paragraph({ spacing: { before: 100, after: 100 }, children: [new TextRun({ text: "Avg Active Mins", bold: true, font: "Inter", size: 22 })] })] }),
                  new TableCell({ shading: TABLE_HEADER_SHADING, children: [new Paragraph({ spacing: { before: 100, after: 100 }, children: [new TextRun({ text: "Avg Calories", bold: true, font: "Inter", size: 22 })] })] }),
                ],
              }),
              new TableRow({
                children: [
                  new TableCell({ children: [new Paragraph({ spacing: { before: 100, after: 100 }, children: [new TextRun({ text: "This Week", font: "Inter", size: 22 })] })] }),
                  new TableCell({ children: [new Paragraph({ spacing: { before: 100, after: 100 }, children: [new TextRun({ text: String(exWeek.steps), font: "Inter", size: 22 })] })] }),
                  new TableCell({ children: [new Paragraph({ spacing: { before: 100, after: 100 }, children: [new TextRun({ text: String(exWeek.activeMins), font: "Inter", size: 22 })] })] }),
                  new TableCell({ children: [new Paragraph({ spacing: { before: 100, after: 100 }, children: [new TextRun({ text: String(exWeek.calories), font: "Inter", size: 22 })] })] }),
                ],
              }),
              new TableRow({
                children: [
                  new TableCell({ children: [new Paragraph({ spacing: { before: 100, after: 100 }, children: [new TextRun({ text: "This Month", font: "Inter", size: 22 })] })] }),
                  new TableCell({ children: [new Paragraph({ spacing: { before: 100, after: 100 }, children: [new TextRun({ text: String(exMonth.steps), font: "Inter", size: 22 })] })] }),
                  new TableCell({ children: [new Paragraph({ spacing: { before: 100, after: 100 }, children: [new TextRun({ text: String(exMonth.activeMins), font: "Inter", size: 22 })] })] }),
                  new TableCell({ children: [new Paragraph({ spacing: { before: 100, after: 100 }, children: [new TextRun({ text: String(exMonth.calories), font: "Inter", size: 22 })] })] }),
                ],
              }),
              new TableRow({
                children: [
                  new TableCell({ children: [new Paragraph({ spacing: { before: 100, after: 100 }, children: [new TextRun({ text: "Last Month", font: "Inter", size: 22 })] })] }),
                  new TableCell({ children: [new Paragraph({ spacing: { before: 100, after: 100 }, children: [new TextRun({ text: String(exPrevMonth.steps), font: "Inter", size: 22 })] })] }),
                  new TableCell({ children: [new Paragraph({ spacing: { before: 100, after: 100 }, children: [new TextRun({ text: String(exPrevMonth.activeMins), font: "Inter", size: 22 })] })] }),
                  new TableCell({ children: [new Paragraph({ spacing: { before: 100, after: 100 }, children: [new TextRun({ text: String(exPrevMonth.calories), font: "Inter", size: 22 })] })] }),
                ],
              }),
              new TableRow({
                children: [
                  new TableCell({ children: [new Paragraph({ spacing: { before: 100, after: 100 }, children: [new TextRun({ text: "This Year", font: "Inter", size: 22 })] })] }),
                  new TableCell({ children: [new Paragraph({ spacing: { before: 100, after: 100 }, children: [new TextRun({ text: String(exYear.steps), font: "Inter", size: 22 })] })] }),
                  new TableCell({ children: [new Paragraph({ spacing: { before: 100, after: 100 }, children: [new TextRun({ text: String(exYear.activeMins), font: "Inter", size: 22 })] })] }),
                  new TableCell({ children: [new Paragraph({ spacing: { before: 100, after: 100 }, children: [new TextRun({ text: String(exYear.calories), font: "Inter", size: 22 })] })] }),
                ],
              }),
            ],
          }),

          new Paragraph({
            alignment: AlignmentType.CENTER,
            spacing: { before: 800 },
            children: [
              new TextRun({
                text: "Disclaimer: This report is generated for personal wellness tracking and is not a substitute for professional medical advice, diagnosis, or treatment.",
                italics: true,
                size: 18,
                font: "Inter",
                color: "888888"
              })
            ]
          })
        ],
      },
    ],
  });

  return await Packer.toBuffer(doc);
}
