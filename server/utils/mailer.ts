/**
 * Verification-code mailer (SMTP).
 *
 * Design rules:
 *   - **Never throw to the caller.** `sendVerificationCode()` resolves to a
 *     boolean so a broken/absent SMTP config degrades gracefully instead of
 *     taking down the auth route.
 *   - **Opt-in.** When SMTP env vars are absent, `isMailConfigured()` is false
 *     and nothing is sent — existing dev-mode echo behaviour stays intact.
 *
 * Required env vars (all optional; mail is disabled until all are present):
 *   SMTP_HOST   e.g. smtp.qq.com
 *   SMTP_PORT   465 (implicit TLS) or 587 (STARTTLS)
 *   SMTP_USER   full mailbox address, e.g. you@qq.com
 *   SMTP_PASS   the *authorisation code* from your mailbox, NOT the login password
 *   MAIL_FROM   optional display sender, defaults to SMTP_USER
 */
import nodemailer from 'nodemailer';

const SMTP_HOST = process.env.SMTP_HOST ?? '';
const SMTP_PORT = Number(process.env.SMTP_PORT) || 465;
const SMTP_USER = process.env.SMTP_USER ?? '';
const SMTP_PASS = process.env.SMTP_PASS ?? '';
const MAIL_FROM = process.env.MAIL_FROM || SMTP_USER;

/** True only when the minimum SMTP trio is present. */
export function isMailConfigured(): boolean {
  return Boolean(SMTP_HOST && SMTP_USER && SMTP_PASS);
}

let transporter: nodemailer.Transporter | null = null;

function getTransporter(): nodemailer.Transporter {
  if (!transporter) {
    transporter = nodemailer.createTransport({
      host: SMTP_HOST,
      port: SMTP_PORT,
      // 465 => implicit TLS from the start; anything else => STARTTLS upgrade
      secure: SMTP_PORT === 465,
      auth: { user: SMTP_USER, pass: SMTP_PASS },
      // Force IPv4. Some hosts (Railway free trial, notably) resolve to an
      // IPv6 address that is unroutable from the container, producing
      // ENETUNREACH on every send. Pinning to IPv4 works around that.
      family: 4,
      // Tight budgets: a stalled SMTP handshake must not leave the user
      // staring at a spinner. Worst case is ~18s instead of the previous ~32s.
      connectionTimeout: 8_000,
      greetingTimeout: 8_000,
      socketTimeout: 10_000,
    });
  }
  return transporter;
}

/**
 * Send the 6-digit login/register code to the user's mailbox.
 * Resolves `false` on any failure — the caller decides how to surface it.
 */
export async function sendVerificationCode(
  to: string,
  code: string,
): Promise<boolean> {
  if (!isMailConfigured()) {
    console.warn('[Mailer] SMTP 未配置，跳过发送（需 SMTP_HOST/SMTP_USER/SMTP_PASS）');
    return false;
  }

  try {
    const info = await getTransporter().sendMail({
      from: MAIL_FROM,
      to,
      subject: '【念念】你的登录验证码',
      text: `你的验证码是 ${code}，5 分钟内有效。\n\n如果不是你本人操作，请忽略这封邮件。`,
      html: `
        <div style="font-family:-apple-system,'PingFang SC','Microsoft YaHei',sans-serif;max-width:420px;margin:0 auto;padding:32px;color:#2c2c2a;">
          <h2 style="margin:0 0 20px;font-size:20px;font-weight:500;color:#d4a853;">念念</h2>
          <p style="margin:0 0 20px;font-size:15px;line-height:1.7;">你好，</p>
          <p style="margin:0 0 24px;font-size:15px;line-height:1.7;">你正在登录「念念」，验证码是：</p>
          <div style="margin:0 0 24px;padding:18px 0;text-align:center;background:#faf8f4;border-radius:12px;">
            <span style="font-size:32px;font-weight:500;letter-spacing:8px;color:#2c2c2a;">${code}</span>
          </div>
          <p style="margin:0 0 8px;font-size:13px;line-height:1.7;color:#888780;">验证码 5 分钟内有效，请勿转发给任何人。</p>
          <p style="margin:0;font-size:13px;line-height:1.7;color:#888780;">如果不是你本人操作，忽略这封邮件即可。</p>
        </div>
      `.trim(),
    });
    console.log(`[Mailer] 验证码已发送至 ${to} (messageId=${info.messageId})`);
    return true;
  } catch (err) {
    console.error('[Mailer] 发送失败:', (err as Error)?.message ?? err);
    // Drop the cached transporter so a transient failure doesn't poison retries
    transporter = null;
    return false;
  }
}
