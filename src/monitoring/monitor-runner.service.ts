import {
  Injectable,
  Logger,
  OnApplicationBootstrap,
  OnModuleDestroy,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { MonitorOutcome, Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { PortalAuthTokenService } from '../portal/portal-auth-token.service';
import { MonitorAlertService } from './monitor-alert.service';
import { planAlerts, type AlertPlan } from './monitor-alerts';
import {
  RED_AFTER_FAILURES,
  checkApp,
  checkItem,
  checkPortal,
  checkService,
  checkTls,
  checkToken,
  type CheckDeps,
  type CheckResult,
  type IssuedToken,
} from './monitor-checks';
import { sanitizeDetail } from './monitor-sanitize';
import { readMonitorSettings, type MonitorSettings } from './monitor-settings';
import { buildMonitorTargets, isLoopbackHost } from './monitor-targets';
import { inspectCertificate } from './tls-probe';
import { loopbackFetch } from './loopback-fetch';

/** pg advisory lock id that serializes run claims across service instances. */
const RUN_CLAIM_LOCK_ID = 7301004211;
/** An unfinished run older than this is treated as crashed. */
export const RUN_STALE_MS = 15 * 60_000;
const FIRST_RUN_DELAY_MS = 15_000;
const RETENTION_EVERY_MS = 60 * 60_000;

export type RunTrigger = 'schedule' | 'manual';

type StoredResult = {
  checkType: string;
  targetKey: string;
  outcome: MonitorOutcome;
  consecutiveFailures: number;
  failingSince: Date | null;
  checkedAt: Date;
};

/** Failure streaks continue from the previous run's result for the same target. */
export function carryForward(
  results: CheckResult[],
  previous: StoredResult[],
  now: Date,
): Array<
  CheckResult & { consecutiveFailures: number; failingSince: Date | null }
> {
  const prior = new Map(
    previous.map((row) => [`${row.checkType}::${row.targetKey}`, row]),
  );
  return results.map((result) => {
    if (result.outcome !== 'FAIL') {
      return { ...result, consecutiveFailures: 0, failingSince: null };
    }
    const before = prior.get(`${result.checkType}::${result.targetKey}`);
    if (before?.outcome === MonitorOutcome.FAIL) {
      return {
        ...result,
        consecutiveFailures: before.consecutiveFailures + 1,
        failingSince: before.failingSince ?? before.checkedAt,
      };
    }
    return { ...result, consecutiveFailures: 1, failingSince: now };
  });
}

/** Runs at most `max` tasks at a time. */
export function createLimiter(max: number) {
  let active = 0;
  const waiting: Array<() => void> = [];
  return async function limit<T>(task: () => Promise<T>): Promise<T> {
    if (active >= max) {
      await new Promise<void>((resolve) => waiting.push(resolve));
    }
    active += 1;
    try {
      return await task();
    } finally {
      active -= 1;
      waiting.shift()?.();
    }
  };
}

/** Hard ceiling on one check, whatever the check itself does. */
export function withDeadline<T>(
  task: Promise<T>,
  ms: number,
  onTimeout: () => T,
): Promise<T> {
  let timer: NodeJS.Timeout | undefined;
  const deadline = new Promise<T>((resolve) => {
    timer = setTimeout(() => resolve(onTimeout()), ms);
  });
  return Promise.race([task, deadline]).finally(() => clearTimeout(timer));
}

// Dev app servers on this machine use self-signed certificates. Only the
// loopback app-reachability request skips verification; it sends no
// credentials, and loopback hosts get no certificate check.
function appFetch(url: string, init: RequestInit): Promise<Response> {
  if (isLoopbackHost(new URL(url).hostname)) {
    return loopbackFetch(url, init, isLoopbackHost, (next, nextInit) =>
      fetch(next, nextInit),
    );
  }
  return fetch(url, init);
}

@Injectable()
export class MonitorRunnerService
  implements OnApplicationBootstrap, OnModuleDestroy
{
  private readonly logger = new Logger(MonitorRunnerService.name);
  readonly settings: MonitorSettings;
  private firstTimer: NodeJS.Timeout | null = null;
  private interval: NodeJS.Timeout | null = null;
  private current: Promise<void> | null = null;
  /** Set while a claim is in flight, so two callers cannot both claim. */
  private claiming = false;
  private lastRetentionAt = 0;

  constructor(
    private readonly prisma: PrismaService,
    private readonly tokenService: PortalAuthTokenService,
    private readonly alerts: MonitorAlertService,
    configService: ConfigService,
  ) {
    this.settings = readMonitorSettings((key) =>
      configService.get<string>(key),
    );
  }

  onApplicationBootstrap(): void {
    if (this.settings.appUrlsError) {
      this.logger.warn(`${this.settings.appUrlsError}; app checks disabled`);
    }
    if (!this.settings.enabled) return;
    this.logger.log(
      `Status monitor every ${Math.round(this.settings.intervalMs / 1000)}s`,
    );
    this.firstTimer = setTimeout(() => void this.tick(), FIRST_RUN_DELAY_MS);
    this.interval = setInterval(
      () => void this.tick(),
      this.settings.intervalMs,
    );
    this.firstTimer.unref?.();
    this.interval.unref?.();
  }

  onModuleDestroy(): void {
    if (this.firstTimer) clearTimeout(this.firstTimer);
    if (this.interval) clearInterval(this.interval);
  }

  isRunning(): boolean {
    return this.current !== null;
  }

  /**
   * Starts a run in the background. Returns its id, or null when another run
   * is in progress here or on another instance (or, for the schedule, one ran
   * too recently).
   */
  async start(
    trigger: RunTrigger,
    triggeredBy?: string,
  ): Promise<string | null> {
    if (this.current || this.claiming) return null;
    this.claiming = true;
    let run: { id: string } | null;
    try {
      run = await this.claimRun(trigger, triggeredBy ?? null);
    } finally {
      this.claiming = false;
    }
    if (!run) return null;
    this.current = this.execute(run.id)
      .catch((error: unknown) => {
        this.logger.error(
          `Monitor run ${run.id} failed: ${error instanceof Error ? error.message : String(error)}`,
        );
      })
      .finally(() => {
        this.current = null;
      });
    return run.id;
  }

  /** Waits for the run in progress, if any (used by tests and shutdown). */
  async idle(): Promise<void> {
    await this.current;
  }

  private async tick(): Promise<void> {
    try {
      await this.start('schedule');
    } catch (error) {
      this.logger.error(
        `Could not start monitor run: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }

  private claimRun(trigger: RunTrigger, triggeredBy: string | null) {
    return this.prisma.$transaction(
      async (tx) => {
        const [lock] = await tx.$queryRaw<Array<{ locked: boolean }>>`
        SELECT pg_try_advisory_xact_lock(${Prisma.raw(String(RUN_CLAIM_LOCK_ID))}) AS locked`;
        if (!lock?.locked) return null;
        const now = Date.now();
        const active = await tx.monitorRun.findFirst({
          where: {
            finishedAt: null,
            startedAt: { gt: new Date(now - RUN_STALE_MS) },
          },
          select: { id: true },
        });
        if (active) return null;
        if (trigger === 'schedule') {
          const recent = await tx.monitorRun.findFirst({
            where: {
              startedAt: { gt: new Date(now - this.settings.intervalMs / 2) },
            },
            select: { id: true },
          });
          if (recent) return null;
        }
        return tx.monitorRun.create({
          data: { trigger, triggeredBy },
          select: { id: true },
        });
      },
      { maxWait: 10_000, timeout: 15_000 },
    );
  }

  private deps(): CheckDeps {
    return {
      now: () => Date.now(),
      timeoutMs: this.settings.timeoutMs,
      referer: this.settings.referer,
      appFetch,
      portalFetch: (url, init) => fetch(url, init),
      inspectCertificate,
      issueToken: async (input) => {
        const issued = await this.tokenService.issueToken(input);
        return { token: issued.token, portalUrl: issued.portalUrl };
      },
      pingDatabase: async () => {
        await this.prisma.$queryRaw`SELECT 1`;
      },
    };
  }

  /** Runs every check once. Exposed for tests; normal callers use start(). */
  async collect(deps: CheckDeps = this.deps()): Promise<{
    results: CheckResult[];
    tokens: string[];
  }> {
    const [applications, credentials] = await Promise.all([
      this.prisma.application.findMany({
        select: { key: true, name: true, isActive: true, config: true },
      }),
      this.prisma.portalCredential.findMany({
        select: { key: true, name: true, portalUrl: true, isActive: true },
      }),
    ]);
    const targets = buildMonitorTargets({
      applications,
      credentials,
      appUrls: this.settings.appUrls,
    });

    const limit = createLimiter(this.settings.concurrency);
    const ceiling = this.settings.timeoutMs + 5_000;
    const guarded = (
      task: () => Promise<CheckResult>,
      fallback: Omit<CheckResult, 'outcome' | 'latencyMs' | 'detail'>,
    ) =>
      limit(() =>
        withDeadline(task(), ceiling, () => ({
          ...fallback,
          outcome: 'FAIL' as const,
          latencyMs: ceiling,
          detail: `Timed out after ${Math.round(ceiling / 1000)}s`,
        })),
      );

    const first = await Promise.all([
      checkService(deps),
      ...targets.apps.map((t) =>
        guarded(() => checkApp(t, deps), {
          checkType: 'app',
          targetKey: t.appKey,
          targetLabel: t.label,
          meta: { url: t.url },
        }),
      ),
      ...targets.tls.map((t) =>
        guarded(() => checkTls(t, deps), {
          checkType: 'tls',
          targetKey: t.port === 443 ? t.host : `${t.host}:${t.port}`,
          targetLabel: t.port === 443 ? t.host : `${t.host}:${t.port}`,
          meta: { usedBy: t.usedBy },
        }),
      ),
      ...targets.portals.map((t) =>
        guarded(() => checkPortal(t, deps), {
          checkType: 'portal',
          targetKey: t.hostKey,
          targetLabel: t.label,
          meta: { portalUrl: t.portalUrl },
        }),
      ),
    ]);

    const issuedByPair = new Map<string, IssuedToken | null>();
    const tokenResults = await Promise.all(
      targets.tokens.map((t) =>
        limit(async () => {
          const timedOut = {
            result: {
              checkType: 'token' as const,
              targetKey: `${t.appKey}/${t.hostKey}`,
              targetLabel: `${t.appKey} → ${t.hostKey}`,
              outcome: 'FAIL' as const,
              latencyMs: ceiling,
              detail: `Timed out after ${Math.round(ceiling / 1000)}s`,
              meta: { appKey: t.appKey, hostKey: t.hostKey },
            },
            issued: null,
          };
          const outcome = await withDeadline(
            checkToken(t, deps),
            ceiling,
            () => timedOut,
          );
          issuedByPair.set(`${t.appKey}/${t.hostKey}`, outcome.issued);
          return outcome.result;
        }),
      ),
    );

    const itemResults = await Promise.all(
      targets.items.map((t) =>
        guarded(
          () =>
            checkItem(
              t,
              t.hostKey ? issuedByPair.get(`${t.appKey}/${t.hostKey}`) : null,
              deps,
            ),
          {
            checkType: 'item',
            targetKey: `${t.appKey}/${t.moduleId}/${t.appId}`,
            targetLabel: t.name,
            meta: {
              appKey: t.appKey,
              portalItemId: t.portalItemId,
              hostKey: t.hostKey,
            },
          },
        ),
      ),
    );

    const tokens = [...issuedByPair.values()]
      .filter((value): value is IssuedToken => value !== null)
      .map((value) => value.token);
    return { results: [...first, ...tokenResults, ...itemResults], tokens };
  }

  private async execute(runId: string): Promise<void> {
    let total = 0;
    let failed = 0;
    let plan: AlertPlan | null = null;
    try {
      const { results, tokens } = await this.collect();
      const now = new Date();
      const previousRun = await this.prisma.monitorRun.findFirst({
        where: { id: { not: runId }, finishedAt: { not: null } },
        orderBy: { startedAt: 'desc' },
        select: { id: true },
      });
      const previous = previousRun
        ? await this.prisma.monitorCheckResult.findMany({
            where: { runId: previousRun.id },
            select: {
              checkType: true,
              targetKey: true,
              outcome: true,
              consecutiveFailures: true,
              failingSince: true,
              checkedAt: true,
            },
          })
        : [];
      const rows = carryForward(results, previous, now).map((row) => ({
        ...row,
        detail: sanitizeDetail(row.detail, tokens),
      }));
      total = rows.length;
      failed = rows.filter((row) => row.outcome === 'FAIL').length;
      await this.prisma.monitorCheckResult.createMany({
        data: rows.map((row) => ({
          runId,
          checkType: row.checkType,
          targetKey: row.targetKey,
          targetLabel: row.targetLabel,
          outcome: row.outcome,
          latencyMs: row.latencyMs === null ? null : Math.round(row.latencyMs),
          detail: row.detail,
          meta: (row.meta ?? undefined) as Prisma.InputJsonValue | undefined,
          consecutiveFailures: row.consecutiveFailures,
          failingSince: row.failingSince,
          checkedAt: now,
        })),
      });
      plan = planAlerts({
        rows,
        previous,
        now,
        redAfterFailures: RED_AFTER_FAILURES,
        remindMs: this.alerts.settings.remindMs,
      });
    } finally {
      await this.prisma.monitorRun.update({
        where: { id: runId },
        data: { finishedAt: new Date(), total, failed },
      });
      await this.applyRetention();
    }
    // After the run is closed, so a slow mail server never holds a run open.
    if (plan) await this.alerts.notify(plan);
  }

  private async applyRetention(): Promise<void> {
    const now = Date.now();
    if (now - this.lastRetentionAt < RETENTION_EVERY_MS) return;
    this.lastRetentionAt = now;
    const cutoff = new Date(
      now - this.settings.retentionDays * 24 * 60 * 60_000,
    );
    // Results go with their run (ON DELETE CASCADE).
    await this.prisma.monitorRun.deleteMany({
      where: { startedAt: { lt: cutoff } },
    });
  }
}
