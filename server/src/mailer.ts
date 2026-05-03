import nodemailer from 'nodemailer';

export interface PasswordResetEmailInput {
  to: string;
  displayName: string;
  resetUrl: string;
  expiresAt: string;
}

export interface EmailVerificationEmailInput {
  to: string;
  displayName: string;
  verificationCode: string;
  verificationUrl: string;
  expiresAt: string;
}

export interface MailDeliveryResult {
  sent: boolean;
  reason?: string;
}

function readEnv(name: string) {
  return process.env[name]?.trim() ?? '';
}

function shouldLogResetLinks() {
  const explicit = (readEnv('AUTH_EMAIL_LOG_LINKS') || readEnv('PASSWORD_RESET_LOG_LINKS')).toLowerCase();
  if (explicit === 'true' || explicit === '1' || explicit === 'yes') {
    return true;
  }
  if (explicit === 'false' || explicit === '0' || explicit === 'no') {
    return false;
  }
  return process.env.NODE_ENV !== 'production';
}

function shouldUseLocalLogDelivery() {
  if (process.env.NODE_ENV === 'production') {
    return false;
  }
  const explicit = readEnv('AUTH_EMAIL_LOG_DELIVERY').toLowerCase();
  return explicit === 'true' || explicit === '1' || explicit === 'yes';
}

function buildResetEmailHtml(input: PasswordResetEmailInput) {
  const expiresAt = new Date(input.expiresAt).toLocaleString('en-US', {
    dateStyle: 'medium',
    timeStyle: 'short'
  });
  return `
    <div style="font-family:Arial,sans-serif;line-height:1.6;color:#111">
      <h2>Reset your Metrovan AI password</h2>
      <p>Hello ${escapeHtml(input.displayName || input.to)},</p>
      <p>Use the button below to set a new password. This link expires at ${escapeHtml(expiresAt)}.</p>
      <p>
        <a href="${escapeHtml(input.resetUrl)}" style="display:inline-block;background:#111;color:#fff;padding:12px 18px;border-radius:10px;text-decoration:none">
          Reset password
        </a>
      </p>
      <p>If you did not request this, you can ignore this email.</p>
      <p style="color:#666;font-size:12px">Metrovan AI</p>
    </div>
  `;
}

function buildVerificationEmailHtml(input: EmailVerificationEmailInput) {
  const expiresAt = formatEmailDate(input.expiresAt);
  return `
    <div style="font-family:Arial,sans-serif;line-height:1.6;color:#111">
      <h2>Verify your Metrovan AI email</h2>
      <p>Hello ${escapeHtml(input.displayName || input.to)},</p>
      <p>Enter this verification code on Metrovan AI. This code expires at ${escapeHtml(expiresAt)}.</p>
      <p style="font-size:30px;letter-spacing:8px;font-weight:700;background:#f4f4f4;border-radius:12px;padding:14px 18px;display:inline-block">
        ${escapeHtml(input.verificationCode)}
      </p>
      <p>If the verification page is not open, you can open it here:</p>
      <p>
        <a href="${escapeHtml(input.verificationUrl)}" style="display:inline-block;background:#111;color:#fff;padding:12px 18px;border-radius:10px;text-decoration:none">
          Open verification page
        </a>
      </p>
      <p>If you did not create a Metrovan AI account, you can ignore this email.</p>
      <p style="color:#666;font-size:12px">Metrovan AI</p>
    </div>
  `;
}

function formatEmailDate(value: string) {
  return new Date(value).toLocaleString('en-US', {
    dateStyle: 'medium',
    timeStyle: 'short'
  });
}

function escapeHtml(value: string) {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

export async function sendPasswordResetEmail(input: PasswordResetEmailInput): Promise<MailDeliveryResult> {
  if (shouldUseLocalLogDelivery()) {
    console.warn(`[password-reset] Reset link for ${input.to}: ${input.resetUrl}`);
    return { sent: true, reason: 'local_log_delivery' };
  }

  const host = readEnv('SMTP_HOST');
  const from = readEnv('SMTP_FROM');
  if (!host || !from) {
    if (shouldLogResetLinks()) {
      console.warn(`[password-reset] Reset link for ${input.to}: ${input.resetUrl}`);
    }
    return { sent: false, reason: 'smtp_not_configured' };
  }

  const port = Number(readEnv('SMTP_PORT') || 587);
  const secureValue = readEnv('SMTP_SECURE').toLowerCase();
  const secure = secureValue ? secureValue === 'true' || secureValue === '1' || secureValue === 'yes' : port === 465;
  const user = readEnv('SMTP_USER');
  const pass = readEnv('SMTP_PASS');
  const auth = user && pass ? { user, pass } : undefined;

  const transporter = nodemailer.createTransport({
    host,
    port,
    secure,
    auth
  });

  const expiresAt = formatEmailDate(input.expiresAt);
  await transporter.sendMail({
    from,
    to: input.to,
    subject: 'Reset your Metrovan AI password',
    text: [
      `Hello ${input.displayName || input.to},`,
      '',
      'Use this link to set a new Metrovan AI password:',
      input.resetUrl,
      '',
      `This link expires at ${expiresAt}.`,
      'If you did not request this, you can ignore this email.'
    ].join('\n'),
    html: buildResetEmailHtml(input)
  });

  return { sent: true };
}

export async function sendEmailVerificationEmail(input: EmailVerificationEmailInput): Promise<MailDeliveryResult> {
  if (shouldUseLocalLogDelivery()) {
    console.warn(`[email-verification] Verification code for ${input.to}: ${input.verificationCode} ${input.verificationUrl}`);
    return { sent: true, reason: 'local_log_delivery' };
  }

  const host = readEnv('SMTP_HOST');
  const from = readEnv('SMTP_FROM');
  if (!host || !from) {
    if (shouldLogResetLinks()) {
      console.warn(`[email-verification] Verification code for ${input.to}: ${input.verificationCode} ${input.verificationUrl}`);
    }
    return { sent: false, reason: 'smtp_not_configured' };
  }

  const port = Number(readEnv('SMTP_PORT') || 587);
  const secureValue = readEnv('SMTP_SECURE').toLowerCase();
  const secure = secureValue ? secureValue === 'true' || secureValue === '1' || secureValue === 'yes' : port === 465;
  const user = readEnv('SMTP_USER');
  const pass = readEnv('SMTP_PASS');
  const auth = user && pass ? { user, pass } : undefined;
  const transporter = nodemailer.createTransport({
    host,
    port,
    secure,
    auth
  });

  const expiresAt = formatEmailDate(input.expiresAt);
  await transporter.sendMail({
    from,
    to: input.to,
    subject: 'Verify your Metrovan AI email',
    text: [
      `Hello ${input.displayName || input.to},`,
      '',
      'Enter this verification code on Metrovan AI:',
      input.verificationCode,
      '',
      'Open the verification page:',
      input.verificationUrl,
      '',
      `This code expires at ${expiresAt}.`,
      'If you did not create a Metrovan AI account, you can ignore this email.'
    ].join('\n'),
    html: buildVerificationEmailHtml(input)
  });

  return { sent: true };
}
