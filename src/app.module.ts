import { Module } from '@nestjs/common';
import { ConfigModule as NestConfigModule } from '@nestjs/config';
import { AdminApplicationsModule } from './admin/admin-applications.module';
import { AuditModule } from './audit/audit.module';
import { AuthModule } from './auth/auth.module';
import { ConfigModule } from './config/config.module';
import { HealthModule } from './health/health.module';
import { PortalModule } from './portal/portal.module';
import { PrismaModule } from './prisma/prisma.module';

@Module({
  imports: [
    NestConfigModule.forRoot({
      isGlobal: true,
    }),
    PrismaModule,
    AuthModule,
    ConfigModule,
    AdminApplicationsModule,
    AuditModule,
    PortalModule,
    HealthModule,
  ],
})
export class AppModule {}
