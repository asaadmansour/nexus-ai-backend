import {
  Injectable,
  Logger,
  InternalServerErrorException,
} from '@nestjs/common';
import { MailerService } from '@nestjs-modules/mailer';

@Injectable()
export class EmailService {
  private readonly logger = new Logger(EmailService.name);

  constructor(private readonly mailerService: MailerService) {}

  private maskEmail(email: string): string {
    const [local, domain] = email.split('@');
    if (!domain) return '***@***';
    const firstChar = local.charAt(0) || '*';
    const lastChar = local.length > 1 ? local.charAt(local.length - 1) : '';
    return `${firstChar}***${lastChar}@${domain}`;
  }

  async sendVerificationEmail(email: string, code: string) {
    const maskedEmail = this.maskEmail(email);

    if (!process.env.SMTP_USER || !process.env.SMTP_PASSWORD) {
      if (process.env.NODE_ENV !== 'production') {
        this.logger.warn(
          `[DEV MODE] Verification code for ${maskedEmail}: ${code}`,
        );
        return;
      }
      this.logger.error(
        `[PROD MODE] Mailer credentials missing for ${maskedEmail}`,
      );
      throw new InternalServerErrorException(
        'Email service configuration missing',
      );
    }

    try {
      await this.mailerService.sendMail({
        to: email,
        subject: 'Verify your Nexus AI email address',
        html: `
          <div style="font-family: Arial, sans-serif; padding: 20px; color: #333;">
            <h2>Welcome to Nexus AI!</h2>
            <p>Please use the following 6-digit code to verify your email address:</p>
            <h1 style="background: #f4f4f4; padding: 12px; display: inline-block; letter-spacing: 4px; border-radius: 4px;">
              ${code}
            </h1>
            <p>This code will expire in 15 minutes.</p>
            <p>If you didn't request this, you can safely ignore this email.</p>
          </div>
        `,
      });
      this.logger.log(`Verification email sent to ${maskedEmail}`);
    } catch (error) {
      this.logger.error(
        `Failed to send verification email to ${maskedEmail}`,
        error,
      );
      throw new InternalServerErrorException(
        'Could not dispatch verification email',
      );
    }
  }

  async sendTransactionalEmail(
    email: string,
    subject: string,
    input: { body: string; actionUrl?: string | null; actionLabel?: string },
  ) {
    const maskedEmail = this.maskEmail(email);
    if (!process.env.SMTP_USER || !process.env.SMTP_PASSWORD) {
      if (process.env.NODE_ENV !== 'production') {
        this.logger.log(`[DEV MODE] ${subject} -> ${maskedEmail}`);
        return;
      }
      throw new InternalServerErrorException(
        'Email service configuration missing',
      );
    }

    const escapedBody = input.body
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/\n/g, '<br>');
    const action = input.actionUrl
      ? `<p><a href="${input.actionUrl}" style="display:inline-block;padding:10px 16px;background:#324933;color:#fff;text-decoration:none;border-radius:6px">${input.actionLabel ?? 'Open Nexus AI'}</a></p>`
      : '';
    await this.mailerService.sendMail({
      to: email,
      subject,
      html: `<div style="font-family:Arial,sans-serif;padding:20px;color:#222"><h2>${subject}</h2><p>${escapedBody}</p>${action}</div>`,
    });
  }
}
