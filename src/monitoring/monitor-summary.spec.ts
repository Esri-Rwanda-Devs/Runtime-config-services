import { Prisma } from '@prisma/client';
import { readMonitorAlertSettings } from './monitor-alert-settings';
import { composeTestEmail } from './monitor-alerts';
import {
  formatDuration,
  formatUtc,
  renderMonitorEmail,
} from './monitor-email-template';
import {
  composeSummaryEmail,
  dueSummarySlot,
  type SummaryCheck,
} from './monitor-summary';
import { MonitorSummaryService } from './monitor-summary.service';

const NOW = new Date('2026-10-15T05:20:00Z');
const STATUS_URL = 'https://gh.space.gov.rw/runtime-config/status';

function check(partial: Partial<SummaryCheck>): SummaryCheck {
  return {
    checkType: 'portal',
    targetLabel: 'GeoHub',
    status: 'green',
    detail: null,
    meta: null,
    failingSince: null,
    uptime24h: 100,
    ...partial,
  };
}

describe('renderMonitorEmail', () => {
  const base = {
    kind: 'Real-time alert',
    title: 'Title',
    tone: 'critical' as const,
    preheader: 'Preview',
    generatedAt: NOW,
    sections: [],
    statusUrl: null,
  };

  it('uses table layout, escapes dynamic text and fills missing values', () => {
    const html = renderMonitorEmail({
      ...base,
      title: '<b>x</b>',
      metrics: [{ label: 'Uptime', value: '', tone: 'neutral' }],
      sections: [
        {
          title: 'Now failing',
          tone: 'critical',
          items: [{ name: '  ', tone: 'critical', detail: '"q" & <i>' }],
        },
      ],
      statusUrl: 'https://x.example/status?a=1&b="2"',
    });
    expect(html).toMatch(/^<!DOCTYPE html>/);
    expect(html).toContain('role="presentation"');
    expect(html).toContain('&lt;b&gt;x&lt;/b&gt;');
    expect(html).not.toContain('<b>x</b>');
    expect(html).toContain('&quot;q&quot; &amp; &lt;i&gt;');
    expect(html).toContain('Unnamed check');
    expect(html).toContain('&ndash;');
    expect(html).toContain('>Critical</span>');
    expect(html).toContain(
      'href="https://x.example/status?a=1&amp;b=&quot;2&quot;"',
    );
    expect(html).toContain('Generated 2026-10-15 05:20 UTC');
  });

  it('falls back to text when there is no status URL or content', () => {
    const html = renderMonitorEmail({ ...base, emptyMessage: 'All quiet' });
    expect(html).not.toContain('href=');
    expect(html).toContain('Runtime Config administration');
    expect(html).toContain('All quiet');
  });

  it('formats dates and durations defensively', () => {
    expect(formatUtc(null)).toBe('time unknown');
    expect(formatUtc(new Date('nope'))).toBe('time unknown');
    expect(formatDuration(-5)).toBeNull();
    expect(formatDuration(30_000)).toBe('1 min');
    expect(formatDuration(125 * 60_000)).toBe('2 h 5 min');
    expect(formatDuration(27 * 60 * 60_000)).toBe('1 d 3 h');
  });
});

describe('composeTestEmail', () => {
  it('escapes the requester in HTML', () => {
    const email = composeTestEmail('<admin>@example.com', {
      statusUrl: STATUS_URL,
      now: NOW,
    });
    expect(email.subject).toBe('[GeoHub status] Test email');
    expect(email.text).toContain('Requested by <admin>@example.com.');
    expect(email.html).toContain('&lt;admin&gt;@example.com');
    expect(email.html).toContain(STATUS_URL);
  });
});

