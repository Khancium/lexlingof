import nodemailer, { type Transporter } from "nodemailer";

/**
 * SMTP is entirely optional at boot -- this codebase has no email
 * infrastructure otherwise, so rather than making the whole server refuse to
 * start without mail credentials, the transporter is created lazily and
 * every send falls back to logging the message when SMTP_HOST isn't set.
 * That keeps "forgot password" testable locally with zero setup; wiring in
 * a real provider later is just filling in the env vars below.
 */
let transporter: Transporter | null | undefined;

function getTransporter(): Transporter | null {
  if (transporter !== undefined) return transporter;

  if (!process.env.SMTP_HOST) {
    transporter = null;
    return transporter;
  }

  transporter = nodemailer.createTransport({
    host: process.env.SMTP_HOST,
    port: Number(process.env.SMTP_PORT ?? 587),
    secure: process.env.SMTP_SECURE === "true",
    auth: process.env.SMTP_USER ? { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS } : undefined,
  });

  return transporter;
}

async function sendMail(to: string, subject: string, text: string, html: string): Promise<void> {
  const client = getTransporter();

  if (!client) {
    console.log(`[mailer] SMTP not configured -- would send "${subject}" to ${to}:\n${text}`);
    return;
  }

  await client.sendMail({
    from: process.env.SMTP_FROM || "Lexlingo <no-reply@lexlingo.app>",
    to,
    subject,
    text,
    html,
  });
}

export async function sendPasswordResetEmail(to: string, resetUrl: string): Promise<void> {
  const text = `Someone requested a password reset for this Lexlingo account. Click the link below to choose a new password -- this link expires in 1 hour and can only be used once:\n\n${resetUrl}\n\nIf you didn't request this, you can safely ignore this email.`;
  const html = `
    <p>Someone requested a password reset for this Lexlingo account.</p>
    <p><a href="${resetUrl}">Click here to choose a new password</a> -- this link expires in 1 hour and can only be used once.</p>
    <p>If you didn't request this, you can safely ignore this email.</p>
  `;
  await sendMail(to, "Reset your Lexlingo password", text, html);
}
