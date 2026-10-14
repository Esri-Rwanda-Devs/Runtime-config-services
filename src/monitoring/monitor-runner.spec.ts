import { ConfigService } from '@nestjs/config';
import { MonitorOutcome } from '@prisma/client';
import type { PrismaService } from '../prisma/prisma.service';
import type { PortalAuthTokenService } from '../portal/portal-auth-token.service';
import type { MonitorAlertService } from './monitor-alert.service';
import type { AlertPlan } from './monitor-alerts';
import type { CheckDeps, CheckResult } from './monitor-checks';
import {
  carryForward,
  createLimiter,
  MonitorRunnerService,
  withDeadline,
} from './monitor-runner.service';

const result = (
  outcome: CheckResult['outcome'],
  targetKey = 'gh',
): CheckResult => ({
  checkType: 'portal',
  targetKey,
  targetLabel: targetKey,
  outcome,
  latencyMs: 10,
  detail: null,
  meta: null,
});

describe('carryForward', () => {
  const now = new Date('2026-10-14T12:05:00Z');
  const earlier = new Date('2026-10-14T12:00:00Z');
  const firstFailure = new Date('2026-10-14T11:55:00Z');

  it('starts a streak on the first failure', () => {
    expect(carryForward([result('FAIL')], [], now)[0]).toMatchObject({
      consecutiveFailures: 1,
      failingSince: now,
    });
  });

  it('continues a streak from the previous run, keeping when it started', () => {
    const [row] = carryForward(
      [result('FAIL')],
      [
        {
          checkType: 'portal',
          targetKey: 'gh',
          outcome: MonitorOutcome.FAIL,
          consecutiveFailures: 1,
          failingSince: firstFailure,
          checkedAt: earlier,
        },
      ],
      now,
    );
    expect(row).toMatchObject({
      consecutiveFailures: 2,
      failingSince: firstFailure,
    });
  });

  it('resets on pass or warn, and does not mix targets', () => {
    const previous = [
      {
        checkType: 'portal',
        targetKey: 'gh',
        outcome: MonitorOutcome.FAIL,
        consecutiveFailures: 4,
        failingSince: firstFailure,
        checkedAt: earlier,
      },
    ];
    expect(carryForward([result('WARN')], previous, now)[0]).toMatchObject({
      consecutiveFailures: 0,
      failingSince: null,
    });
    expect(
      carryForward([result('FAIL', 'rbc')], previous, now)[0],
    ).toMatchObject({
      consecutiveFailures: 1,
    });
  });
});

describe('createLimiter / withDeadline', () => {
  it('never runs more than the cap at once', async () => {
    const limit = createLimiter(2);
    let active = 0;
    let peak = 0;
    await Promise.all(
      Array.from({ length: 8 }, () =>
        limit(async () => {
          active += 1;
          peak = Math.max(peak, active);
          await new Promise((resolve) => setTimeout(resolve, 5));
          active -= 1;
        }),
      ),
    );
    expect(peak).toBe(2);
  });

  it('resolves with the fallback when a task hangs', async () => {
    const hang = new Promise<string>(() => undefined);
    await expect(withDeadline(hang, 10, () => 'timed out')).resolves.toBe(
      'timed out',
    );
  });
});

type StoredRow = {
  checkType: string;
  targetKey: string;
  outcome: string;
  detail: string | null;
};

type RunUpdate = {
  where: { id: string };
  data: { finishedAt: Date; total: number; failed: number };
};

function runUpdate(prisma: { monitorRun: { update: jest.Mock } }): RunUpdate {
  const [[update]] = prisma.monitorRun.update.mock.calls as unknown as [
    [RunUpdate],
  ];
  return update;
}