describe('dueSummarySlot', () => {
  it('returns today’s slot within the grace window, else null', () => {
    expect(dueSummarySlot(NOW, 5)?.toISOString()).toBe(
      '2026-10-15T05:00:00.000Z',
    );
    // Before the hour: yesterday's slot is long past.
    expect(dueSummarySlot(NOW, 6)).toBeNull();
    // Hour 23, just after midnight: yesterday's slot is within grace.
    expect(
      dueSummarySlot(new Date('2026-10-15T00:30:00Z'), 23)?.toISOString(),
    ).toBe('2026-10-14T23:00:00.000Z');
    expect(dueSummarySlot(new Date('2026-10-15T08:00:00Z'), 5)).toBeNull();
  });
});

describe('composeSummaryEmail', () => {
  it('summarises problems and recent recoveries', () => {
    const email = composeSummaryEmail(
      {
        checks: [
          check({
            checkType: 'item',
            targetLabel: 'Mining <Dashboard>',
            meta: { appKey: 'mining-sites' },
            status: 'red',
            detail: '403 GWM_0003',
            failingSince: '2026-10-15T02:20:00Z',
            uptime24h: 80,
          }),
          check({ checkType: 'tls', targetLabel: 'a.rw', status: 'amber' }),
          check({ targetLabel: 'RBC', uptime24h: 97.5 }),
          check({}),
          check({ checkType: 'app', status: 'grey', uptime24h: null }),
        ],
        lastRun: { finishedAt: '2026-10-15T05:15:00Z' },
        stale: false,
      },
      { statusUrl: STATUS_URL, now: NOW },
    );
    expect(email.subject).toBe(
      '[GeoHub status] Daily summary: 1 critical, 1 warning',
    );
    expect(email.text).toContain(
      'Dashboard item: Mining <Dashboard> (mining-sites)',
    );
    expect(email.text).toContain('Failing since 2026-10-15 02:20 UTC (3 h)');
    expect(email.text).toContain('Portal: RBC');
    expect(email.text).toContain('Uptime last 24 h: 97.5%');
    expect(email.text).toContain('1 not checked');
    expect(email.html).toContain('Mining &lt;Dashboard&gt;');
    expect(email.html).toContain('Recovered in the last 24 hours');
    expect(email.html).toContain('Daily summary');
  });

  it('reports all healthy, staleness and empty data', () => {
    expect(
      composeSummaryEmail(
        {
          checks: [check({}), check({ targetLabel: 'B' })],
          lastRun: { finishedAt: '2026-10-15T05:15:00Z' },
          stale: false,
        },
        { statusUrl: null, now: NOW },
      ).subject,
    ).toBe('[GeoHub status] Daily summary: all 2 checks healthy');

    const stale = composeSummaryEmail(
      {
        checks: [check({})],
        lastRun: { finishedAt: '2026-10-14T01:00:00Z' },
        stale: true,
      },
      { statusUrl: null, now: NOW },
    );
    expect(stale.text).toContain('may be out of date');

    const empty = composeSummaryEmail(
      { checks: [], lastRun: null, stale: true },
      { statusUrl: null, now: NOW },
    );
    expect(empty.subject).toBe('[GeoHub status] Daily summary: no checks ran');
    expect(empty.html).toContain('No check results yet');
    expect(empty.html).toContain('There are no check results to report');
  });
});

describe('summary settings', () => {
  const env = (values: Record<string, string>) => (key: string) => values[key];

  it('parses MONITOR_SUMMARY_HOUR and rejects bad values', () => {
    expect(readMonitorAlertSettings(env({})).summaryHourUtc).toBeNull();
    expect(
      readMonitorAlertSettings(env({ MONITOR_SUMMARY_HOUR: '5' }))
        .summaryHourUtc,
    ).toBe(5);
    for (const bad of ['24', '-1', '5.5', 'seven']) {
      const settings = readMonitorAlertSettings(
        env({ MONITOR_SUMMARY_HOUR: bad }),
      );
      expect(settings.summaryHourUtc).toBeNull();
      expect(settings.summaryError).toContain('MONITOR_SUMMARY_HOUR');
    }
  });
});

