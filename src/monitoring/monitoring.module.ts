import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { PortalModule } from '../portal/portal.module';
import { MonitorAlertService } from './monitor-alert.service';
import { MonitorRunnerService } from './monitor-runner.service';
import { MonitorSummaryService } from './monitor-summary.service';
import { MonitoringController } from './monitoring.controller';
import { MonitoringService } from './monitoring.service';

@Module({
  imports: [AuthModule, PortalModule],
  controllers: [MonitoringController],
  providers: [
    MonitorAlertService,
    MonitorRunnerService,
    MonitoringService,
    MonitorSummaryService,
  ],
})
export class MonitoringModule {}