describe('MonitorRunnerService run', () => {
  const TOKEN = 'SECRET-portal-token-0123456789';

  const healthConfig = {
    modules: [
      {
        id: 'm',
        name: 'M',
        apps: [
          {
            id: 'a',
            name: 'A',
            kind: 'dashboard',
            portalItemId: 'i1',
            portalHostKey: 'rbc',
          },
        ],
      },
    ],
  };

  function setup(options: { locked?: boolean } = {}) {
    const tx = {
      $queryRaw: jest
        .fn()
        .mockResolvedValue([{ locked: options.locked ?? true }]),
      monitorRun: {
        findFirst: jest.fn().mockResolvedValue(null),
        create: jest.fn().mockResolvedValue({ id: 'run-1' }),
      },
    };
    const prisma = {
      $transaction: jest.fn((fn: (t: typeof tx) => unknown) => fn(tx)),
      $queryRaw: jest.fn().mockResolvedValue([{ '?column?': 1 }]),
      application: {
        findMany: jest.fn().mockResolvedValue([
          {
            key: 'health-mapping',
            name: 'Health',
            isActive: true,
            config: healthConfig,
          },
        ]),
      },
      portalCredential: {
        findMany: jest.fn().mockResolvedValue([
          {
            key: 'rbc',
            name: 'RBC',
            portalUrl: 'https://gis.rbc.gov.rw/portal',
            isActive: true,
          },
        ]),
      },
      monitorRun: {
        findFirst: jest.fn().mockResolvedValue(null),
        update: jest.fn().mockResolvedValue({}),
        deleteMany: jest.fn().mockResolvedValue({ count: 0 }),
      },
      monitorCheckResult: {
        findMany: jest.fn().mockResolvedValue([]),
        createMany: jest.fn().mockResolvedValue({ count: 0 }),
      },
    };
    const tokenService = {
      issueToken: jest.fn().mockResolvedValue({
        token: TOKEN,
        portalUrl: 'https://gis.rbc.gov.rw/portal',
      }),
    };
    const config = new ConfigService({
      MONITOR_APP_URLS:
        '{"health-mapping":"https://localhost:5175/health-mapping/"}',
    });
    const alerts = {
      settings: { remindMs: 24 * 60 * 60_000 },
      notify: jest.fn().mockResolvedValue(undefined),
    };
    const runner = new MonitorRunnerService(
      prisma as unknown as PrismaService,
      tokenService as unknown as PortalAuthTokenService,
      alerts as unknown as MonitorAlertService,
      config,
    );
    // Network calls are faked; one of them echoes the token back in an error.
    const deps: Partial<CheckDeps> = {
      appFetch: jest.fn().mockResolvedValue(
        new Response('<html>', {
          status: 200,
          headers: { 'content-type': 'text/html' },
        }),
      ),
      inspectCertificate: jest.fn().mockResolvedValue({
        authorized: false,
        authorizationError: 'CERT_HAS_EXPIRED',
        validTo: 'Oct  8 23:59:59 2026 GMT',
        issuer: 'RapidSSL',
      }),
      portalFetch: jest.fn((url: string) =>
        Promise.resolve(
          url.includes('/content/items/')
            ? new Response(
                JSON.stringify({
                  error: { code: 498, message: `Invalid token ${TOKEN}` },
                }),
                { status: 200 },
              )
            : new Response(JSON.stringify({ currentVersion: '11.1' }), {
                status: 200,
              }),
        ),
      ),
    };
    const realDeps = (runner as unknown as { deps: () => CheckDeps }).deps.bind(
      runner,
    );
    jest
      .spyOn(runner as unknown as { deps: () => CheckDeps }, 'deps')
      .mockImplementation(() => ({ ...realDeps(), ...deps }));
    return { runner, prisma, tx, tokenService, alerts };
  }

  it('stores every check and never stores the token', async () => {
    const { runner, prisma, tokenService } = setup();
    await expect(runner.start('manual', 'admin@example.com')).resolves.toBe(
      'run-1',
    );
    await runner.idle();

    expect(tokenService.issueToken).toHaveBeenCalledWith({
      appKey: 'health-mapping',
      portalHostKey: 'rbc',
      origin: 'https://runtime-config-monitor.local',
    });
    const [[{ data }]] = prisma.monitorCheckResult.createMany.mock
      .calls as unknown as [[{ data: StoredRow[] }]];
    expect(
      data
        .map((row) => `${row.checkType}:${row.targetKey}:${row.outcome}`)
        .sort(),
    ).toEqual([
      'app:health-mapping:PASS',
      'item:health-mapping/m/a:FAIL',
      'portal:rbc:PASS',
      'service:runtime-config:PASS',
      'tls:gis.rbc.gov.rw:FAIL',
      'token:health-mapping/rbc:PASS',
    ]);
    expect(JSON.stringify(data)).not.toContain(TOKEN);
    expect(data.find((row) => row.checkType === 'item')?.detail).toBe(
      '498 Invalid token [redacted]',
    );
    expect(runUpdate(prisma)).toMatchObject({
      where: { id: 'run-1' },
      data: { total: 6, failed: 2 },
    });
  });

  it('does not start when another instance holds the claim lock', async () => {
    const { runner, tx } = setup({ locked: false });
    await expect(runner.start('schedule')).resolves.toBeNull();
    expect(tx.monitorRun.create).not.toHaveBeenCalled();
  });

  it('does not start a second run while one is in progress', async () => {
    const { runner } = setup();
    await runner.start('manual');
    await expect(runner.start('manual')).resolves.toBeNull();
    await runner.idle();
  });

  it('closes the run even when collecting fails', async () => {
    const { runner, prisma } = setup();
    prisma.application.findMany.mockRejectedValueOnce(new Error('db gone'));
    await runner.start('manual');
    await runner.idle();
    const update = runUpdate(prisma);
    expect(update).toMatchObject({
      where: { id: 'run-1' },
      data: { total: 0 },
    });
    expect(update.data.finishedAt).toBeInstanceOf(Date);
    expect(runner.isRunning()).toBe(false);
  });

  it('emails what turned red, after the run is closed', async () => {
    const { runner, prisma, alerts } = setup();
    prisma.monitorRun.findFirst.mockResolvedValueOnce({ id: 'run-0' });
    prisma.monitorCheckResult.findMany.mockResolvedValueOnce([
      {
        checkType: 'tls',
        targetKey: 'gis.rbc.gov.rw',
        outcome: MonitorOutcome.FAIL,
        consecutiveFailures: 1,
        failingSince: new Date('2026-10-14T11:00:00Z'),
        checkedAt: new Date('2026-10-14T11:00:00Z'),
      },
    ]);
    await runner.start('schedule');
    await runner.idle();

    expect(alerts.notify).toHaveBeenCalledTimes(1);
    const [[plan]] = alerts.notify.mock.calls as unknown as [[AlertPlan]];
    expect(plan.failing.map((row) => row.targetKey)).toEqual([
      'gis.rbc.gov.rw',
    ]);
    expect(JSON.stringify(plan)).not.toContain(TOKEN);
    expect(prisma.monitorRun.update.mock.invocationCallOrder[0]).toBeLessThan(
      alerts.notify.mock.invocationCallOrder[0],
    );
  });

  it('sends nothing when collecting fails', async () => {
    const { runner, prisma, alerts } = setup();
    prisma.application.findMany.mockRejectedValueOnce(new Error('db gone'));
    await runner.start('manual');
    await runner.idle();
    expect(alerts.notify).not.toHaveBeenCalled();
  });

  it('lets only one of two simultaneous starts claim a run', async () => {
    const { runner, tx } = setup();
    const [first, second] = await Promise.all([
      runner.start('schedule'),
      runner.start('schedule'),
    ]);
    await runner.idle();
    expect([first, second].filter(Boolean)).toEqual(['run-1']);
    expect(tx.monitorRun.create).toHaveBeenCalledTimes(1);
  });
});
