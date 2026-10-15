import type { MonitorOutcomeValue } from './monitor-checks';
import {
  formatDuration,
  formatUtc,
  renderMonitorEmail,
  type EmailTone,
} from './monitor-email-template';

export type AlertRow = {
  checkType: string;
  targetKey: string;
  targetLabel: string;
  outcome: MonitorOutcomeValue;
  detail: string | null;
  meta: Record<string, unknown> | null;
  consecutiveFailures: number;
  failingSince: Date | null;
};

export type PreviousRow = {
  checkType: string;
  targetKey: string;
  outcome: string;
  consecutiveFailures: number;
  checkedAt: Date;
};

export type AlertPlan = {
  /** Just turned red. */
  failing: AlertRow[];
  /** Certificate just entered the warning window. */
  expiring: AlertRow[];
  /** Still red; a reminder interval has passed since it started failing. */
  reminders: AlertRow[];
  /** Was red, now passes. */
  recovered: AlertRow[];
};

export function alertCount(plan: AlertPlan): number {
  return (
    plan.failing.length +
    plan.expiring.length +
    plan.reminders.length +
    plan.recovered.length
  );
}

/**
 * Decides what one run should email about. Only changes are reported, so a
 * check that stays red is mentioned again only as a periodic reminder.
 */
export function planAlerts(input: {
  rows: AlertRow[];
  previous: PreviousRow[];
  now: Date;
  redAfterFailures: number;
  remindMs: number;
}): AlertPlan {
  const plan: AlertPlan = {
    failing: [],
    expiring: [],
    reminders: [],
    recovered: [],
  };
  const prior = new Map(
    input.previous.map((row) => [`${row.checkType}::${row.targetKey}`, row]),
  );
  const now = input.now.getTime();

  for (const row of input.rows) {
    const before = prior.get(`${row.checkType}::${row.targetKey}`);
    const wasRed =
      before?.outcome === 'FAIL' &&
      before.consecutiveFailures >= input.redAfterFailures;

    if (row.outcome === 'FAIL') {
      if (row.consecutiveFailures === input.redAfterFailures) {
        plan.failing.push(row);
      } else if (
        row.consecutiveFailures > input.redAfterFailures &&
        input.remindMs > 0 &&
        row.failingSince &&
        before
      ) {
        const since = row.failingSince.getTime();
        const periodsNow = Math.floor((now - since) / input.remindMs);
        const periodsBefore = Math.floor(
          (before.checkedAt.getTime() - since) / input.remindMs,
        );
        if (periodsNow > periodsBefore) plan.reminders.push(row);
      }
      continue;
    }

    if (wasRed && (row.outcome === 'PASS' || row.outcome === 'WARN')) {
      plan.recovered.push(row);
      continue;
    }

    if (
      row.checkType === 'tls' &&
      row.outcome === 'WARN' &&
      before?.outcome !== 'WARN'
    ) {
      plan.expiring.push(row);
    }
  }
  return plan;
}

const CHECK_LABELS: Record<string, string> = {
  service: 'Runtime Config',
  app: 'App',
  tls: 'Certificate',
  portal: 'Portal',
  token: 'Token issuance',
  item: 'Dashboard item',
};

export function describeTarget(
  row: Pick<AlertRow, 'checkType' | 'targetLabel' | 'meta'>,
): string {
  const appKey = row.meta?.appKey;
  const where =
    row.checkType === 'item' && typeof appKey === 'string'
      ? ` (${appKey})`
      : '';
  return `${CHECK_LABELS[row.checkType] ?? row.checkType}: ${row.targetLabel || 'unnamed'}${where}`;
}

type Section = {
  title: string;
  tone: EmailTone;
  rows: AlertRow[];
  showSince: boolean;
};

export type AlertEmail = { subject: string; text: string; html: string };

const plural = (count: number, word: string) =>
  `${count} ${word}${count === 1 ? '' : 's'}`;

function sinceNote(row: AlertRow, now: Date): string | null {
  if (!row.failingSince) return null;
  const duration = formatDuration(now.getTime() - row.failingSince.getTime());
  const failures =
    row.consecutiveFailures > 0
      ? ` · ${plural(row.consecutiveFailures, 'failed check')} in a row`
      : '';
  return `Failing since ${formatUtc(row.failingSince)}${duration ? ` (${duration})` : ''}${failures}`;
}

