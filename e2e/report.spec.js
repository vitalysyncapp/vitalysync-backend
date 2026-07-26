import { test, expect } from '@playwright/test';
import db from '../src/config/db.js';
import { createAccessToken } from '../src/services/authToken.service.js';

test('Export user report API endpoint should return a docx file', async ({ request }) => {
  const timestamp = Date.now();
  // Insert a test user directly to bypass validation like DNS checks
  const result = await db.query(
    `INSERT INTO users (username, email, password, age, gender) 
     VALUES ($1, $2, $3, $4, $5) RETURNING user_id`,
    [`playwright_${timestamp}`, `playwright_${timestamp}@example.com`, 'hash', 30, 'Other']
  );
  const userId = result.rows[0].user_id;
  const token = createAccessToken({ user_id: userId });

  const response = await request.get(`http://localhost:3000/api/reports/export/${userId}`, {
    headers: {
      Authorization: `Bearer ${token.access_token}`
    }
  });
  
  if (!response.ok()) {
    console.log('Response status:', response.status());
    console.log('Response body:', await response.text());
  }
  expect(response.ok()).toBeTruthy();
  expect(response.headers()['content-type']).toBe('application/vnd.openxmlformats-officedocument.wordprocessingml.document');
  expect(response.headers()['content-disposition']).toContain('attachment; filename="Wellness_Report.docx"');
});
