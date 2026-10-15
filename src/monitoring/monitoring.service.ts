import { Injectable } from '@nestjs/common';
import { MonitorOutcome } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { MonitorAlertService } from './monitor-alert.service';
import { RED_AFTER_FAILURES } from './monitor-checks';
import { MonitorRunnerService, RUN_STALE_MS } from './monitor-runner.service';

export type DisplayStatus = 'green' | 'amber' | 'red' | 'grey';

export { RED_AFTER_FAILURES };
const HOUR_MS = 60 * 60_000;

/**
 * One failure shows amber; red needs RED_AFTER_FAILURES in a row, so a single
 * slow or dropped response does not flash red.
 */
export function displayStatus(
  outcome: MonitorOutcome,
  consecutiveFailures: number,
): DisplayStatus {
  switch (outcome) {
    case MonitorOutcome.PASS:
      return 'green';
    case MonitorOutcome.WARN:
      return 'amber';
    case MonitorOutcome.SKIP:
      return 'grey';
    default:
      return consecutiveFailures >= RED_AFTER_FAILURES ? 'red' : 'amber';
  }
}

type UptimeCounts = { up: number; down: number };

function uptimePercent(counts: UptimeCounts | undefined): number | null {
  if (!counts || counts.up + counts.down === 0) return null;
  return Math.round((counts.up / (counts.up + counts.down)) * 1000) / 10;
}

@Injectable()
export class MonitoringService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly runner: MonitorRunnerService,
    private readonly alerts: MonitorAlertService,
  ) {}

  async status(now = Date.now()) {
    const settings = this.runner.settings;
    const [lastRun, activeRun] = await Promise.all([
      this.prisma.monitorRun.findFirst({
        where: { finishedAt: { not: null } },
        orderBy: { startedAt: 'desc' },
      }),
      this.prisma.monitorRun.findFirst({
        where: {
          finishedAt: null,
          startedAt: { gt: new Date(now - RUN_STALE_MS) },
        },
        select: { id: true, startedAt: true },
      }),
    ]);

    // Data counts as stale once three intervals pass without a run (min 15 min).
    const staleAfterMs = Math.max(15 * 60_000, settings.intervalMs * 3);
    const stale =
      !lastRun?.finishedAt || now - lastRun.finishedAt.getTime() > staleAfterMs;

    const rows = lastRun
      ? await this.prisma.monitorCheckResult.findMany({
          where: { runId: lastRun.id },
          orderBy: [{ checkType: 'asc' }, { targetKey: 'asc' }],
        })
      : [];

    const [uptime24h, uptime7d] = await Promise.all([
      this.uptime(new Date(now - 24 * HOUR_MS)),
      this.uptime(new Date(now - 7 * 24 * HOUR_MS)),
    ]);

    return {
      settings: {
        enabled: settings.enabled,
        intervalMs: settings.intervalMs,
        appUrlsConfigured: settings.appUrls.length,
        appUrlsError: settings.appUrlsError,
        redAfterFailures: RED_AFTER_FAILURES,
      },
      alerts: {
        configured: this.alerts.settings.configured,
        error: this.alerts.settings.error,
        recipients: this.alerts.settings.configured
          ? this.alerts.settings.to
          : [],
        remindHours: this.alerts.settings.remindMs / (60 * 60_000),
        summaryHourUtc: this.alerts.settings.configured
          ? this.alerts.settings.summaryHourUtc
          : null,
        lastDelivery: this.alerts.lastDelivery(),
      },
      running: this.runner.isRunning() || activeRun !== null,
      stale,
      staleAfterMs,
      lastRun: lastRun
        ? {
            id: lastRun.id,
            trigger: lastRun.trigger,
            startedAt: lastRun.startedAt.toISOString(),
            finishedAt: lastRun.finishedAt?.toISOString() ?? null,
            total: lastRun.total,
            failed: lastRun.failed,
          }
        : null,
      checks: rows.map((row) => {
        const key = `${row.checkType}::${row.targetKey}`;
        return {
          checkType: row.checkType,
          targetKey: row.targetKey,
          targetLabel: row.targetLabel,
          outcome: row.outcome,
          status: displayStatus(row.outcome, row.consecutiveFailures),
          latencyMs: row.latencyMs,
          detail: row.detail,
          meta: (row.meta ?? null) as Record<string, unknown> | null,
          consecutiveFailures: row.consecutiveFailures,
          failingSince: row.failingSince?.toISOString() ?? null,
          checkedAt: row.checkedAt.toISOString(),
          uptime24h: uptimePercent(uptime24h.get(key)),
          uptime7d: uptimePercent(uptime7d.get(key)),
        };
      }),
    };
  }

  async history(input: {
    checkType: string;
    targetKey: string;
    hours: number;
  }) {
    const since = new Date(Date.now() - input.hours * HOUR_MS);
    const rows = await this.prisma.monitorCheckResult.findMany({
      where: {
        checkType: input.checkType,
        targetKey: input.targetKey,
        checkedAt: { gte: since },
      },
      orderBy: { checkedAt: 'asc' },
      take: 2_100,
      select: {
        outcome: true,
        latencyMs: true,
        detail: true,
        consecutiveFailures: true,
        checkedAt: true,
      },
    });
    return {
      checkType: input.checkType,
      targetKey: input.targetKey,
      items: rows.map((row) => ({
        outcome: row.outcome,
        status: displayStatus(row.outcome, row.consecutiveFailures),
        latencyMs: row.latencyMs,
        detail: row.detail,
        checkedAt: row.checkedAt.toISOString(),
      })),
    };
  }

  /** SKIP results are not counted; WARN counts as up (reachable, but slow). */
  private async uptime(since: Date): Promise<Map<string, UptimeCounts>> {
    const groups = await this.prisma.monitorCheckResult.groupBy({
      by: ['checkType', 'targetKey', 'outcome'],
      where: { checkedAt: { gte: since } },
      _count: { _all: true },
    });
    const totals = new Map<string, UptimeCounts>();
    for (const group of groups) {
      if (group.outcome === MonitorOutcome.SKIP) continue;
      const key = `${group.checkType}::${group.targetKey}`;
      const entry = totals.get(key) ?? { up: 0, down: 0 };
      if (group.outcome === MonitorOutcome.FAIL)
        entry.down += group._count._all;
      else entry.up += group._count._all;
      totals.set(key, entry);
    }
    return totals;
  }
}
