import type { MonitorOutcomeValue } from './monitor-checks';

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

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function describeTarget(row: AlertRow): string {
  const appKey = row.meta?.appKey;
  const where =
    row.checkType === 'item' && typeof appKey === 'string'
      ? ` (${appKey})`
      : '';
  return `${CHECK_LABELS[row.checkType] ?? row.checkType}: ${row.targetLabel}${where}`;
}

function formatTime(date: Date): string {
  return `${date.toISOString().slice(0, 16).replace('T', ' ')} UTC`;
}

type Section = { title: string; rows: AlertRow[]; showSince: boolean };

export type AlertEmail = { subject: string; text: string; html: string };

export function composeAlertEmail(
  plan: AlertPlan,
  options: { statusUrl: string | null; subjectPrefix?: string },
): AlertEmail {
  const sections: Section[] = [
    { title: 'Now failing', rows: plan.failing, showSince: true },
    {
      title: 'Certificates expiring soon',
      rows: plan.expiring,
      showSince: false,
    },
    { title: 'Still failing', rows: plan.reminders, showSince: true },
    { title: 'Recovered', rows: plan.recovered, showSince: false },
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
  const htmlParts: string[] = [];
  for (const section of sections) {
    textParts.push(`${section.title} (${section.rows.length})`);
    htmlParts.push(
      `<h3 style="margin:16px 0 6px;font-size:15px">${escapeHtml(section.title)} (${section.rows.length})</h3><ul style="margin:0;padding-left:20px">`,
    );
    for (const row of section.rows) {
      const since =
        section.showSince && row.failingSince
          ? `failing since ${formatTime(row.failingSince)}`
          : null;
      const extra = [row.detail, since].filter(Boolean).join(' · ');
      textParts.push(`- ${describeTarget(row)}${extra ? `\n  ${extra}` : ''}`);
      htmlParts.push(
        `<li style="margin:4px 0"><strong>${escapeHtml(describeTarget(row))}</strong>${
          extra
            ? `<br><span style="color:#52525b">${escapeHtml(extra)}</span>`
            : ''
        }</li>`,
      );
    }
    textParts.push('');
    htmlParts.push('</ul>');
  }

  const footer = options.statusUrl
    ? `Status page: ${options.statusUrl}`
    : 'See the Status page in Runtime Config administration.';
  textParts.push(footer);
  htmlParts.push(
    options.statusUrl
      ? `<p style="margin-top:18px"><a href="${escapeHtml(options.statusUrl)}">Open the Status page</a></p>`
      : `<p style="margin-top:18px">${escapeHtml(footer)}</p>`,
  );

  return {
    subject,
    text: textParts.join('\n'),
    html: `<div style="font-family:Segoe UI,Arial,sans-serif;font-size:14px;color:#18181b">${htmlParts.join('')}</div>`,
  };
}
