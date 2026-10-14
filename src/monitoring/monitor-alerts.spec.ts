import { readMonitorAlertSettings } from './monitor-alert-settings';
import { MonitorAlertService, type SendMail } from './monitor-alert.service';
import {
  alertCount,
  composeAlertEmail,
  planAlerts,
  type AlertRow,
  type PreviousRow,
} from './monitor-alerts';
import { ConfigService } from '@nestjs/config';

const HOUR = 60 * 60_000;
const NOW = new Date('2026-10-14T12:00:00Z');

function row(partial: Partial<AlertRow>): AlertRow {
  return {
    checkType: 'portal',
    targetKey: 'gh',
    targetLabel: 'GeoHub',
    outcome: 'PASS',
    detail: null,
    meta: null,
    consecutiveFailures: 0,
    failingSince: null,
    ...partial,
  };
}

function prev(partial: Partial<PreviousRow>): PreviousRow {
  return {
    checkType: 'portal',
    targetKey: 'gh',
    outcome: 'PASS',
    consecutiveFailures: 0,
    checkedAt: new Date(NOW.getTime() - 5 * 60_000),
    ...partial,
  };
}

const plan = (
  rows: AlertRow[],
  previous: PreviousRow[],
  remindMs = 24 * HOUR,
) => planAlerts({ rows, previous, now: NOW, redAfterFailures: 2, remindMs });

describe('planAlerts', () => {
  it('alerts once, at the moment a check turns red', () => {
    expect(
      alertCount(
        plan([row({ outcome: 'FAIL', consecutiveFailures: 1 })], [prev({})]),
      ),
    ).toBe(0);
    const red = plan(
      [row({ outcome: 'FAIL', consecutiveFailures: 2, failingSince: NOW })],
      [prev({ outcome: 'FAIL', consecutiveFailures: 1 })],
    );
    expect(red.failing.map((r) => r.targetKey)).toEqual(['gh']);
    const stillRed = plan(
      [
        row({
          outcome: 'FAIL',
          consecutiveFailures: 3,
          failingSince: new Date(NOW.getTime() - HOUR),
        }),
      ],
      [prev({ outcome: 'FAIL', consecutiveFailures: 2 })],
    );
    expect(alertCount(stillRed)).toBe(0);
  });

  it('reminds when a reminder interval passes while still red', () => {
    const since = new Date(NOW.getTime() - 24 * HOUR - 2 * 60_000);
    const due = plan(
      [row({ outcome: 'FAIL', consecutiveFailures: 290, failingSince: since })],
      [prev({ outcome: 'FAIL', consecutiveFailures: 289 })],
    );
    expect(due.reminders).toHaveLength(1);
    // Already reminded in an earlier run of this interval.
    const sinceEarlier = new Date(NOW.getTime() - 24 * HOUR - 20 * 60_000);
    expect(
      plan(
        [
          row({
            outcome: 'FAIL',
            consecutiveFailures: 293,
            failingSince: sinceEarlier,
          }),
        ],
        [prev({ outcome: 'FAIL', consecutiveFailures: 292 })],
      ).reminders,
    ).toHaveLength(0);
    // Reminders off.
    expect(
      plan(
        [
          row({
            outcome: 'FAIL',
            consecutiveFailures: 290,
            failingSince: since,
          }),
        ],
        [prev({ outcome: 'FAIL', consecutiveFailures: 289 })],
        0,
      ).reminders,
    ).toHaveLength(0);
  });

  it('reports recovery only for checks that were red', () => {
    expect(
      plan([row({})], [prev({ outcome: 'FAIL', consecutiveFailures: 4 })])
        .recovered,
    ).toHaveLength(1);
    expect(
      plan([row({})], [prev({ outcome: 'FAIL', consecutiveFailures: 1 })])
        .recovered,
    ).toHaveLength(0);
    // Not checked this time is not a recovery.
    expect(
      plan(
        [row({ outcome: 'SKIP' })],
        [prev({ outcome: 'FAIL', consecutiveFailures: 4 })],
      ).recovered,
    ).toHaveLength(0);
  });

  it('warns when a certificate enters the expiry window, once', () => {
    const tls = { checkType: 'tls', targetKey: 'arcgis.rura.rw' };
    expect(
      plan(
        [row({ ...tls, outcome: 'WARN', detail: '10 days left' })],
        [prev({ ...tls })],
      ).expiring,
    ).toHaveLength(1);
    expect(
      plan(
        [row({ ...tls, outcome: 'WARN' })],
        [prev({ ...tls, outcome: 'WARN' })],
      ).expiring,
    ).toHaveLength(0);
    // Slow responses (WARN on other checks) do not email.
    expect(alertCount(plan([row({ outcome: 'WARN' })], [prev({})]))).toBe(0);
  });
});