describe('MonitorSummaryService', () => {
  function setup(
    options: {
      hour?: number | null;
      configured?: boolean;
      enabled?: boolean;
      claimError?: unknown;
      deliveryOk?: boolean;
    } = {},
  ) {
    const prisma = {
      monitorSummary: {
        create: options.claimError
          ? jest.fn().mockRejectedValue(options.claimError)
          : jest.fn().mockResolvedValue({ id: 'claim-1' }),
        update: jest
          .fn<
            Promise<unknown>,
            [{ where: { id: string }; data: Record<string, unknown> }]
          >()
          .mockResolvedValue({}),
        deleteMany: jest.fn().mockResolvedValue({ count: 0 }),
      },
    };
    const alerts = {
      settings: {
        configured: options.configured ?? true,
        summaryHourUtc: options.hour === undefined ? 5 : options.hour,
        statusUrl: STATUS_URL,
      },
      sendSummary: jest.fn().mockResolvedValue({
        ok: options.deliveryOk ?? true,
        error: options.deliveryOk === false ? 'SMTP down' : null,
      }),
    };
    const runner = { settings: { enabled: options.enabled ?? true } };
    const monitoring = {
      status: jest.fn().mockResolvedValue({
        checks: [check({})],
        lastRun: { finishedAt: '2026-10-15T05:15:00Z' },
        stale: false,
      }),
    };
    const service = new MonitorSummaryService(
      prisma as never,
      alerts as never,
      runner as never,
      monitoring as never,
    );
    return { service, prisma, alerts, monitoring };
  }

  it('claims the slot, sends once and records the result', async () => {
    const { service, prisma, alerts } = setup();
    await expect(service.sendIfDue(NOW)).resolves.toBe(true);
    expect(prisma.monitorSummary.create).toHaveBeenCalledWith({
      data: { slot: new Date('2026-10-15T05:00:00Z') },
      select: { id: true },
    });
    expect(alerts.sendSummary).toHaveBeenCalledWith(
      expect.objectContaining({
        subject: '[GeoHub status] Daily summary: all 1 checks healthy',
      }),
    );
    expect(prisma.monitorSummary.update).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: 'claim-1' } }),
    );
    expect(prisma.monitorSummary.update.mock.calls[0][0].data).toMatchObject({
      ok: true,
      error: undefined,
    });
  });

  it('does nothing when another instance already claimed the slot', async () => {
    const { service, alerts } = setup({
      claimError: new Prisma.PrismaClientKnownRequestError('dup', {
        code: 'P2002',
        clientVersion: 'test',
      }),
    });
    await expect(service.sendIfDue(NOW)).resolves.toBe(false);
    expect(alerts.sendSummary).not.toHaveBeenCalled();
  });

  it('records a failed delivery on the claimed slot', async () => {
    const { service, prisma, alerts } = setup({ deliveryOk: false });
    await expect(service.sendIfDue(NOW)).resolves.toBe(true);
    expect(alerts.sendSummary).toHaveBeenCalledTimes(1);
    expect(prisma.monitorSummary.update.mock.calls[0][0]).toMatchObject({
      where: { id: 'claim-1' },
      data: { ok: false, error: 'SMTP down' },
    });
  });

  it('stays off unless hour, alerts and scheduled runs are all set', async () => {
    for (const options of [
      { hour: null },
      { configured: false },
      { enabled: false },
    ]) {
      const { service, prisma } = setup(options);
      await expect(service.sendIfDue(NOW)).resolves.toBe(false);
      expect(prisma.monitorSummary.create).not.toHaveBeenCalled();
    }
    // Outside the grace window.
    const { service, prisma } = setup();
    await expect(
      service.sendIfDue(new Date('2026-10-15T09:00:00Z')),
    ).resolves.toBe(false);
    expect(prisma.monitorSummary.create).not.toHaveBeenCalled();
  });
});
