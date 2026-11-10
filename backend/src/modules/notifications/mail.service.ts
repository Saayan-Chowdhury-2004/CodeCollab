import crypto from 'crypto';
import nodemailer, { Transporter } from 'nodemailer';
import { env } from '../../config/env.ts';
import { logger } from '../../config/logger.ts';

export interface MailMessage {
  to: string;
  subject: string;
  text: string;
  html?: string;
  metadata?: Record<string, unknown>;
}

export interface MailDeliveryResult {
  delivered: boolean;
  provider: 'console' | 'smtp';
  messageId: string;
  timestamp: string;
}

export interface MailService {
  sendMail(message: MailMessage): Promise<MailDeliveryResult>;
}

export interface RecordedConsoleEmail extends MailMessage, MailDeliveryResult {}

/**
 * Mock email implementation that logs structured email payloads via Pino
 * and keeps a bounded in-memory ring buffer so automated tests can inspect dispatches.
 */
export class ConsoleMailService implements MailService {
  private sentMessages: RecordedConsoleEmail[] = [];
  private readonly maxBufferSize = 200;

  public async sendMail(message: MailMessage): Promise<MailDeliveryResult> {
    const result: MailDeliveryResult = {
      delivered: true,
      provider: 'console',
      messageId: `console-${crypto.randomUUID()}`,
      timestamp: new Date().toISOString(),
    };

    const recorded: RecordedConsoleEmail = {
      ...message,
      ...result,
    };

    this.sentMessages.push(recorded);
    if (this.sentMessages.length > this.maxBufferSize) {
      this.sentMessages.shift();
    }

    logger.info(
      {
        mailProvider: 'console',
        messageId: result.messageId,
        to: message.to,
        subject: message.subject,
        metadata: message.metadata,
      },
      '[ConsoleMailService] Mock email notification dispatched'
    );

    return result;
  }

  public getSentMessages(): RecordedConsoleEmail[] {
    return [...this.sentMessages];
  }

  public clearSentMessages(): void {
    this.sentMessages = [];
  }
}

/**
 * Real SMTP email implementation using Nodemailer, enabled when MAIL_PROVIDER=smtp.
 */
export class SmtpMailService implements MailService {
  private transporter: Transporter;

  constructor() {
    this.transporter = nodemailer.createTransport({
      host: env.SMTP_HOST || 'localhost',
      port: env.SMTP_PORT || 587,
      secure: env.SMTP_PORT === 465,
      auth:
        env.SMTP_USER && env.SMTP_PASS
          ? {
              user: env.SMTP_USER,
              pass: env.SMTP_PASS,
            }
          : undefined,
    });
  }

  public async sendMail(message: MailMessage): Promise<MailDeliveryResult> {
    const info = await this.transporter.sendMail({
      from: env.SMTP_FROM,
      to: message.to,
      subject: message.subject,
      text: message.text,
      html: message.html,
    });

    return {
      delivered: true,
      provider: 'smtp',
      messageId: info.messageId || `smtp-${crypto.randomUUID()}`,
      timestamp: new Date().toISOString(),
    };
  }
}

export const consoleMailService = new ConsoleMailService();

export const mailService: MailService =
  env.MAIL_PROVIDER === 'smtp' ? new SmtpMailService() : consoleMailService;
