import nodemailer from 'nodemailer';

export interface ProjectCompletedEmailInput {
  to: string;
  displayName: string;
  projectName: string;
  projectUrl: string;
  succeededCount: number;
  failedCount: number;
  refundedPoints: number;
}

export interface ProjectFailedEmailInput {
  to: string;
  displayName: string;
  projectName: string;
  refundedPoints: number;
}

export interface ProjectRefundEmailInput {
  to: string;
  displayName: string;
  projectName: string;
  refundedPoints: number;
}

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

async function sendMailWithTransporter(options: {
  to: string;
  subject: string;
  text: string;
  html: string;
}): Promise<MailDeliveryResult> {
  if (shouldUseLocalLogDelivery()) {
    console.warn(`[mailer] Local delivery: to=${options.to} subject=${options.subject}`);
    return { sent: true, reason: 'local_log_delivery' };
  }

  const host = readEnv('SMTP_HOST');
  const from = readEnv('SMTP_FROM');
  if (!host || !from) {
    return { sent: false, reason: 'smtp_not_configured' };
  }

  const port = Number(readEnv('SMTP_PORT') || 587);
  const secureValue = readEnv('SMTP_SECURE').toLowerCase();
  const secure = secureValue ? secureValue === 'true' || secureValue === '1' || secureValue === 'yes' : port === 465;
  const user = readEnv('SMTP_USER');
  const pass = readEnv('SMTP_PASS');
  const auth = user && pass ? { user, pass } : undefined;
  const transporter = nodemailer.createTransport({ host, port, secure, auth });
  await transporter.sendMail({ from, ...options });
  return { sent: true };
}

function buildProjectCompletedHtml(input: ProjectCompletedEmailInput) {
  const partialNote =
    input.failedCount > 0
      ? `<p style="color:#b45309">注意：有 ${input.failedCount} 张照片处理失败，您可以返回项目重新处理失败的照片。</p>`
      : '';
  const refundNote =
    input.refundedPoints > 0
      ? `<p style="color:#059669">已自动退还 ${input.refundedPoints} 积分（失败照片未扣费）。</p>`
      : '';
  return `
    <div style="font-family:Arial,sans-serif;line-height:1.6;color:#111">
      <h2>您的项目已处理完成 🎉</h2>
      <p>您好 ${escapeHtml(input.displayName || input.to)}，</p>
      <p>项目 <strong>${escapeHtml(input.projectName)}</strong> 已完成处理，共成功 ${input.succeededCount} 张。</p>
      ${partialNote}
      ${refundNote}
      <p>
        <a href="${escapeHtml(input.projectUrl)}" style="display:inline-block;background:#111;color:#fff;padding:12px 18px;border-radius:10px;text-decoration:none">
          查看并下载结果
        </a>
      </p>
      <p style="color:#666;font-size:12px">Metrovan AI</p>
    </div>
  `;
}

function buildProjectFailedHtml(input: ProjectFailedEmailInput) {
  const refundNote =
    input.refundedPoints > 0
      ? `<p style="color:#059669">已自动退还全部 ${input.refundedPoints} 积分，无需担心费用问题。</p>`
      : '<p style="color:#059669">本次处理未扣除积分。</p>';
  return `
    <div style="font-family:Arial,sans-serif;line-height:1.6;color:#111">
      <h2>项目处理未能完成</h2>
      <p>您好 ${escapeHtml(input.displayName || input.to)}，</p>
      <p>很遗憾，项目 <strong>${escapeHtml(input.projectName)}</strong> 处理失败，没有成功的结果图。</p>
      ${refundNote}
      <p>您可以回到网站重新处理该项目，或联系客服获取帮助。</p>
      <p style="color:#666;font-size:12px">Metrovan AI</p>
    </div>
  `;
}

function buildProjectRefundHtml(input: ProjectRefundEmailInput) {
  return `
    <div style="font-family:Arial,sans-serif;line-height:1.6;color:#111">
      <h2>积分已自动退还</h2>
      <p>您好 ${escapeHtml(input.displayName || input.to)}，</p>
      <p>项目 <strong>${escapeHtml(input.projectName)}</strong> 处理结束后，系统已自动退还 <strong>${input.refundedPoints} 积分</strong>（实际处理张数少于预扣数量）。</p>
      <p>积分已实时到账，可在账户中查看明细。</p>
      <p style="color:#666;font-size:12px">Metrovan AI</p>
    </div>
  `;
}

export async function sendProjectCompletedEmail(input: ProjectCompletedEmailInput): Promise<MailDeliveryResult> {
  const subject =
    input.failedCount > 0
      ? `项目部分完成：${input.projectName}`
      : `项目处理完成：${input.projectName}`;
  const textLines = [
    `您好 ${input.displayName || input.to}，`,
    '',
    `项目"${input.projectName}"已处理完成，成功 ${input.succeededCount} 张${input.failedCount > 0 ? `，失败 ${input.failedCount} 张` : ''}。`,
    input.refundedPoints > 0 ? `已自动退还 ${input.refundedPoints} 积分。` : '',
    '',
    `查看结果：${input.projectUrl}`
  ].filter((line) => line !== undefined);
  return sendMailWithTransporter({
    to: input.to,
    subject,
    text: textLines.join('\n'),
    html: buildProjectCompletedHtml(input)
  });
}

export async function sendProjectFailedEmail(input: ProjectFailedEmailInput): Promise<MailDeliveryResult> {
  return sendMailWithTransporter({
    to: input.to,
    subject: `项目处理失败：${input.projectName}`,
    text: [
      `您好 ${input.displayName || input.to}，`,
      '',
      `项目"${input.projectName}"处理失败，没有成功的结果图。`,
      input.refundedPoints > 0 ? `已自动退还全部 ${input.refundedPoints} 积分。` : '本次处理未扣除积分。',
      '',
      '您可以回到网站重新处理，或联系客服获取帮助。'
    ].join('\n'),
    html: buildProjectFailedHtml(input)
  });
}

export async function sendProjectRefundEmail(input: ProjectRefundEmailInput): Promise<MailDeliveryResult> {
  return sendMailWithTransporter({
    to: input.to,
    subject: `积分已退还：${input.projectName}`,
    text: [
      `您好 ${input.displayName || input.to}，`,
      '',
      `项目"${input.projectName}"处理结束后，系统已自动退还 ${input.refundedPoints} 积分。`,
      '积分已实时到账，可在账户中查看明细。'
    ].join('\n'),
    html: buildProjectRefundHtml(input)
  });
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
