/** Email alert settings for the status monitor, read from the environment. */
export type MonitorAlertSettings = {
  /** True when SMTP host, sender and at least one recipient are set and valid. */
  configured: boolean;
  /** Why alerts are off although some alert settings are present. */
  error: string | null;
  from: string;
  to: string[];
  smtp: {
    host: string;
    port: number;
    /** TLS from the first byte (usually port 465). */
    secure: boolean;
    /** Refuse to send unless the server upgrades to TLS (STARTTLS). */
    requireTls: boolean;
    user: string | null;
    password: string | null;
  };
  /** Reminder interval while a check stays red; 0 turns reminders off. */
  remindMs: number;
  /** Link to the admin Status page, included in emails when set. */
  statusUrl: string | null;
  /** UTC hour (0-23) of the daily summary email; null = no summary. */
  summaryHourUtc: number | null;
  /** Why MONITOR_SUMMARY_HOUR was ignored, when it was. */
  summaryError: string | null;
};

type EnvReader = (key: string) => string | undefined;

const EMAIL_PATTERN = /^[^\s@<>()",;]+@[^\s@<>()",;]+\.[^\s@<>()",;]+$/;

export function isEmailAddress(value: string): boolean {
  return EMAIL_PATTERN.test(value);
}

function flag(raw: string | undefined, fallback: boolean): boolean {
  const value = raw?.trim().toLowerCase();
  if (value === 'true') return true;
  if (value === 'false') return false;
  return fallback;
}

export function readMonitorAlertSettings(get: EnvReader): MonitorAlertSettings {
  const host = get('MONITOR_SMTP_HOST')?.trim() ?? '';
  const from = get('MONITOR_ALERT_FROM')?.trim() ?? '';
  const to = (get('MONITOR_ALERT_TO') ?? '')
    .split(',')
    .map((address) => address.trim())
    .filter((address) => address.length > 0);
  const secure = flag(get('MONITOR_SMTP_SECURE'), false);
  const portRaw = Number.parseInt(get('MONITOR_SMTP_PORT') ?? '', 10);
  const port =
    Number.isFinite(portRaw) && portRaw > 0 && portRaw < 65536
      ? portRaw
      : secure
        ? 465
        : 587;
  const remindHours = Number.parseFloat(
    get('MONITOR_ALERT_REMIND_HOURS') ?? '',
  );
  const statusUrlRaw = get('MONITOR_STATUS_URL')?.trim() ?? '';
  let statusUrl: string | null = null;
  if (statusUrlRaw) {
    try {
      const url = new URL(statusUrlRaw);
      if (url.protocol === 'https:' || url.protocol === 'http:') {
        statusUrl = url.toString();
      }
    } catch {
      statusUrl = null;
    }
  }

  const summaryRaw = get('MONITOR_SUMMARY_HOUR')?.trim() ?? '';
  const summaryHour = /^\d{1,2}$/.test(summaryRaw)
    ? Number.parseInt(summaryRaw, 10)
    : NaN;
  const summaryValid = summaryHour >= 0 && summaryHour <= 23;

  const settings: MonitorAlertSettings = {
    configured: false,
    error: null,
    from,
    to,
    smtp: {
      host,
      port,
      secure,
      requireTls: flag(get('MONITOR_SMTP_REQUIRE_TLS'), true),
      user: get('MONITOR_SMTP_USER')?.trim() || null,
      password: get('MONITOR_SMTP_PASSWORD') || null,
    },
    remindMs:
      Number.isFinite(remindHours) && remindHours >= 0 && remindHours <= 24 * 30
        ? remindHours * 60 * 60_000
        : 24 * 60 * 60_000,
    statusUrl,
    summaryHourUtc: summaryValid ? summaryHour : null,
    summaryError:
      summaryRaw && !summaryValid
        ? 'MONITOR_SUMMARY_HOUR must be a whole hour from 0 to 23'
        : null,
  };

  if (!host && !from && to.length === 0) return settings;
  if (!host) settings.error = 'MONITOR_SMTP_HOST is not set';
  else if (!isEmailAddress(from)) {
    settings.error = 'MONITOR_ALERT_FROM is not a valid email address';
  } else if (to.length === 0) settings.error = 'MONITOR_ALERT_TO is not set';
  else if (!to.every(isEmailAddress)) {
    settings.error = 'MONITOR_ALERT_TO has an invalid email address';
  } else if (settings.smtp.user && !settings.smtp.password) {
    settings.error = 'MONITOR_SMTP_USER is set without MONITOR_SMTP_PASSWORD';
  } else settings.configured = true;
  return settings;
}
