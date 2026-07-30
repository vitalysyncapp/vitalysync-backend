import nodemailer from 'nodemailer';

const DEFAULT_SMTP_PORT = 587;

function parseBoolean(value, fallback) {
  if (value == null || String(value).trim() === '') {
    return fallback;
  }

  const normalized = String(value).trim().toLowerCase();
  if (normalized === 'true') return true;
  if (normalized === 'false') return false;
  return fallback;
}

function parsePort(value) {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : DEFAULT_SMTP_PORT;
}

function smtpConfig() {
  const host = String(process.env.SMTP_HOST ?? '').trim();
  if (!host) {
    return null;
  }

  const user = String(process.env.SMTP_USER ?? '').trim();
  const pass = String(process.env.SMTP_PASS ?? '').trim();

  return {
    host,
    port: parsePort(process.env.SMTP_PORT),
    secure: parseBoolean(process.env.SMTP_SECURE, false),
    auth: user && pass ? { user, pass } : undefined,
  };
}

function mailFrom() {
  return (
    String(process.env.SMTP_FROM ?? '').trim() ||
    'VitalySync <no-reply@vitalysync.local>'
  );
}

function createTransporter() {
  const config = smtpConfig();
  if (!config) {
    return null;
  }

  return nodemailer.createTransport(config);
}

function escapeHtml(value) {
  return String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

async function sendMail(message) {
  const transporter = createTransporter();

  if (!transporter) {
    if (process.env.NODE_ENV === 'production') {
      throw new Error('SMTP_HOST is required to send email in production');
    }

    console.info('[dev mail]', {
      subject: message.subject,
      preview: 'Configure Brevo SMTP to deliver this authentication email.',
    });
    return { accepted: [message.to], preview: 'console' };
  }

  return transporter.sendMail({
    from: mailFrom(),
    ...message,
  });
}

async function sendVerificationEmail({
  to,
  username,
  verificationCode,
  expiresInMinutes = 10,
}) {
  const displayName = String(username ?? '').trim() || 'there';
  const subject = 'Verify your VitalySync email';
  const text = [
    `Hi ${displayName},`,
    '',
    'Enter this verification code in VitalySync:',
    String(verificationCode),
    '',
    `This code expires in ${expiresInMinutes} minutes and can only be used once.`,
    '',
    'If you did not create or update a VitalySync account, you can ignore this email.',
  ].join('\n');
  const html = `
    <p>Hi ${escapeHtml(displayName)},</p>
    <p>Enter this verification code in VitalySync:</p>
    <p style="font-size: 30px; font-weight: 700; letter-spacing: 8px;">${escapeHtml(verificationCode)}</p>
    <p>This code expires in ${escapeHtml(expiresInMinutes)} minutes and can only be used once.</p>
    <p>If you did not create or update a VitalySync account, you can ignore this email.</p>
  `;

  return sendMail({
    to,
    subject,
    text,
    html,
  });
}

async function sendPasswordResetEmail({
  to,
  username,
  resetCode,
  expiresInMinutes = 10,
}) {
  const displayName = String(username ?? '').trim() || 'there';
  const subject = 'Reset your VitalySync password';
  const text = [
    `Hi ${displayName},`,
    '',
    'Enter this password reset code in VitalySync:',
    String(resetCode),
    '',
    `This code expires in ${expiresInMinutes} minutes and can only be used once.`,
    'If you did not request a password reset, you can ignore this email.',
  ].join('\n');
  const html = `
    <p>Hi ${escapeHtml(displayName)},</p>
    <p>Enter this password reset code in VitalySync:</p>
    <p style="font-size: 30px; font-weight: 700; letter-spacing: 8px;">${escapeHtml(resetCode)}</p>
    <p>This code expires in ${escapeHtml(expiresInMinutes)} minutes and can only be used once.</p>
    <p>If you did not request a password reset, you can ignore this email.</p>
  `;

  return sendMail({
    to,
    subject,
    text,
    html,
  });
}

export const mailService = {
  sendVerificationEmail,
  sendPasswordResetEmail,
};
