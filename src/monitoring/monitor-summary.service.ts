import {
  Injectable,
  Logger,
  OnApplicationBootstrap,
  OnModuleDestroy,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { MonitorAlertService } from './monitor-alert.service';
import { MonitorRunnerService } from './monitor-runner.service';
import { composeSummaryEmail, dueSummarySlot } from './monitor-summary';
import { MonitoringService } from './monitoring.service';

const TICK_MS = 5 * 60_000;
const FIRST_TICK_MS = 60_000;
const KEEP_SUMMARIES_MS = 90 * 24 * 60 * 60_000;

/**
 * Sends one daily summary email at MONITOR_SUMMARY_HOUR (UTC). Off unless
 * that hour is set, email alerts are configured and scheduled runs are on.
 * Every instance ticks; a unique row per slot means only one of them sends.
 * A failed send is recorded and not retried, so a flaky mail server cannot
 * cause duplicate summaries.
 */
@Injectable()
export class MonitorSummaryService
  implements OnApplicationBootstrap, OnModuleDestroy
{
  private readonly logger = new Logger(MonitorSummaryService.name);
  private firstTimer: NodeJS.Timeout | null = null;
  private interval: NodeJS.Timeout | null = null;
  private busy = false;

  constructor(
    private readonly prisma: PrismaService,
    private readonly alerts: MonitorAlertService,
    private readonly runner: MonitorRunnerService,
    private readonly monitoring: MonitoringService,
  ) {}

  get enabled(): boolean {
    return (
      this.alerts.settings.configured &&
      this.alerts.settings.summaryHourUtc !== null &&
      this.runner.settings.enabled
    );
  }

  onApplicationBootstrap(): void {
    if (!this.enabled) return;
    this.logger.log(
      `Daily status summary at ${String(this.alerts.settings.summaryHourUtc).padStart(2, '0')}:00 UTC`,
    );
    this.firstTimer = setTimeout(() => void this.tick(), FIRST_TICK_MS);
    this.interval = setInterval(() => void this.tick(), TICK_MS);
    this.firstTimer.unref?.();
    this.interval.unref?.();
  }

  onModuleDestroy(): void {
    if (this.firstTimer) clearTimeout(this.firstTimer);
    if (this.interval) clearInterval(this.interval);
  }

  private async tick(): Promise<void> {
    if (this.busy) return;
    this.busy = true;
    try {
      await this.sendIfDue();
    } catch (error) {
      this.logger.error(
        `Daily summary failed: ${error instanceof Error ? error.message : String(error)}`,
      );
    } finally {
      this.busy = false;
    }
  }

  /**
   * Sends the summary for the current slot unless one was already claimed.
   * Returns whether this call sent (or tried to send) it. Exposed for tests.
   */
  async sendIfDue(now = new Date()): Promise<boolean> {
    const hour = this.alerts.settings.summaryHourUtc;
    if (!this.enabled || hour === null) return false;
    const slot = dueSummarySlot(now, hour);
    if (!slot) return false;

    let claim: { id: string };
    try {
      claim = await this.prisma.monitorSummary.create({
        data: { slot },
        select: { id: true },
      });
    } catch (error) {
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === 'P2002'
      ) {
        return false;
      }
      throw error;
    }

    let ok = false;
    let failure: string | null = null;
    try {
      const status = await this.monitoring.status(now.getTime());
      const email = composeSummaryEmail(status, {
        statusUrl: this.alerts.settings.statusUrl,
        now,
      });
      const delivery = await this.alerts.sendSummary(email);
      ok = delivery.ok;
      failure = delivery.error;
    } catch (error) {
      failure = error instanceof Error ? error.message : String(error);
      throw error;
    } finally {
      await this.prisma.monitorSummary.update({
        where: { id: claim.id },
        data: { sentAt: new Date(), ok, error: failure?.slice(0, 500) },
      });
      await this.prisma.monitorSummary.deleteMany({
        where: { slot: { lt: new Date(now.getTime() - KEEP_SUMMARIES_MS) } },
      });
    }
    return true;
  }
}
