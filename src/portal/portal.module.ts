import { Module } from '@nestjs/common';
import { ThrottlerModule } from '@nestjs/throttler';
import { AuditModule } from '../audit/audit.module';
import { AuthModule } from '../auth/auth.module';
import { ArcgisPortalClient } from './arcgis-portal.client';
import { PortalAuthController } from './portal-auth.controller';
import { PortalAuthTokenService } from './portal-auth-token.service';
import { PortalCredentialCryptoService } from './portal-credential-crypto.service';
import { PortalCredentialsController } from './portal-credentials.controller';
import { PortalCredentialsService } from './portal-credentials.service';

@Module({
  imports: [
    AuthModule,
    AuditModule,
    ThrottlerModule.forRoot([
      {
        name: 'default',
        ttl: 60_000,
        limit: 1000,
      },
    ]),
  ],
  controllers: [PortalCredentialsController, PortalAuthController],
  providers: [
    PortalCredentialCryptoService,
    ArcgisPortalClient,
    PortalCredentialsService,
    PortalAuthTokenService,
  ],
  exports: [
    PortalCredentialCryptoService,
    ArcgisPortalClient,
    PortalCredentialsService,
    PortalAuthTokenService,
  ],
})
export class PortalModule {}
