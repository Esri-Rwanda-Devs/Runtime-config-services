import { INestApplication, ValidationPipe } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtModule } from '@nestjs/jwt';
import { Test } from '@nestjs/testing';
import { ThrottlerModule } from '@nestjs/throttler';
import request from 'supertest';
import { PrismaService } from '../prisma/prisma.service';
import {
  ArcgisPortalClient,
  PortalAuthError,
} from '../portal/arcgis-portal.client';
import { PortalAuthTokenService } from '../portal/portal-auth-token.service';
import { AppSessionController } from './app-session.controller';
import { AppSessionService } from './app-session.service';
import { PortalProxyController } from './portal-proxy.controller';
import {
  isProxyRequestAllowed,
  resolveUpstreamUrl,
  rewriteLocation,
  rewritePayload,
} from './portal-proxy.rewrite';

const ORIGIN = 'https://gh.space.gov.rw';
const APP = 'infrastructure-mapping';
const SERVICE_TOKEN = 'SERVICE-ACCOUNT-TOKEN-abc123';
const PREFIX = `/api/v1/portal-proxy/${APP}/gh`;

describe('app session + portal proxy (HTTP)', () => {
  let app: INestApplication;
  let generateToken: jest.Mock;
  let issueToken: jest.Mock;
  let fetchMock: jest.SpyInstance;

  beforeEach(async () => {
    generateToken = jest
      .fn()
      .mockResolvedValue({ token: 'user-token', expiresAt: 0 });
    issueToken = jest.fn().mockResolvedValue({
      token: SERVICE_TOKEN,
      expiresAt: Date.now() + 600_000,
      referer: ORIGIN,
      portalUrl: `${ORIGIN}/portal`,
      portalHostKey: 'gh',
    });
    const prisma = {
      application: {
        findUnique: jest.fn().mockResolvedValue({
          isActive: true,
          config: { modules: [{ apps: [{ portalHostKey: 'gh' }] }] },
        }),
      },
      portalCredential: {
        findUnique: jest
          .fn()
          .mockResolvedValue({ portalUrl: `${ORIGIN}/portal`, isActive: true }),
      },
    };
    const env: Record<string, string> = {
      ALLOWED_ORIGINS: `${ORIGIN},https://localhost:5181`,
      JWT_SECRET: 'x'.repeat(40),
    };

    const moduleRef = await Test.createTestingModule({
      imports: [
        JwtModule.register({ secret: 'admin-secret-not-used-here' }),
        ThrottlerModule.forRoot([
          { name: 'default', ttl: 60_000, limit: 1000 },
        ]),
      ],
      controllers: [AppSessionController, PortalProxyController],
      providers: [
        AppSessionService,
        { provide: PrismaService, useValue: prisma },
        { provide: ArcgisPortalClient, useValue: { generateToken } },
        { provide: PortalAuthTokenService, useValue: { issueToken } },
        { provide: ConfigService, useValue: { get: (k: string) => env[k] } },
      ],
    }).compile();

    app = moduleRef.createNestApplication({ rawBody: true });
    app.useGlobalPipes(
      new ValidationPipe({
        whitelist: true,
        forbidNonWhitelisted: true,
        transform: true,
      }),
    );
    await app.init();

    fetchMock = jest.spyOn(globalThis, 'fetch');
  });

  afterEach(async () => {
    fetchMock.mockRestore();
    await app.close();
  });

  async function signIn(): Promise<string> {
    const res = await request(app.getHttpServer())
      .post('/api/v1/app-auth/login')
      .set('Origin', ORIGIN)
      .send({ appKey: APP, username: 'alice', password: 'pw' })
      .expect(200);
    const setCookie = String(res.headers['set-cookie']);
    return setCookie.split(';')[0];
  }

  it('login verifies the user against the portal and sets an HttpOnly cookie without any token', async () => {
    const res = await request(app.getHttpServer())
      .post('/api/v1/app-auth/login')
      .set('Origin', ORIGIN)
      .send({ appKey: APP, username: 'alice', password: 'pw' })
      .expect(200);
    expect(generateToken).toHaveBeenCalledWith(
      expect.objectContaining({ username: 'alice', referer: ORIGIN }),
    );
    expect(res.body).toMatchObject({
      authenticated: true,
      user: { username: 'alice' },
    });
    expect(JSON.stringify(res.body)).not.toContain('user-token');
    const cookie = String(res.headers['set-cookie']);
    expect(cookie).toMatch(/^rc_app_session=/);
    expect(cookie).toContain('HttpOnly');
    expect(cookie).toContain('Secure');
    expect(cookie).toContain('SameSite=Lax');
    expect(cookie).toContain('Path=/api/v1/');
  });

  it('login rejects a disallowed or missing Origin', async () => {
    await request(app.getHttpServer())
      .post('/api/v1/app-auth/login')
      .set('Origin', 'https://evil.example')
      .send({ appKey: APP, username: 'alice', password: 'pw' })
      .expect(400);
    await request(app.getHttpServer())
      .post('/api/v1/app-auth/login')
      .send({ appKey: APP, username: 'alice', password: 'pw' })
      .expect(400);
    expect(generateToken).not.toHaveBeenCalled();
  });

  it('login returns 401 for bad portal credentials', async () => {
    generateToken.mockRejectedValueOnce(new PortalAuthError('nope'));
    await request(app.getHttpServer())
      .post('/api/v1/app-auth/login')
      .set('Origin', ORIGIN)
      .send({ appKey: APP, username: 'alice', password: 'bad' })
      .expect(401);
  });

  it('session reflects the cookie and is app-scoped; logout clears it', async () => {
    const cookie = await signIn();
    await request(app.getHttpServer())
      .get(`/api/v1/app-auth/session?appKey=${APP}`)
      .set('Cookie', cookie)
      .expect(200);
    await request(app.getHttpServer())
      .get('/api/v1/app-auth/session?appKey=health-mapping')
      .set('Cookie', cookie)
      .expect(401);
    await request(app.getHttpServer())
      .get(`/api/v1/app-auth/session?appKey=${APP}`)
      .expect(401);
    const out = await request(app.getHttpServer())
      .post('/api/v1/app-auth/logout')
      .set('Origin', ORIGIN)
      .expect(200);
    expect(String(out.headers['set-cookie'])).toContain('Max-Age=0');
  });

  it('rejects a forged / admin-signed cookie', async () => {
    await request(app.getHttpServer())
      .get(`${PREFIX}/portal/apps/dashboards/abc`)
      .set('Cookie', 'rc_app_session=eyJhbGciOiJIUzI1NiJ9.e30.bad')
      .expect(401);
  });

  it('proxy refuses requests without a session and never mints a token', async () => {
    await request(app.getHttpServer())
      .get(`${PREFIX}/portal/apps/dashboards/abc`)
      .expect(401);
    expect(issueToken).not.toHaveBeenCalled();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('proxy attaches the service token upstream and scrubs it from the response', async () => {
    const cookie = await signIn();
    fetchMock.mockResolvedValueOnce(
      new Response(
        `<html><head></head><script src="/portal/apps/dashboards/x.js"></script>${ORIGIN}/server/rest ${SERVICE_TOKEN}</html>`,
        { status: 200, headers: { 'content-type': 'text/html' } },
      ),
    );
    const res = await request(app.getHttpServer())
      .get(`${PREFIX}/portal/apps/dashboards/abc?f=json&token=client-supplied`)
      .set('Cookie', cookie)
      .expect(200);

    expect(issueToken).toHaveBeenCalledWith({
      appKey: APP,
      portalHostKey: 'gh',
      origin: ORIGIN,
    });
    const [target, init] = fetchMock.mock.calls[0] as [URL, RequestInit];
    expect(target.origin).toBe(ORIGIN);
    expect(target.pathname).toBe('/portal/apps/dashboards/abc');
    expect(target.searchParams.getAll('token')).toEqual([SERVICE_TOKEN]);
    expect(target.searchParams.get('f')).toBe('json');
    expect((init.headers as Record<string, string>).referer).toBe(`${ORIGIN}/`);

    expect(res.text).not.toContain(SERVICE_TOKEN);
    expect(res.text).toContain(`"${PREFIX}/portal/apps/dashboards/x.js"`);
    expect(res.text).toContain(`${PREFIX}/server/rest`);
    expect(res.headers['cache-control']).toBe('private, no-store');
    expect(res.headers['set-cookie']).toBeUndefined();
  });

  it('proxy forwards POST bodies and rewrites redirects without the token', async () => {
    const cookie = await signIn();
    fetchMock.mockResolvedValueOnce(
      new Response(null, {
        status: 302,
        headers: {
          location: `${ORIGIN}/portal/sharing/rest/content/items/1/data?token=${SERVICE_TOKEN}`,
        },
      }),
    );
    const res = await request(app.getHttpServer())
      .post(`${PREFIX}/server/rest/services/X/FeatureServer/0/query`)
      .set('Cookie', cookie)
      .set('Origin', ORIGIN)
      .type('form')
      .send('where=1%3D1&f=json')
      .expect(302);
    const [, init] = fetchMock.mock.calls[0] as [URL, RequestInit];
    expect(Buffer.from(init.body as Uint8Array).toString()).toBe(
      'where=1%3D1&f=json',
    );
    expect(res.headers.location).toBe(
      `${PREFIX}/portal/sharing/rest/content/items/1/data?token=`,
    );
    expect(res.headers.location).not.toContain(SERVICE_TOKEN);
  });

  it('proxy refuses another origin, blocked operations and other apps', async () => {
    const cookie = await signIn();
    await request(app.getHttpServer())
      .post(`${PREFIX}/server/rest/services/X/FeatureServer/0/query`)
      .set('Cookie', cookie)
      .set('Origin', 'https://evil.example')
      .expect(403);
    await request(app.getHttpServer())
      .post(`${PREFIX}/portal/sharing/rest/generateToken`)
      .set('Cookie', cookie)
      .expect(403);
    await request(app.getHttpServer())
      .post(`${PREFIX}/server/rest/services/X/FeatureServer/0/applyEdits`)
      .set('Cookie', cookie)
      .expect(403);
    await request(app.getHttpServer())
      .delete(`${PREFIX}/portal/apps/x`)
      .set('Cookie', cookie)
      .expect(403);
    await request(app.getHttpServer())
      .get(`/api/v1/portal-proxy/health-mapping/gh/portal/apps/x`)
      .set('Cookie', cookie)
      .expect(401);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe('portal proxy rewrite helpers', () => {
  it('keeps upstream on the portal origin', () => {
    expect(resolveUpstreamUrl(ORIGIN, '//evil.example/x', '')).not.toBeNull();
    expect(resolveUpstreamUrl(ORIGIN, '//evil.example/x', '')?.origin).toBe(
      ORIGIN,
    );
    expect(resolveUpstreamUrl(ORIGIN, '../../x', '')?.origin).toBe(ORIGIN);
  });

  it('blocks admin and mutating sharing calls, allows reads', () => {
    expect(isProxyRequestAllowed('GET', 'portal/portaladmin/users')).toBe(
      false,
    );
    expect(
      isProxyRequestAllowed(
        'POST',
        'portal/sharing/rest/content/users/u/items/1/delete',
      ),
    ).toBe(false);
    expect(
      isProxyRequestAllowed('GET', 'portal/sharing/rest/oauth2/authorize'),
    ).toBe(false);
    expect(
      isProxyRequestAllowed('GET', 'portal/sharing/rest/content/items/1/data'),
    ).toBe(true);
    expect(
      isProxyRequestAllowed('POST', 'server/rest/services/A/MapServer/0/query'),
    ).toBe(true);
  });

  it('rewrites absolute and escaped portal URLs and does not double-prefix', () => {
    const prefix = PREFIX;
    const out = rewritePayload(
      `{"u":"${ORIGIN}/portal","e":"https:\\/\\/gh.space.gov.rw\\/server","p":"${prefix}/portal/x"}`,
      {
        portalOrigin: ORIGIN,
        prefix,
        contentType: 'application/json',
        restPath: 'portal/sharing/rest/portals/self',
        token: null,
      },
    );
    expect(out).toContain(`"u":"${prefix}/portal"`);
    expect(out).toContain(`"e":"${prefix.replaceAll('/', '\\/')}\\/server"`);
    expect(out).toContain(`"p":"${prefix}/portal/x"`);
    expect(out).not.toContain(prefix + prefix);
  });

  it('rewrites root-relative redirects', () => {
    expect(rewriteLocation('/portal/home/', ORIGIN, PREFIX, null)).toBe(
      `${PREFIX}/portal/home/`,
    );
  });
});
