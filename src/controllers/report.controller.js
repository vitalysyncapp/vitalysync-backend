import { generateUserReportDocx } from '../services/report.service.js';
import { getAuthenticatedUserId } from '../middleware/auth.middleware.js';

export async function exportUserReport(req, res) {
  try {
    const userId = getAuthenticatedUserId(req) ?? req.params.userId;
    
    if (!userId) {
      return res.status(400).json({ message: 'User ID is required' });
    }

    const buffer = await generateUserReportDocx(userId, { locale: req.locale });

    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document');
    res.setHeader('Content-Disposition', 'attachment; filename="Wellness_Report.docx"');
    
    return res.status(200).send(buffer);
  } catch (error) {
    if (error.message === 'User not found') {
      return res.status(404).json({ message: error.message });
    }
    
    console.error('Export report error:', error);
    return res.status(500).json({ message: 'Failed to generate report' });
  }
}
