import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { JwtModule } from '@nestjs/jwt';
import { ThrottlerModule } from '@nestjs/throttler';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';
import { AdminAuthGuard } from './admin-auth.guard';
import { PasswordService } from './password.service';

@Module({
  imports: [
    ThrottlerModule.forRoot([
      {
        // High default ceiling; login route overrides to 5/min via @Throttle.
        name: 'default',
        ttl: 60_000,
        limit: 1000,
      },
    ]),
    JwtModule.registerAsync({
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: (configService: ConfigService) => {
        const secret = configService.get<string>('JWT_SECRET');
        const expiresIn = configService.get<string>('JWT_EXPIRES_IN') ?? '1h';
        return {
          secret: secret || 'test-only-insecure-jwt-secret-32b!',
          signOptions: {
            expiresIn: expiresIn as `${number}h` | `${number}m` | `${number}s`,
          },
        };
      },
    }),
  ],
  controllers: [AuthController],
  providers: [AuthService, PasswordService, AdminAuthGuard],
  exports: [AuthService, PasswordService, AdminAuthGuard, JwtModule],
})
export class AuthModule {}