describe('composeAlertEmail', () => {
  it('summarises in the subject and escapes portal text in HTML', () => {
    const email = composeAlertEmail(
      {
        failing: [
          row({
            checkType: 'item',
            targetLabel: 'Mining <Dashboard>',
            outcome: 'FAIL',
            detail: '403 GWM_0003 <script>x</script>',
            meta: { appKey: 'mining-sites' },
            consecutiveFailures: 2,
            failingSince: new Date('2026-10-14T11:55:00Z'),
          }),
        ],
        expiring: [],
        reminders: [],
        recovered: [row({ targetLabel: 'RBC' })],
      },
      { statusUrl: 'https://gh.space.gov.rw/runtime-config/status' },
    );
    expect(email.subject).toBe('[GeoHub status] 1 failing, 1 recovered');
    expect(email.text).toContain(
      'Dashboard item: Mining <Dashboard> (mining-sites)',
    );
    expect(email.text).toContain('failing since 2026-10-14 11:55 UTC');
    expect(email.text).toContain(
      'Status page: https://gh.space.gov.rw/runtime-config/status',
    );
    expect(email.html).not.toContain('<script>');
    expect(email.html).toContain('&lt;script&gt;');
    expect(email.html).toContain('Mining &lt;Dashboard&gt;');
  });
});

describe('alert settings', () => {
  const env = (values: Record<string, string>) => (key: string) => values[key];

  it('stays off with nothing set, and explains partial setups', () => {
    expect(readMonitorAlertSettings(env({}))).toMatchObject({
      configured: false,
      error: null,
    });
    expect(
      readMonitorAlertSettings(env({ MONITOR_ALERT_TO: 'ops@example.com' }))
        .error,
    ).toBe('MONITOR_SMTP_HOST is not set');
    expect(
      readMonitorAlertSettings(
        env({
          MONITOR_SMTP_HOST: 'smtp.example.com',
          MONITOR_ALERT_FROM: 'status@example.com',
          MONITOR_ALERT_TO: 'ops@example.com, not-an-address',
        }),
      ).error,
    ).toBe('MONITOR_ALERT_TO has an invalid email address');
  });

  it('requires TLS by default and parses recipients and reminders', () => {
    const settings = readMonitorAlertSettings(
      env({
        MONITOR_SMTP_HOST: 'smtp.example.com',
        MONITOR_SMTP_USER: 'status',
        MONITOR_SMTP_PASSWORD: 'pw',
        MONITOR_ALERT_FROM: 'status@example.com',
        MONITOR_ALERT_TO: 'a@example.com, b@example.com',
        MONITOR_ALERT_REMIND_HOURS: '12',
      }),
    );
    expect(settings).toMatchObject({
      configured: true,
      to: ['a@example.com', 'b@example.com'],
      remindMs: 12 * HOUR,
      smtp: { port: 587, secure: false, requireTls: true },
    });
  });
});

describe('MonitorAlertService', () => {
  function service(sendMail: SendMail, extra: Record<string, string> = {}) {
    const alerts = new MonitorAlertService(
      new ConfigService({
        MONITOR_SMTP_HOST: 'smtp.example.com',
        MONITOR_SMTP_USER: 'status',
        MONITOR_SMTP_PASSWORD: 'smtp-secret-password',
        MONITOR_ALERT_FROM: 'status@example.com',
        MONITOR_ALERT_TO: 'ops@example.com',
        ...extra,
      }),
    );
    (alerts as unknown as { sendMail: SendMail }).sendMail = sendMail;
    return alerts;
  }

  const empty = { failing: [], expiring: [], reminders: [], recovered: [] };

  it('sends nothing for an empty plan', async () => {
    const send = jest.fn().mockResolvedValue({});
    await service(send).notify(empty);
    expect(send).not.toHaveBeenCalled();
  });

  it('sends one email to the configured recipients', async () => {
    const send = jest.fn().mockResolvedValue({});
    const alerts = service(send);
    await alerts.notify({ ...empty, recovered: [row({})] });
    expect(send).toHaveBeenCalledTimes(1);
    expect(send).toHaveBeenCalledWith(
      expect.objectContaining({
        from: 'status@example.com',
        to: ['ops@example.com'],
        subject: '[GeoHub status] 1 recovered',
      }),
    );
    expect(alerts.lastDelivery()).toMatchObject({ kind: 'alert', ok: true });
  });

  it('records SMTP failures without throwing or leaking the password', async () => {
    const alerts = service(
      jest
        .fn()
        .mockRejectedValue(new Error('Invalid login for smtp-secret-password')),
    );
    await expect(
      alerts.notify({ ...empty, failing: [row({})] }),
    ).resolves.toBeUndefined();
    expect(alerts.lastDelivery()).toMatchObject({
      ok: false,
      error: 'Invalid login for [redacted]',
    });
  });
});
