import { INestApplication, ValidationPipe } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { Test, TestingModule } from '@nestjs/testing';
import { ApplicationAuditAction, Prisma } from '@prisma/client';
import * as argon2 from 'argon2';
import request from 'supertest';
import { App } from 'supertest/types';
import { AdminApplicationsModule } from '../src/admin/admin-applications.module';
import { AuditModule } from '../src/audit/audit.module';
import { AuthModule } from '../src/auth/auth.module';
import { ADMIN_ROLE } from '../src/auth/auth.constants';
import { ConfigModule as AppConfigModule } from '../src/config/config.module';
import {
  educationMappingFixture,
  healthMappingFixture,
  populationMappingFixture,
} from '../src/config/validation/fixtures/harmonized-fixtures';
import { HealthModule } from '../src/health/health.module';
import { PrismaModule } from '../src/prisma/prisma.module';
import { PrismaService } from '../src/prisma/prisma.service';

function firstMockCallArg<T>(mockFn: jest.Mock, argIndex = 0): T {
  const calls = mockFn.mock.calls as unknown as unknown[][];
  return calls[0]?.[argIndex] as T;
}

const JWT_SECRET = 'test-only-insecure-jwt-secret-32b!';

const validConfig = {
  app: { name: 'Education Mapping' },
  organization: { name: 'Rwanda Space Agency' },
  contact: {},
  footer: {},
  legal: {},
  modules: [
    {
      id: 'public-schools',
      name: 'School Mapping',
      apps: [
        {
          id: 'schools-distribution',
          name: 'Schools Distribution',
          kind: 'experience',
          portalItemId: 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
        },
      ],
    },
  ],
};

