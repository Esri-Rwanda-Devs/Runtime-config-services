/**
 * Renders sample status monitor emails to HTML files for a browser preview.
 * No database or SMTP needed.
 *
 *   npm run monitor:preview-emails -- [output directory]
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import {
  composeAlertEmail,
  composeTestEmail,
  type AlertRow,
} from '../src/monitoring/monitor-alerts';
import { composeSummaryEmail } from '../src/monitoring/monitor-summary';

const outDir = resolve(
  process.argv[2] ?? join(tmpdir(), 'geohub-email-previews'),
);
const statusUrl =
  process.env.MONITOR_STATUS_URL ??
  'https://apps.example.com/runtime-config/status';
const now = new Date();
const ago = (minutes: number) => new Date(now.getTime() - minutes * 60_000);

const row = (partial: Partial<AlertRow>): AlertRow => ({
  checkType: 'portal',
  targetKey: 'geohub',
  targetLabel: 'GeoHub Rwanda',
  outcome: 'PASS',
  detail: null,
  meta: null,
  consecutiveFailures: 0,
  failingSince: null,
  ...partial,
});

const alert = composeAlertEmail(
  {
    failing: [
      row({
        checkType: 'item',
        targetKey: 'mining/1/2',
        targetLabel: 'Mining Sites Dashboard',
        outcome: 'FAIL',
        detail:
          '403 GWM_0003: You do not have permissions to access this resource',
        meta: { appKey: 'mining-sites' },
        consecutiveFailures: 2,
        failingSince: ago(10),
      }),
    ],
    expiring: [
      row({
        checkType: 'tls',
        targetKey: 'arcgis.rura.rw',
        targetLabel: 'arcgis.rura.rw',
        outcome: 'WARN',
        detail: 'Certificate expires in 12 days (2026-10-27)',
      }),
    ],
    reminders: [
      row({
        checkType: 'app',
        targetKey: 'education',
        targetLabel: 'Education Mapping',
        outcome: 'FAIL',
        detail: 'Timed out after 15s',
        consecutiveFailures: 288,
        failingSince: ago(24 * 60 + 5),
      }),
    ],
    recovered: [row({ targetLabel: 'RBC Portal' })],
  },
  { statusUrl, now },
);

const summary = composeSummaryEmail(
  {
    checks: [
      {
        checkType: 'app',
        targetLabel: 'Education Mapping',
        status: 'red',
        detail: 'Timed out after 15s',
        meta: null,
        failingSince: ago(26 * 60).toISOString(),
        uptime24h: 0,
      },
      {
        checkType: 'tls',
        targetLabel: 'arcgis.rura.rw',
        status: 'amber',
        detail: 'Certificate expires in 12 days',
        meta: null,
        failingSince: null,
        uptime24h: 100,
      },
      {
        checkType: 'portal',
        targetLabel: 'RBC Portal',
        status: 'green',
        detail: null,
        meta: null,
        failingSince: null,
        uptime24h: 96.5,
      },
      ...Array.from({ length: 24 }, (_, i) => ({
        checkType: 'item',
        targetLabel: `Dashboard ${i + 1}`,
        status: 'green' as const,
        detail: null,
        meta: { appKey: 'geohub' },
        failingSince: null,
        uptime24h: 100,
      })),
    ],
    lastRun: { finishedAt: ago(3).toISOString() },
    stale: false,
  },
  { statusUrl, now },
);

const test = composeTestEmail('admin@example.com', { statusUrl, now });

mkdirSync(outDir, { recursive: true });
for (const [name, email] of Object.entries({ alert, summary, test })) {
  const file = join(outDir, `${name}.html`);
  writeFileSync(file, email.html, 'utf8');
  writeFileSync(
    join(outDir, `${name}.txt`),
    `Subject: ${email.subject}\n\n${email.text}\n`,
    'utf8',
  );
  console.log(`${email.subject}\n  ${file}`);
}