export function composeAlertEmail(
  plan: AlertPlan,
  options: { statusUrl: string | null; subjectPrefix?: string; now?: Date },
): AlertEmail {
  const now = options.now ?? new Date();
  const sections: Section[] = [
    {
      title: 'Now failing',
      tone: 'critical' as const,
      rows: plan.failing,
      showSince: true,
    },
    {
      title: 'Certificates expiring soon',
      tone: 'warning' as const,
      rows: plan.expiring,
      showSince: false,
    },
    {
      title: 'Still failing',
      tone: 'critical' as const,
      rows: plan.reminders,
      showSince: true,
    },
    {
      title: 'Recovered',
      tone: 'healthy' as const,
      rows: plan.recovered,
      showSince: false,
    },
  ].filter((section) => section.rows.length > 0);

  const counts = [
    plan.failing.length ? `${plan.failing.length} failing` : null,
    plan.expiring.length
      ? `${plan.expiring.length} certificate expiring`
      : null,
    plan.reminders.length ? `${plan.reminders.length} still failing` : null,
    plan.recovered.length ? `${plan.recovered.length} recovered` : null,
  ].filter(Boolean);
  const subject = `${options.subjectPrefix ?? '[GeoHub status]'} ${counts.join(', ')}`;

  const textParts: string[] = [];
  for (const section of sections) {
    textParts.push(`${section.title} (${section.rows.length})`);
    for (const row of section.rows) {
      const since =
        section.showSince && row.failingSince
          ? `failing since ${formatUtc(row.failingSince)}`
          : null;
      const extra = [row.detail, since].filter(Boolean).join(' · ');
      textParts.push(`- ${describeTarget(row)}${extra ? `\n  ${extra}` : ''}`);
    }
    textParts.push('');
  }
  textParts.push(
    options.statusUrl
      ? `Status page: ${options.statusUrl}`
      : 'See the Status page in Runtime Config administration.',
  );

  const red = plan.failing.length + plan.reminders.length;
  const tone: EmailTone =
    red > 0 ? 'critical' : plan.expiring.length > 0 ? 'warning' : 'healthy';
  const title =
    red > 0
      ? `${plural(red, 'check')} ${red === 1 ? 'is' : 'are'} failing`
      : plan.expiring.length > 0
        ? `${plural(plan.expiring.length, 'certificate')} expiring soon`
        : `${plural(plan.recovered.length, 'check')} recovered`;
  const metric = (label: string, count: number, active: EmailTone) => ({
    label,
    value: String(count),
    tone: count > 0 ? active : ('neutral' as const),
  });

  const html = renderMonitorEmail({
    kind: 'Real-time alert',
    title,
    intro:
      'The latest status run found the changes below. Checks that stay the same are not repeated until the next reminder.',
    tone,
    preheader: counts.join(', '),
    generatedAt: now,
    metrics: [
      metric('Now failing', plan.failing.length, 'critical'),
      metric('Still failing', plan.reminders.length, 'critical'),
      metric('Expiring', plan.expiring.length, 'warning'),
      metric('Recovered', plan.recovered.length, 'healthy'),
    ],
    sections: sections.map((section) => ({
      title: section.title,
      tone: section.tone,
      items: section.rows.map((row) => ({
        name: describeTarget(row),
        tone: section.tone,
        detail: row.detail,
        note: section.showSince ? sinceNote(row, now) : null,
      })),
    })),
    statusUrl: options.statusUrl,
    footerNote:
      'You receive this because your address is in the monitor alert recipients (MONITOR_ALERT_TO).',
  });

  return { subject, text: textParts.join('\n'), html };
}

export function composeTestEmail(
  requestedBy: string,
  options: { statusUrl: string | null; now?: Date },
): AlertEmail {
  const now = options.now ?? new Date();
  const who = requestedBy.trim() || 'an administrator';
  return {
    subject: '[GeoHub status] Test email',
    text: `Email alerts from the GeoHub status monitor are working.\nRequested by ${who}.`,
    html: renderMonitorEmail({
      kind: 'Test email',
      title: 'Email alerts are working',
      intro: `This test was requested by ${who}. Real alerts and summaries will arrive in this format.`,
      tone: 'healthy',
      preheader: 'Email alerts from the GeoHub status monitor are working.',
      generatedAt: now,
      sections: [],
      statusUrl: options.statusUrl,
      footerNote:
        'You receive this because your address is in the monitor alert recipients (MONITOR_ALERT_TO).',
    }),
  };
}
