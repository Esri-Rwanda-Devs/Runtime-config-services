import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createTransport, type Transporter } from 'nodemailer';
import {
  readMonitorAlertSettings,
  type MonitorAlertSettings,
} from './monitor-alert-settings';
import {
  alertCount,
  composeAlertEmail,
  composeTestEmail,
  type AlertEmail,
  type AlertPlan,
} from './monitor-alerts';
import { sanitizeDetail } from './monitor-sanitize';

export type AlertDelivery = {
  at: string;
  kind: 'alert' | 'test' | 'summary';
  ok: boolean;
  /** Sanitized SMTP error; never contains the SMTP password. */
  error: string | null;
};

export type SendMail = (message: {
  from: string;
  to: string[];
  subject: string;
  text: string;
  html: string;
}) => Promise<unknown>;

@Injectable()
export class MonitorAlertService {
  private readonly logger = new Logger(MonitorAlertService.name);
  readonly settings: MonitorAlertSettings;
  private transporter: Transporter | null = null;
  private last: AlertDelivery | null = null;

  constructor(configService: ConfigService) {
    this.settings = readMonitorAlertSettings((key) =>
      configService.get<string>(key),
    );
    if (this.settings.error) {
      this.logger.warn(`Email alerts off: ${this.settings.error}`);
    }
    if (this.settings.summaryError) {
      this.logger.warn(`Daily summary off: ${this.settings.summaryError}`);
    }
  }

  lastDelivery(): AlertDelivery | null {
    return this.last;
  }

  /** Emails the plan if it has anything in it. Never throws. */
  async notify(plan: AlertPlan): Promise<void> {
    if (!this.settings.configured || alertCount(plan) === 0) return;
    const email = composeAlertEmail(plan, {
      statusUrl: this.settings.statusUrl,
    });
    await this.deliver('alert', email);
  }

  /** Sends a test email; resolves with the delivery result. */
  async sendTest(requestedBy: string): Promise<AlertDelivery> {
    return this.deliver(
      'test',
      composeTestEmail(requestedBy, { statusUrl: this.settings.statusUrl }),
    );
  }

  /** Sends a composed daily summary; resolves with the delivery result. */
  async sendSummary(email: AlertEmail): Promise<AlertDelivery> {
    return this.deliver('summary', email);
  }

  /** Exposed for tests. */
  protected sendMail: SendMail = (message) =>
    this.transport().sendMail(message);

  private transport(): Transporter {
    if (!this.transporter) {
      const { smtp } = this.settings;
      this.transporter = createTransport({
        host: smtp.host,
        port: smtp.port,
        secure: smtp.secure,
        requireTLS: !smtp.secure && smtp.requireTls,
        auth: smtp.user
          ? { user: smtp.user, pass: smtp.password ?? '' }
          : undefined,
        connectionTimeout: 10_000,
        greetingTimeout: 10_000,
        socketTimeout: 20_000,
      });
    }
    return this.transporter;
  }

  private async deliver(
    kind: AlertDelivery['kind'],
    email: AlertEmail,
  ): Promise<AlertDelivery> {
    const at = new Date().toISOString();
    try {
      await this.sendMail({
        from: this.settings.from,
        to: this.settings.to,
        subject: email.subject,
        text: email.text,
        html: email.html,
      });
      this.last = { at, kind, ok: true, error: null };
      this.logger.log(`Status ${kind} email sent: ${email.subject}`);
    } catch (error) {
      const secrets = this.settings.smtp.password
        ? [this.settings.smtp.password]
        : [];
      const message =
        sanitizeDetail(
          error instanceof Error ? error.message : String(error),
          secrets,
        ) ?? 'Unknown SMTP error';
      this.last = { at, kind, ok: false, error: message };
      this.logger.error(`Status ${kind} email failed: ${message}`);
    }
    return this.last;
  }
}
