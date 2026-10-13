import { ValidationPipe } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { NestFactory } from '@nestjs/core';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { AppModule } from './app.module';
import { assertPortalCredentialEncryptionKey } from './portal/portal-credential-crypto.service';

function parseAllowedOrigins(value: string | undefined): string[] {
  if (!value?.trim()) {
    return [];
  }

  return value
    .split(',')
    .map((origin) => origin.trim())
    .filter((origin) => origin.length > 0);
}

function assertJwtSecret(
  secret: string | undefined,
  nodeEnv: string | undefined,
) {
  const isProd = nodeEnv === 'production';
  if (!secret || secret.trim().length === 0) {
    if (isProd || nodeEnv !== 'test') {
      throw new Error(
        'JWT_SECRET is required. Generate at least 32 random bytes and set it in the environment.',
      );
    }
    return;
  }

  // Reject obviously weak placeholders outside tests.
  const trimmed = secret.trim();
  const weak =
    trimmed.length < 32 ||
    /^(change-me|secret|password|jwt_secret)$/i.test(trimmed);
  if (weak && nodeEnv !== 'test') {
    throw new Error(
      'JWT_SECRET is missing or unsafe. Use a high-entropy secret of at least 32 characters.',
    );
  }
}

async function bootstrap() {
  // rawBody: the portal proxy forwards POST bodies byte-for-byte.
  const app = await NestFactory.create(AppModule, { rawBody: true });
  const configService = app.get(ConfigService);

  const nodeEnv = configService.get<string>('NODE_ENV') ?? process.env.NODE_ENV;

  assertJwtSecret(configService.get<string>('JWT_SECRET'), nodeEnv);
  assertPortalCredentialEncryptionKey(
    configService.get<string>('PORTAL_CREDENTIAL_ENCRYPTION_KEY'),
    nodeEnv,
  );

  const allowedOrigins = parseAllowedOrigins(
    configService.get<string>('ALLOWED_ORIGINS'),
  );

  app.enableCors({
    origin: (
      origin: string | undefined,
      callback: (err: Error | null, allow?: boolean) => void,
    ) => {
      // Allow non-browser clients (curl, health checks) with no Origin header.
      if (!origin) {
        callback(null, true);
        return;
      }

      if (allowedOrigins.includes(origin)) {
        callback(null, true);
        return;
      }

      // Reject without throwing — throwing can omit CORS headers and confuse browsers.
      callback(null, false);
    },
    methods: ['GET', 'HEAD', 'POST', 'PUT', 'PATCH', 'OPTIONS'],
  });

  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
    }),
  );

  const swaggerConfig = new DocumentBuilder()
    .setTitle('Runtime Config API')
    .setDescription(
      [
        'Central runtime configuration service for frontend applications.',
        '',
        'Public: GET /health, GET /api/v1/config/:appKey, GET /api/v1/theme/typography.css, POST /api/v1/auth/login, Swagger UI.',
        'Consumer portal auth: POST /api/v1/portal-auth/token with { appKey, portalHostKey } (Origin allowlist + rate limit + config host authorization; issues short-lived ArcGIS tokens).',
        '',
        'Admin endpoints under /api/v1/admin/** require Bearer JWT from an active AdminUser.',
        'Portal credentials: /api/v1/admin/portal-credentials (passwords encrypted at rest; never returned).',
        'Use POST /api/v1/auth/login, then Authorize in Swagger with the access token.',
        'Admins are created via CLI (npm run admin:create). There is no public registration.',
      ].join('\n'),
    )
    .setVersion('1.0')
    .addBearerAuth(
      {
        type: 'http',
        scheme: 'bearer',
        bearerFormat: 'JWT',
        description: 'Paste accessToken from POST /api/v1/auth/login',
      },
      'bearer',
    )
    .build();
  const document = SwaggerModule.createDocument(app, swaggerConfig);
  SwaggerModule.setup('api/docs', app, document);

  const port = configService.get<string>('PORT') ?? '3000';
  await app.listen(port);
}

void bootstrap();