describe('Auth + Admin API (e2e)', () => {
  let app: INestApplication<App>;
  let jwtService: JwtService;
  let passwordHash: string;

  const adminId = '11111111-1111-1111-1111-111111111111';
  const adminEmail = 'admin@example.com';

  const detail = {
    id: '22222222-2222-2222-2222-222222222222',
    key: 'education-mapping',
    name: 'Education Mapping',
    isActive: true,
    config: validConfig,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-02T00:00:00.000Z',
  };

  const auditRow = {
    id: '33333333-3333-3333-3333-333333333333',
    applicationId: detail.id,
    applicationKey: detail.key,
    actorId: adminId,
    actorEmail: adminEmail,
    action: ApplicationAuditAction.APPLICATION_CREATED,
    before: null,
    after: {
      id: detail.id,
      key: detail.key,
      name: detail.name,
      isActive: true,
      config: validConfig,
    },
    createdAt: new Date('2026-09-16T12:00:00.000Z'),
  };

  const tx = {
    application: {
      findUnique: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
    },
    applicationAuditLog: {
      create: jest.fn().mockResolvedValue(auditRow),
    },
  };

  const prismaMock = {
    $connect: jest.fn().mockResolvedValue(undefined),
    $disconnect: jest.fn().mockResolvedValue(undefined),
    $transaction: jest.fn((callback: (client: typeof tx) => unknown) =>
      Promise.resolve(callback(tx)),
    ),
    application: {
      findFirst: jest.fn(),
      findUnique: jest.fn(),
      findMany: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
    },
    applicationAuditLog: {
      count: jest.fn(),
      findMany: jest.fn(),
      create: jest.fn(),
    },
    adminUser: {
      findUnique: jest.fn(),
    },
  };

  beforeAll(async () => {
    passwordHash = await argon2.hash('correct-horse-battery', {
      type: argon2.argon2id,
    });
  });

  beforeEach(async () => {
    Object.values(prismaMock.application).forEach((fn) => fn.mockReset());
    Object.values(prismaMock.applicationAuditLog).forEach((fn) =>
      fn.mockReset(),
    );
    Object.values(tx.application).forEach((fn) => fn.mockReset());
    tx.applicationAuditLog.create.mockReset();
    tx.applicationAuditLog.create.mockResolvedValue(auditRow);
    prismaMock.adminUser.findUnique.mockReset();
    prismaMock.$transaction.mockReset();
    prismaMock.$transaction.mockImplementation(
      (callback: (client: typeof tx) => unknown) =>
        Promise.resolve(callback(tx)),
    );

    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [
        ConfigModule.forRoot({
          isGlobal: true,
          load: [
            () => ({
              JWT_SECRET,
              JWT_EXPIRES_IN: '1h',
            }),
          ],
        }),
        PrismaModule,
        AuthModule,
        AppConfigModule,
        AdminApplicationsModule,
        AuditModule,
        HealthModule,
      ],
    })
      .overrideProvider(PrismaService)
      .useValue(prismaMock)
      .compile();

    app = moduleFixture.createNestApplication();
    app.useGlobalPipes(
      new ValidationPipe({
        whitelist: true,
        forbidNonWhitelisted: true,
        transform: true,
      }),
    );
    await app.init();
    jwtService = app.get(JwtService);
  });

  afterEach(async () => {
    await app.close();
  });

  async function activeAdminToken(overrides?: {
    sub?: string;
    email?: string;
    role?: string;
    expiresIn?: string;
  }): Promise<string> {
    return jwtService.signAsync(
      {
        sub: overrides?.sub ?? adminId,
        email: overrides?.email ?? adminEmail,
        role: overrides?.role ?? ADMIN_ROLE,
      },
      {
        secret: JWT_SECRET,
        expiresIn: (overrides?.expiresIn ?? '1h') as `${number}h`,
      },
    );
  }

  function mockActiveAdminLookup() {
    prismaMock.adminUser.findUnique.mockImplementation(
      (args: { where: { id?: string; email?: string } }) => {
        if (args.where.email === adminEmail || args.where.id === adminId) {
          return Promise.resolve({
            id: adminId,
            email: adminEmail,
            passwordHash,
            isActive: true,
          });
        }
        return Promise.resolve(null);
      },
    );
  }

  describe('public routes', () => {
    it('GET /health without auth → 200', async () => {
      await request(app.getHttpServer())
        .get('/health')
        .expect(200)
        .expect({ status: 'ok' });
    });

    it('GET /api/v1/config/:appKey without auth → 200 raw config', async () => {
      prismaMock.application.findFirst.mockResolvedValue({
        config: validConfig,
      });

      const response = await request(app.getHttpServer())
        .get('/api/v1/config/education-mapping')
        .expect(200);

      expect(response.body).toEqual(validConfig);
      expect(response.body).not.toHaveProperty('passwordHash');
      expect(prismaMock.applicationAuditLog.create).not.toHaveBeenCalled();
      expect(tx.applicationAuditLog.create).not.toHaveBeenCalled();
    });
  });

  describe('login', () => {
    it('valid credentials → 200 + JWT', async () => {
      mockActiveAdminLookup();

      const response = await request(app.getHttpServer())
        .post('/api/v1/auth/login')
        .send({ email: 'Admin@Example.com', password: 'correct-horse-battery' })
        .expect(200);

      const body = response.body as Record<string, unknown>;
      expect(body.tokenType).toBe('Bearer');
      expect(typeof body.accessToken).toBe('string');
      expect(body.expiresIn).toBe(3600);
      expect(body).not.toHaveProperty('passwordHash');
    });

    it('nonexistent email → 401', async () => {
      prismaMock.adminUser.findUnique.mockResolvedValue(null);

      await request(app.getHttpServer())
        .post('/api/v1/auth/login')
        .send({
          email: 'missing@example.com',
          password: 'correct-horse-battery',
        })
        .expect(401);
    });

    it('wrong password → 401', async () => {
      mockActiveAdminLookup();

      await request(app.getHttpServer())
        .post('/api/v1/auth/login')
        .send({ email: adminEmail, password: 'wrong-password-xx' })
        .expect(401);
    });

    it('inactive admin → generic 401', async () => {
      prismaMock.adminUser.findUnique.mockResolvedValue({
        id: adminId,
        email: adminEmail,
        passwordHash,
        isActive: false,
      });

      await request(app.getHttpServer())
        .post('/api/v1/auth/login')
        .send({ email: adminEmail, password: 'correct-horse-battery' })
        .expect(401);
    });

    it('invalid body → 400', async () => {
      await request(app.getHttpServer())
        .post('/api/v1/auth/login')
        .send({ email: 'not-an-email', password: 'x' })
        .expect(400);
    });
  });

  describe('admin guard', () => {
    it('admin routes without token → 401', async () => {
      await request(app.getHttpServer())
        .get('/api/v1/admin/applications')
        .expect(401);
      await request(app.getHttpServer())
        .get('/api/v1/admin/applications/education-mapping')
        .expect(401);
      await request(app.getHttpServer())
        .get('/api/v1/admin/audit-logs')
        .expect(401);
      await request(app.getHttpServer())
        .get('/api/v1/admin/applications/education-mapping/audit-logs')
        .expect(401);
      await request(app.getHttpServer())
        .post('/api/v1/admin/applications')
        .send({
          key: 'inspection-hub',
          name: 'X',
          config: validConfig,
        })
        .expect(401);
      await request(app.getHttpServer())
        .patch('/api/v1/admin/applications/education-mapping')
        .send({ name: 'X' })
        .expect(401);
      await request(app.getHttpServer())
        .put('/api/v1/admin/applications/education-mapping/config')
        .send(validConfig)
        .expect(401);
    });

    it('malformed token → 401', async () => {
      await request(app.getHttpServer())
        .get('/api/v1/admin/applications')
        .set('Authorization', 'Bearer not.a.jwt')
        .expect(401);
    });

    it('invalid signature → 401', async () => {
      const bad = await jwtService.signAsync(
        { sub: adminId, email: adminEmail, role: ADMIN_ROLE },
        { secret: 'another-secret-that-is-long-enough!!', expiresIn: '1h' },
      );

      await request(app.getHttpServer())
        .get('/api/v1/admin/applications')
        .set('Authorization', `Bearer ${bad}`)
        .expect(401);
    });

    it('expired token → 401', async () => {
      const expired = await jwtService.signAsync(
        { sub: adminId, email: adminEmail, role: ADMIN_ROLE },
        { secret: JWT_SECRET, expiresIn: '0s' },
      );
      await new Promise((r) => setTimeout(r, 20));

      await request(app.getHttpServer())
        .get('/api/v1/admin/applications')
        .set('Authorization', `Bearer ${expired}`)
        .expect(401);
    });

    it('wrong role → 403', async () => {
      const token = await activeAdminToken({ role: 'USER' });
      await request(app.getHttpServer())
        .get('/api/v1/admin/applications')
        .set('Authorization', `Bearer ${token}`)
        .expect(403);
    });

    it('inactive admin with valid JWT → 403', async () => {
      const token = await activeAdminToken();
      prismaMock.adminUser.findUnique.mockResolvedValue({
        id: adminId,
        email: adminEmail,
        isActive: false,
      });

      await request(app.getHttpServer())
        .get('/api/v1/admin/applications')
        .set('Authorization', `Bearer ${token}`)
        .expect(403);

      await request(app.getHttpServer())
        .get('/api/v1/admin/audit-logs')
        .set('Authorization', `Bearer ${token}`)
        .expect(403);
    });
  });

  describe('authenticated admin management', () => {
    let token: string;

    beforeEach(async () => {
      mockActiveAdminLookup();
      token = await activeAdminToken();
    });

    it('lists metadata only without audit writes', async () => {
      prismaMock.application.findMany.mockResolvedValue([
        {
          id: detail.id,
          key: detail.key,
          name: detail.name,
          isActive: false,
          createdAt: detail.createdAt,
          updatedAt: detail.updatedAt,
        },
      ]);

      const response = await request(app.getHttpServer())
        .get('/api/v1/admin/applications')
        .set('Authorization', `Bearer ${token}`)
        .expect(200);

      const body = response.body as Array<Record<string, unknown>>;
      expect(body[0]).not.toHaveProperty('config');
      expect(body[0].isActive).toBe(false);
      expect(JSON.stringify(response.body)).not.toContain('passwordHash');
      expect(tx.applicationAuditLog.create).not.toHaveBeenCalled();
    });

    it('returns detail with config without audit writes', async () => {
      prismaMock.application.findUnique.mockResolvedValue(detail);

      const response = await request(app.getHttpServer())
        .get('/api/v1/admin/applications/education-mapping')
        .set('Authorization', `Bearer ${token}`)
        .expect(200);

      const body = response.body as Record<string, unknown>;
      expect(body.config).toEqual(validConfig);
      expect(tx.applicationAuditLog.create).not.toHaveBeenCalled();
    });

    it('creates application → 201 + audit', async () => {
      tx.application.create.mockResolvedValue({
        ...detail,
        key: 'inspection-hub',
        name: 'Inspection Hub',
      });

      const response = await request(app.getHttpServer())
        .post('/api/v1/admin/applications')
        .set('Authorization', `Bearer ${token}`)
        .send({
          key: 'inspection-hub',
          name: 'Inspection Hub',
          config: validConfig,
        })
        .expect(201);

      expect((response.body as Record<string, unknown>).key).toBe(
        'inspection-hub',
      );
      expect(prismaMock.$transaction).toHaveBeenCalled();
      const createdAudit = firstMockCallArg<{
        data: {
          action: ApplicationAuditAction;
          actorId: string;
          actorEmail: string;
          applicationKey: string;
          before: unknown;
        };
      }>(tx.applicationAuditLog.create);
      expect(createdAudit.data.action).toBe(
        ApplicationAuditAction.APPLICATION_CREATED,
      );
      expect(createdAudit.data.actorId).toBe(adminId);
      expect(createdAudit.data.actorEmail).toBe(adminEmail);
      expect(createdAudit.data.applicationKey).toBe('inspection-hub');
      expect(createdAudit.data.before).toBe(Prisma.DbNull);
    });

    it('duplicate key → 409 without audit', async () => {
      tx.application.create.mockRejectedValue(
        new Prisma.PrismaClientKnownRequestError('dup', {
          code: 'P2002',
          clientVersion: 'test',
        }),
      );

      await request(app.getHttpServer())
        .post('/api/v1/admin/applications')
        .set('Authorization', `Bearer ${token}`)
        .send({
          key: 'inspection-hub',
          name: 'Inspection Hub',
          config: validConfig,
        })
        .expect(409);

      expect(tx.applicationAuditLog.create).not.toHaveBeenCalled();
    });

    it('patches metadata + audit', async () => {
      tx.application.findUnique.mockResolvedValue(detail);
      tx.application.update.mockResolvedValue({
        ...detail,
        name: 'Renamed',
        isActive: false,
      });

      const response = await request(app.getHttpServer())
        .patch('/api/v1/admin/applications/education-mapping')
        .set('Authorization', `Bearer ${token}`)
        .send({ name: 'Renamed', isActive: false })
        .expect(200);

      const body = response.body as Record<string, unknown>;
      expect(body.name).toBe('Renamed');
      expect(body.isActive).toBe(false);
      const patchedAudit = firstMockCallArg<{
        data: {
          action: ApplicationAuditAction;
          actorId: string;
          actorEmail: string;
        };
      }>(tx.applicationAuditLog.create);
      expect(patchedAudit.data.action).toBe(
        ApplicationAuditAction.APPLICATION_METADATA_UPDATED,
      );
      expect(patchedAudit.data.actorId).toBe(adminId);
      expect(patchedAudit.data.actorEmail).toBe(adminEmail);
    });

    it('replaces config + audit', async () => {
      tx.application.findUnique.mockResolvedValue(detail);
      tx.application.update.mockResolvedValue(detail);

      await request(app.getHttpServer())
        .put('/api/v1/admin/applications/education-mapping/config')
        .set('Authorization', `Bearer ${token}`)
        .send(validConfig)
        .expect(200);

      const configAudit = firstMockCallArg<{
        data: {
          action: ApplicationAuditAction;
          before: unknown;
          after: unknown;
        };
      }>(tx.applicationAuditLog.create);
      expect(configAudit.data.action).toBe(
        ApplicationAuditAction.APPLICATION_CONFIG_REPLACED,
      );
      expect(configAudit.data.before).toEqual(validConfig);
      expect(configAudit.data.after).toEqual(validConfig);
    });

    it('creates harmonized Population Mapping application and preserves config', async () => {
      const created = {
        ...detail,
        key: 'population-mapping',
        name: 'Population Mapping',
        config: populationMappingFixture,
      };
      tx.application.create.mockResolvedValue(created);

      const createResponse = await request(app.getHttpServer())
        .post('/api/v1/admin/applications')
        .set('Authorization', `Bearer ${token}`)
        .send({
          key: 'population-mapping',
          name: 'Population Mapping',
          config: populationMappingFixture,
        })
        .expect(201);

      expect((createResponse.body as Record<string, unknown>).config).toEqual(
        populationMappingFixture,
      );
      const createArg = firstMockCallArg<{
        data: { config: unknown };
      }>(tx.application.create);
      expect(createArg.data.config).toEqual(populationMappingFixture);

      prismaMock.application.findUnique.mockResolvedValue(created);
      const detailResponse = await request(app.getHttpServer())
        .get('/api/v1/admin/applications/population-mapping')
        .set('Authorization', `Bearer ${token}`)
        .expect(200);

      expect((detailResponse.body as Record<string, unknown>).config).toEqual(
        populationMappingFixture,
      );
    });

    it('PUT harmonized Health Mapping config preserves extensions and unknown fields', async () => {
      const existing = {
        ...detail,
        key: 'health-mapping',
        name: 'Health Mapping',
        config: educationMappingFixture,
      };
      const updated = {
        ...existing,
        config: healthMappingFixture,
      };
      tx.application.findUnique.mockResolvedValue(existing);
      tx.application.update.mockResolvedValue(updated);

      await request(app.getHttpServer())
        .put('/api/v1/admin/applications/health-mapping/config')
        .set('Authorization', `Bearer ${token}`)
        .send(healthMappingFixture)
        .expect(200);

      expect(tx.application.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: { config: healthMappingFixture },
        }),
      );

      prismaMock.application.findFirst.mockResolvedValue({
        config: healthMappingFixture,
      });
      const publicResponse = await request(app.getHttpServer())
        .get('/api/v1/config/health-mapping')
        .expect(200);

      expect(publicResponse.body).toEqual(healthMappingFixture);
      expect(publicResponse.body).toHaveProperty('extensions');
      expect(publicResponse.body).toHaveProperty('futureOptional');
      expect((publicResponse.body as { branding: unknown }).branding).toEqual(
        healthMappingFixture.branding,
      );
    });

    it('Education Mapping fixture round-trip does not require additive fields', async () => {
      const created = {
        ...detail,
        config: educationMappingFixture,
      };
      tx.application.create.mockResolvedValue(created);

      await request(app.getHttpServer())
        .post('/api/v1/admin/applications')
        .set('Authorization', `Bearer ${token}`)
        .send({
          key: 'education-mapping-v1',
          name: 'Education Mapping',
          config: educationMappingFixture,
        })
        .expect(201);

      expect(educationMappingFixture).not.toHaveProperty('branding');
      expect(educationMappingFixture).not.toHaveProperty('extensions');
      expect(educationMappingFixture.modules[0].apps[0]).toEqual(
        expect.objectContaining({
          kind: 'dashboard',
          portalItemId: '00000000000000000000000000000001',
        }),
      );
      expect(educationMappingFixture.app).toHaveProperty('hero');
      expect(educationMappingFixture.modules[0]).toHaveProperty('apps');
    });

    it('rejects malformed harmonized config on create', async () => {
      await request(app.getHttpServer())
        .post('/api/v1/admin/applications')
        .set('Authorization', `Bearer ${token}`)
        .send({
          key: 'bad-app',
          name: 'Bad App',
          config: { modules: {} },
        })
        .expect(400);

      expect(prismaMock.$transaction).not.toHaveBeenCalled();
    });
  });

  describe('audit history endpoints', () => {
    let token: string;

    beforeEach(async () => {
      mockActiveAdminLookup();
      token = await activeAdminToken();
    });

    it('GET global audit-logs → paginated newest first', async () => {
      const newer = {
        ...auditRow,
        id: '44444444-4444-4444-4444-444444444444',
        createdAt: new Date('2026-09-16T13:00:00.000Z'),
        action: ApplicationAuditAction.APPLICATION_CONFIG_REPLACED,
      };
      const older = {
        ...auditRow,
        createdAt: new Date('2026-09-16T12:00:00.000Z'),
      };
      prismaMock.applicationAuditLog.count.mockResolvedValue(2);
      prismaMock.applicationAuditLog.findMany.mockResolvedValue([newer, older]);

      const response = await request(app.getHttpServer())
        .get('/api/v1/admin/audit-logs')
        .set('Authorization', `Bearer ${token}`)
        .expect(200);

      const body = response.body as {
        items: Array<Record<string, unknown>>;
        page: number;
        limit: number;
        total: number;
        totalPages: number;
      };
      expect(body.page).toBe(1);
      expect(body.limit).toBe(20);
      expect(body.total).toBe(2);
      expect(body.totalPages).toBe(1);
      expect(body.items).toHaveLength(2);
      expect(body.items[0].id).toBe(newer.id);
      expect(body.items[0].application).toEqual({
        id: detail.id,
        key: detail.key,
      });
      expect(body.items[0].actor).toEqual({
        id: adminId,
        email: adminEmail,
      });
      expect(JSON.stringify(body)).not.toContain('passwordHash');
      const findManyArgs = firstMockCallArg<{
        orderBy: unknown;
        skip: number;
        take: number;
      }>(prismaMock.applicationAuditLog.findMany);
      expect(findManyArgs.orderBy).toEqual([
        { createdAt: 'desc' },
        { id: 'desc' },
      ]);
      expect(findManyArgs.skip).toBe(0);
      expect(findManyArgs.take).toBe(20);
      expect(tx.applicationAuditLog.create).not.toHaveBeenCalled();
    });

    it('GET audit-logs pagination + filters', async () => {
      prismaMock.applicationAuditLog.count.mockResolvedValue(0);
      prismaMock.applicationAuditLog.findMany.mockResolvedValue([]);

      await request(app.getHttpServer())
        .get('/api/v1/admin/audit-logs')
        .query({
          page: 2,
          limit: 10,
          applicationKey: 'education-mapping',
          action: ApplicationAuditAction.APPLICATION_CREATED,
          actorEmail: 'Admin@Example.com',
          dateFrom: '2026-01-01T00:00:00.000Z',
          dateTo: '2026-12-31T23:59:59.999Z',
        })
        .set('Authorization', `Bearer ${token}`)
        .expect(200);

      const filterArgs = firstMockCallArg<{
        where: {
          applicationKey: string;
          action: ApplicationAuditAction;
          actorEmail: string;
          createdAt: { gte: Date; lte: Date };
        };
        skip: number;
        take: number;
      }>(prismaMock.applicationAuditLog.findMany);
      expect(filterArgs.where.applicationKey).toBe('education-mapping');
      expect(filterArgs.where.action).toBe(
        ApplicationAuditAction.APPLICATION_CREATED,
      );
      expect(filterArgs.where.actorEmail).toBe('admin@example.com');
      expect(filterArgs.where.createdAt).toEqual({
        gte: new Date('2026-01-01T00:00:00.000Z'),
        lte: new Date('2026-12-31T23:59:59.999Z'),
      });
      expect(filterArgs.skip).toBe(10);
      expect(filterArgs.take).toBe(10);
    });

    it('invalid date range → 400', async () => {
      await request(app.getHttpServer())
        .get('/api/v1/admin/audit-logs')
        .query({
          dateFrom: '2026-09-02T00:00:00.000Z',
          dateTo: '2026-09-01T00:00:00.000Z',
        })
        .set('Authorization', `Bearer ${token}`)
        .expect(400);
    });

    it('per-app history isolates by applicationKey', async () => {
      prismaMock.application.findUnique.mockResolvedValue(detail);
      prismaMock.applicationAuditLog.count.mockResolvedValue(1);
      prismaMock.applicationAuditLog.findMany.mockResolvedValue([auditRow]);

      const response = await request(app.getHttpServer())
        .get('/api/v1/admin/applications/education-mapping/audit-logs')
        .set('Authorization', `Bearer ${token}`)
        .expect(200);

      const body = response.body as { items: unknown[]; total: number };
      expect(body.total).toBe(1);
      const appHistoryArgs = firstMockCallArg<{
        where: { applicationKey: string };
      }>(prismaMock.applicationAuditLog.findMany);
      expect(appHistoryArgs.where).toEqual({
        applicationKey: 'education-mapping',
      });
    });

    it('per-app history empty → 200 items=[]', async () => {
      prismaMock.application.findUnique.mockResolvedValue(detail);
      prismaMock.applicationAuditLog.count.mockResolvedValue(0);
      prismaMock.applicationAuditLog.findMany.mockResolvedValue([]);

      const response = await request(app.getHttpServer())
        .get('/api/v1/admin/applications/education-mapping/audit-logs')
        .set('Authorization', `Bearer ${token}`)
        .expect(200);

      expect(response.body).toEqual({
        items: [],
        page: 1,
        limit: 20,
        total: 0,
        totalPages: 0,
      });
    });

    it('unknown application audit history → 404', async () => {
      prismaMock.application.findUnique.mockResolvedValue(null);

      await request(app.getHttpServer())
        .get('/api/v1/admin/applications/missing-app/audit-logs')
        .set('Authorization', `Bearer ${token}`)
        .expect(404);

      expect(prismaMock.applicationAuditLog.findMany).not.toHaveBeenCalled();
    });
  });
});
