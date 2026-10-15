import { describeTarget, type AlertEmail } from './monitor-alerts';
import {
  formatDuration,
  formatUtc,
  renderMonitorEmail,
  type EmailItem,
  type EmailTone,
} from './monitor-email-template';
import type { DisplayStatus } from './monitoring.service';

/** Only send a missed summary this long after its scheduled time. */
export const SUMMARY_GRACE_MS = 2 * 60 * 60_000;

/**
 * The most recent scheduled summary time at or before `now`, or null when it
 * is more than SUMMARY_GRACE_MS old (the service was down at that hour, so
 * wait for the next one rather than send a stale summary at an odd time).
 */
export function dueSummarySlot(now: Date, hourUtc: number): Date | null {
  const slot = new Date(
    Date.UTC(
      now.getUTCFullYear(),
      now.getUTCMonth(),
      now.getUTCDate(),
      hourUtc,
    ),
  );
  if (slot.getTime() > now.getTime()) slot.setUTCDate(slot.getUTCDate() - 1);
  return now.getTime() - slot.getTime() <= SUMMARY_GRACE_MS ? slot : null;
}

/** One check as MonitoringService.status() reports it. */
export type SummaryCheck = {
  checkType: string;
  targetLabel: string;
  status: DisplayStatus;
  detail: string | null;
  meta: Record<string, unknown> | null;
  failingSince: string | null;
  uptime24h: number | null;
};

export type SummaryInput = {
  checks: SummaryCheck[];
  lastRun: { finishedAt: string | null } | null;
  stale: boolean;
};

const TONE: Record<DisplayStatus, EmailTone> = {
  green: 'healthy',
  amber: 'warning',
  red: 'critical',
  grey: 'neutral',
};

function parseDate(value: string | null | undefined): Date | null {
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

function formatPercent(value: number): string {
  return `${Number.isInteger(value) ? value : value.toFixed(1)}%`;
}

export function composeSummaryEmail(
  input: SummaryInput,
  options: { statusUrl: string | null; now: Date; subjectPrefix?: string },
): AlertEmail {
  const { now } = options;
  const by = (status: DisplayStatus) =>
    input.checks.filter((check) => check.status === status);
  const red = by('red');
  const amber = by('amber');
  const green = by('green');
  const grey = by('grey');
  const checked = input.checks.length - grey.length;
  // Healthy now, but down at some point in the last 24 hours.
  const recent = green.filter(
    (check) => check.uptime24h !== null && check.uptime24h < 100,
  );
  const uptimes = input.checks
    .map((check) => check.uptime24h)
    .filter((value): value is number => value !== null);
  const averageUptime = uptimes.length
    ? Math.round((uptimes.reduce((a, b) => a + b, 0) / uptimes.length) * 10) /
      10
    : null;
  const lastRunAt = parseDate(input.lastRun?.finishedAt);

  const item = (check: SummaryCheck, note: string | null): EmailItem => ({
    name: describeTarget(check),
    tone: TONE[check.status],
    detail: check.detail,
    note,
  });
  const failingNote = (check: SummaryCheck) => {
    const since = parseDate(check.failingSince);
    if (!since) return null;
    const duration = formatDuration(now.getTime() - since.getTime());
    return `Failing since ${formatUtc(since)}${duration ? ` (${duration})` : ''}`;
  };
  const uptimeNote = (check: SummaryCheck) =>
    check.uptime24h === null
      ? null
      : `Uptime last 24 h: ${formatPercent(check.uptime24h)}`;

  const sections = [
    {
      title: 'Critical',
      tone: 'critical' as const,
      items: red.map((check) => item(check, failingNote(check))),
    },
    {
      title: 'Warning',
      tone: 'warning' as const,
      items: amber.map((check) =>
        item(check, failingNote(check) ?? uptimeNote(check)),
      ),
    },
    {
      title: 'Recovered in the last 24 hours',
      tone: 'healthy' as const,
      items: recent.map((check) => item(check, uptimeNote(check))),
    },
  ];

  const problems = [
    red.length ? `${red.length} critical` : null,
    amber.length ? `${amber.length} warning` : null,
  ].filter(Boolean);
  const verdict =
    checked === 0
      ? 'no checks ran'
      : problems.length
        ? problems.join(', ')
        : `all ${checked} checks healthy`;
  const subject = `${options.subjectPrefix ?? '[GeoHub status]'} Daily summary: ${verdict}`;

  const tone: EmailTone = red.length
    ? 'critical'
    : amber.length || input.stale
      ? 'warning'
      : checked === 0
        ? 'neutral'
        : 'healthy';
  const title =
    checked === 0
      ? 'No check results yet'
      : problems.length
        ? `${problems.join(', ')} of ${checked} checks`
        : `All ${checked} checks are healthy`;
  const intro = [
    lastRunAt
      ? `Based on the run that finished ${formatUtc(lastRunAt)}.`
      : 'The monitor has not completed a run yet.',
    input.stale && lastRunAt
      ? 'No run has finished recently, so these results may be out of date.'
      : null,
    grey.length
      ? `${grey.length} not checked (skipped or not configured).`
      : null,
  ]
    .filter(Boolean)
    .join(' ');

  const text: string[] = [`Daily summary: ${verdict}`, intro, ''];
  for (const section of sections) {
    if (section.items.length === 0) continue;
    text.push(`${section.title} (${section.items.length})`);
    for (const entry of section.items) {
      const extra = [entry.detail, entry.note].filter(Boolean).join(' · ');
      text.push(`- ${entry.name}${extra ? `\n  ${extra}` : ''}`);
    }
    text.push('');
  }
  text.push(
    `Healthy ${green.length} · Warning ${amber.length} · Critical ${red.length}` +
      (averageUptime === null
        ? ''
        : ` · Average uptime 24 h ${formatPercent(averageUptime)}`),
    options.statusUrl
      ? `Status page: ${options.statusUrl}`
      : 'See the Status page in Runtime Config administration.',
  );

  const html = renderMonitorEmail({
    kind: 'Daily summary',
    title,
    intro,
    tone,
    preheader: `Daily summary: ${verdict}`,
    generatedAt: now,
    metrics: [
      {
        label: 'Healthy',
        value: String(green.length),
        tone: green.length ? 'healthy' : 'neutral',
      },
      {
        label: 'Warning',
        value: String(amber.length),
        tone: amber.length ? 'warning' : 'neutral',
      },
      {
        label: 'Critical',
        value: String(red.length),
        tone: red.length ? 'critical' : 'neutral',
      },
      {
        label: 'Avg uptime 24 h',
        value: averageUptime === null ? '' : formatPercent(averageUptime),
        tone:
          averageUptime === null
            ? 'neutral'
            : averageUptime >= 99
              ? 'healthy'
              : averageUptime >= 95
                ? 'warning'
                : 'critical',
      },
    ],
    sections,
    emptyMessage:
      checked === 0
        ? 'There are no check results to report. Make sure the scheduled monitor is running.'
        : 'Nothing needs attention: no warnings, failures or recoveries in the last 24 hours.',
    statusUrl: options.statusUrl,
    footerNote:
      'You receive this daily summary because your address is in the monitor alert recipients (MONITOR_ALERT_TO).',
  });

  return { subject, text: text.join('\n'), html };
}
