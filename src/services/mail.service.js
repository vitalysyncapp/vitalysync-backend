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

export function buildVerificationEmail({
  username,
  verificationCode,
  expiresInMinutes = 10,
  locale = 'en',
}) {
  const isFilipino = locale === 'fil' || locale === 'tl';
  const displayName = String(username ?? '').trim() || (isFilipino ? 'kaibigan' : 'there');
  const subject = isFilipino
    ? 'I-verify ang VitalySync email mo'
    : 'Verify your VitalySync email';
  const greeting = `Hi ${displayName},`;
  const instruction = isFilipino
    ? 'I-enter ang verification code na ito sa VitalySync:'
    : 'Enter this verification code in VitalySync:';
  const expiry = isFilipino
    ? `Mag-e-expire ang code na ito sa loob ng ${expiresInMinutes} minuto at isang beses lang magagamit.`
    : `This code expires in ${expiresInMinutes} minutes and can only be used once.`;
  const safety = isFilipino
    ? 'Kung hindi ikaw ang gumawa o nag-update ng VitalySync account, puwede mong i-ignore ang email na ito.'
    : 'If you did not create or update a VitalySync account, you can ignore this email.';
  return {
    subject,
    text: [greeting, '', instruction, String(verificationCode), '', expiry, '', safety].join('\n'),
    html: `
      <p>${escapeHtml(greeting)}</p>
      <p>${escapeHtml(instruction)}</p>
      <p style="font-size: 30px; font-weight: 700; letter-spacing: 8px;">${escapeHtml(verificationCode)}</p>
      <p>${escapeHtml(expiry)}</p>
      <p>${escapeHtml(safety)}</p>
    `,
  };
}

async function sendVerificationEmail({
  to,
  username,
  verificationCode,
  expiresInMinutes = 10,
  locale = 'en',
}) {
  const { subject, text, html } = buildVerificationEmail({
    username,
    verificationCode,
    expiresInMinutes,
    locale,
  });

  return sendMail({
    to,
    subject,
    text,
    html,
  });
}

export function buildPasswordResetEmail({
  username,
  resetCode,
  expiresInMinutes = 10,
  locale = 'en',
}) {
  const isFilipino = locale === 'fil' || locale === 'tl';
  const displayName = String(username ?? '').trim() || (isFilipino ? 'kaibigan' : 'there');
  const subject = isFilipino
    ? 'I-reset ang VitalySync password mo'
    : 'Reset your VitalySync password';
  const greeting = `Hi ${displayName},`;
  const instruction = isFilipino
    ? 'I-enter ang password reset code na ito sa VitalySync:'
    : 'Enter this password reset code in VitalySync:';
  const expiry = isFilipino
    ? `Mag-e-expire ang code na ito sa loob ng ${expiresInMinutes} minuto at isang beses lang magagamit.`
    : `This code expires in ${expiresInMinutes} minutes and can only be used once.`;
  const safety = isFilipino
    ? 'Kung hindi ka humiling ng password reset, puwede mong i-ignore ang email na ito.'
    : 'If you did not request a password reset, you can ignore this email.';
  return {
    subject,
    text: [greeting, '', instruction, String(resetCode), '', expiry, safety].join('\n'),
    html: `
      <p>${escapeHtml(greeting)}</p>
      <p>${escapeHtml(instruction)}</p>
      <p style="font-size: 30px; font-weight: 700; letter-spacing: 8px;">${escapeHtml(resetCode)}</p>
      <p>${escapeHtml(expiry)}</p>
      <p>${escapeHtml(safety)}</p>
    `,
  };
}

async function sendPasswordResetEmail({
  to,
  username,
  resetCode,
  expiresInMinutes = 10,
  locale = 'en',
}) {
  const { subject, text, html } = buildPasswordResetEmail({
    username,
    resetCode,
    expiresInMinutes,
    locale,
  });

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
