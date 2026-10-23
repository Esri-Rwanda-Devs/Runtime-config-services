import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { PortalModule } from '../portal/portal.module';
import { AppLaunchController } from './app-launch.controller';
import { AppSessionController } from './app-session.controller';
import { AppSessionService } from './app-session.service';
import { PortalProxyController } from './portal-proxy.controller';

/** End-user login + session-gated portal proxy for static mapping SPAs. */
@Module({
  imports: [AuthModule, PortalModule],
  controllers: [
    AppSessionController,
    PortalProxyController,
    AppLaunchController,
  ],
  providers: [AppSessionService],
})
export class AppSessionModule {}
