import { INestApplication } from '@nestjs/common';
import type { Server } from 'http';
import { JwtModule, JwtService } from '@nestjs/jwt';
import { Test } from '@nestjs/testing';
import { ThrottlerModule } from '@nestjs/throttler';
import { MonitorOutcome } from '@prisma/client';
import request from 'supertest';
import { AdminAuthGuard } from '../auth/admin-auth.guard';
import { ADMIN_ROLE } from '../auth/auth.constants';
import { PrismaService } from '../prisma/prisma.service';
import { MonitorAlertService } from './monitor-alert.service';
import { MonitorRunnerService } from './monitor-runner.service';
import { MonitoringController } from './monitoring.controller';
import { displayStatus, MonitoringService } from './monitoring.service';

const SECRET = 'test-secret-for-monitoring-controller-32b';
const ADMIN = {
  id: '11111111-1111-1111-1111-111111111111',
  email: 'admin@example.com',
};

describe('MonitoringController (admin only)', () => {
  let app: INestApplication;
  let jwt: JwtService;
  const prisma = { adminUser: { findUnique: jest.fn() } };
  const monitoring = { status: jest.fn(), history: jest.fn() };
  const runner = { start: jest.fn() };
  const alerts = {
    settings: { configured: true, error: null as string | null },
    sendTest: jest.fn(),
  };

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [
        JwtModule.register({ secret: SECRET }),
        ThrottlerModule.forRoot([
          { name: 'default', ttl: 60_000, limit: 1000 },
        ]),
      ],
      controllers: [MonitoringController],
      providers: [
        AdminAuthGuard,
        { provide: PrismaService, useValue: prisma },
        { provide: MonitoringService, useValue: monitoring },
        { provide: MonitorRunnerService, useValue: runner },
        { provide: MonitorAlertService, useValue: alerts },
      ],
    }).compile();
    app = moduleRef.createNestApplication();
    await app.init();
    jwt = moduleRef.get(JwtService);
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(() => {
    jest.clearAllMocks();
    prisma.adminUser.findUnique.mockResolvedValue({ ...ADMIN, isActive: true });
    monitoring.status.mockResolvedValue({ checks: [] });
  });

  const httpServer = () => app.getHttpServer() as Server;

  const adminToken = () =>
    jwt.sign({ sub: ADMIN.id, email: ADMIN.email, role: ADMIN_ROLE });

  it('refuses status, history and run without a token', async () => {
    const server = httpServer();
    await request(server).get('/api/v1/admin/monitoring/status').expect(401);
    await request(server)
      .get('/api/v1/admin/monitoring/history?checkType=app&targetKey=x')
      .expect(401);
    await request(server).post('/api/v1/admin/monitoring/run').expect(401);
    expect(monitoring.status).not.toHaveBeenCalled();
    expect(runner.start).not.toHaveBeenCalled();
  });

  it('refuses a forged token and an inactive admin', async () => {
    const forged = new JwtService({
      secret: 'some-other-secret-value-of-32-bytes!!',
    }).sign({
      sub: ADMIN.id,
      email: ADMIN.email,
      role: ADMIN_ROLE,
    });
    await request(httpServer())
      .get('/api/v1/admin/monitoring/status')
      .set('Authorization', `Bearer ${forged}`)
      .expect(401);

    prisma.adminUser.findUnique.mockResolvedValue({
      ...ADMIN,
      isActive: false,
    });
    await request(httpServer())
      .get('/api/v1/admin/monitoring/status')
      .set('Authorization', `Bearer ${adminToken()}`)
      .expect(403);
  });

  it('returns status to an active admin', async () => {
    await request(httpServer())
      .get('/api/v1/admin/monitoring/status')
      .set('Authorization', `Bearer ${adminToken()}`)
      .expect(200, { checks: [] });
  });

  it('starts a manual run as the admin, or answers 409 when one is running', async () => {
    runner.start.mockResolvedValueOnce('run-9').mockResolvedValueOnce(null);
    await request(httpServer())
      .post('/api/v1/admin/monitoring/run')
      .set('Authorization', `Bearer ${adminToken()}`)
      .expect(202, { runId: 'run-9' });
    expect(runner.start).toHaveBeenCalledWith('manual', ADMIN.email);
    await request(httpServer())
      .post('/api/v1/admin/monitoring/run')
      .set('Authorization', `Bearer ${adminToken()}`)
      .expect(409);
  });

  describe('test alert', () => {
    afterEach(() => {
      alerts.settings = { configured: true, error: null };
    });

    it('needs an admin', async () => {
      await request(httpServer())
        .post('/api/v1/admin/monitoring/test-alert')
        .expect(401);
      expect(alerts.sendTest).not.toHaveBeenCalled();
    });

    it('explains when email is not set up', async () => {
      alerts.settings = {
        configured: false,
        error: 'MONITOR_SMTP_HOST is not set',
      };
      const res = await request(httpServer())
        .post('/api/v1/admin/monitoring/test-alert')
        .set('Authorization', `Bearer ${adminToken()}`)
        .expect(400);
      expect((res.body as { message: string }).message).toBe(
        'Email alerts are not configured: MONITOR_SMTP_HOST is not set',
      );
      expect(alerts.sendTest).not.toHaveBeenCalled();
    });

    it('sends as the admin and reports SMTP failures as 502', async () => {
      const delivered = { at: 'now', kind: 'test', ok: true, error: null };
      alerts.sendTest.mockResolvedValueOnce(delivered).mockResolvedValueOnce({
        ...delivered,
        ok: false,
        error: 'Greeting never received',
      });
      await request(httpServer())
        .post('/api/v1/admin/monitoring/test-alert')
        .set('Authorization', `Bearer ${adminToken()}`)
        .expect(200, delivered);
      expect(alerts.sendTest).toHaveBeenCalledWith(ADMIN.email);
      const res = await request(httpServer())
        .post('/api/v1/admin/monitoring/test-alert')
        .set('Authorization', `Bearer ${adminToken()}`)
        .expect(502);
      expect((res.body as { message: string }).message).toBe(
        'Test email failed: Greeting never received',
      );
    });
  });
});

describe('displayStatus', () => {
  it('shows one failure as amber and red only after two in a row', () => {
    expect(displayStatus(MonitorOutcome.PASS, 0)).toBe('green');
    expect(displayStatus(MonitorOutcome.WARN, 0)).toBe('amber');
    expect(displayStatus(MonitorOutcome.SKIP, 0)).toBe('grey');
    expect(displayStatus(MonitorOutcome.FAIL, 1)).toBe('amber');
    expect(displayStatus(MonitorOutcome.FAIL, 2)).toBe('red');
  });
});
