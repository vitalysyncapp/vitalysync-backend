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
      to: message.to,
      subject: message.subject,
      text: message.text,
    });
    return { accepted: [message.to], preview: 'console' };
  }

  return transporter.sendMail({
    from: mailFrom(),
    ...message,
  });
}

async function sendVerificationEmail({ to, username, verificationUrl }) {
  const displayName = String(username ?? '').trim() || 'there';
  const subject = 'Verify your VitalySync email';
  const text = [
    `Hi ${displayName},`,
    '',
    'Please verify your email address for VitalySync:',
    verificationUrl,
    '',
    'If you did not create or update a VitalySync account, you can ignore this email.',
  ].join('\n');
  const html = `
    <p>Hi ${escapeHtml(displayName)},</p>
    <p>Please verify your email address for VitalySync.</p>
    <p><a href="${escapeHtml(verificationUrl)}">Verify email</a></p>
    <p>If you did not create or update a VitalySync account, you can ignore this email.</p>
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
};
