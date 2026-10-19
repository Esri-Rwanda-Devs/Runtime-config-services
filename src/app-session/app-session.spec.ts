import {
  get as httpGet,
  type IncomingHttpHeaders,
  type Server,
} from 'node:http';
import type { AddressInfo } from 'node:net';
import { brotliDecompressSync, gunzipSync } from 'node:zlib';
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
  let prismaMock: {
    application: { findUnique: jest.Mock };
    portalCredential: { findUnique: jest.Mock };
  };

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
    const prisma = (prismaMock = {
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
    });
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

  async function signIn(appKey = APP): Promise<string> {
    const res = await request(app.getHttpServer())
      .post('/api/v1/app-auth/login')
      .set('Origin', ORIGIN)
      .send({ appKey, username: 'alice', password: 'pw' })
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
    expect(cookie).toMatch(new RegExp(`^rc_app_session_${APP}=`));
    expect(cookie).toContain('HttpOnly');
    expect(cookie).toContain('Secure');
    expect(cookie).toContain('SameSite=Lax');
    expect(cookie).toContain('Path=/api/v1/');
  });

  it('login works for an app whose dashboards are on other portals only', async () => {
    prismaMock.application.findUnique.mockResolvedValueOnce({ isActive: true });
    await request(app.getHttpServer())
      .post('/api/v1/app-auth/login')
      .set('Origin', ORIGIN)
      .send({ appKey: 'health-mapping', username: 'alice', password: 'pw' })
      .expect(200);
    expect(prismaMock.portalCredential.findUnique).toHaveBeenCalledWith(
      expect.objectContaining({ where: { key: 'gh' } }),
    );
  });

  it('login is refused for an inactive app or a missing login portal', async () => {
    prismaMock.application.findUnique.mockResolvedValueOnce({
      isActive: false,
    });
    await request(app.getHttpServer())
      .post('/api/v1/app-auth/login')
      .set('Origin', ORIGIN)
      .send({ appKey: APP, username: 'alice', password: 'pw' })
      .expect(403);
    prismaMock.portalCredential.findUnique.mockResolvedValueOnce(null);
    await request(app.getHttpServer())
      .post('/api/v1/app-auth/login')
      .set('Origin', ORIGIN)
      .send({ appKey: APP, username: 'alice', password: 'pw' })
      .expect(403);
    expect(generateToken).not.toHaveBeenCalled();
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

  it('keeps each app signed in separately on one origin', async () => {
    const infra = await signIn();
    const health = await signIn('health-mapping');
    expect(health).toMatch(/^rc_app_session_health-mapping=/);
    const both = `${infra}; ${health}`;
    await request(app.getHttpServer())
      .get(`/api/v1/app-auth/session?appKey=${APP}`)
      .set('Cookie', both)
      .expect(200);
    await request(app.getHttpServer())
      .get('/api/v1/app-auth/session?appKey=health-mapping')
      .set('Cookie', both)
      .expect(200);
    // Another app's cookie never opens this app, even under this app's name.
    const healthValue = health.split('=').slice(1).join('=');
    await request(app.getHttpServer())
      .get(`/api/v1/app-auth/session?appKey=${APP}`)
      .set('Cookie', `rc_app_session_${APP}=${healthValue}`)
      .expect(401);
  });

  it('still accepts a session cookie issued before the per-app split', async () => {
    const value = (await signIn()).split('=').slice(1).join('=');
    await request(app.getHttpServer())
      .get(`/api/v1/app-auth/session?appKey=${APP}`)
      .set('Cookie', `rc_app_session=${value}`)
      .expect(200);
  });

  it('logout with appKey clears only that app; without it clears every app', async () => {
    const infra = await signIn();
    const health = await signIn('health-mapping');
    const one = await request(app.getHttpServer())
      .post(`/api/v1/app-auth/logout?appKey=${APP}`)
      .set('Origin', ORIGIN)
      .set('Cookie', `${infra}; ${health}`)
      .expect(200);
    const cleared = ([] as string[]).concat(one.headers['set-cookie'] ?? []);
    expect(cleared).toEqual(
      expect.arrayContaining([
        expect.stringMatching(
          new RegExp(`^rc_app_session_${APP}=;.*Max-Age=0`),
        ),
        expect.stringMatching(/^rc_app_session=;.*Max-Age=0/),
      ]),
    );
    expect(cleared.join(' ')).not.toContain('health-mapping');

    const all = await request(app.getHttpServer())
      .post('/api/v1/app-auth/logout')
      .set('Origin', ORIGIN)
      .set('Cookie', `${infra}; ${health}`)
      .expect(200);
    const names = ([] as string[])
      .concat(all.headers['set-cookie'] ?? [])
      .map((c) => c.split('=')[0]);
    expect(names.sort()).toEqual(
      [
        'rc_app_session',
        `rc_app_session_${APP}`,
        'rc_app_session_health-mapping',
      ].sort(),
    );

    await request(app.getHttpServer())
      .post('/api/v1/app-auth/logout?appKey=Bad Key')
      .set('Origin', ORIGIN)
      .expect(400);
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
    expect(res.text).toContain(`>${ORIGIN}${PREFIX}/server/rest `);
    expect(res.headers['cache-control']).toBe('private, no-store');
    expect(res.headers['set-cookie']).toBeUndefined();
  });

  it('proxy keeps a federated server owningSystemUrl absolute on the app origin', async () => {
    // A portal on another host (City of Kigali) framed from the GeoHub origin.
    // An origin-less owningSystemUrl never matches the portal IdentityManager
    // knows, and it loops on sign-in until the page freezes.
    const COK = 'https://inspection.kigalicity.gov.rw';
    const cokPrefix = `/api/v1/portal-proxy/${APP}/cok`;
    issueToken.mockResolvedValue({
      token: SERVICE_TOKEN,
      expiresAt: Date.now() + 600_000,
      referer: ORIGIN,
      portalUrl: `${COK}/portal`,
      portalHostKey: 'cok',
    });
    const cookie = await signIn();
    fetchMock.mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          currentVersion: 11.3,
          owningSystemUrl: `${COK}/portal`,
          authInfo: {
            isTokenBasedSecurity: true,
            tokenServicesUrl: `${COK}/portal/sharing/rest/generateToken`,
          },
        }),
        { status: 200, headers: { 'content-type': 'application/json' } },
      ),
    );
    const res = await request(app.getHttpServer())
      .get(`${cokPrefix}/server/rest/info?f=json`)
      .set('Cookie', cookie)
      .set('Accept-Encoding', 'identity')
      .expect(200);
    const info = JSON.parse(res.text) as {
      owningSystemUrl: string;
      authInfo: { tokenServicesUrl: string };
    };
    expect(info.owningSystemUrl).toBe(`${ORIGIN}${cokPrefix}/portal`);
    expect(info.authInfo.tokenServicesUrl).toBe(
      `${ORIGIN}${cokPrefix}/portal/sharing/rest/generateToken`,
    );
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

  const S123 = `/api/v1/portal-proxy/${APP}/s123`;

  it('proxy serves Survey123 from survey123.arcgis.com without a token or rewrites', async () => {
    const cookie = await signIn();
    // The form reads its portal through the proxy; that URL must come back as is.
    const page = `<script src="assets/js/router.js"></script>${ORIGIN}${PREFIX}/portal /portal/x`;
    fetchMock.mockResolvedValueOnce(
      new Response(page, {
        status: 200,
        headers: { 'content-type': 'text/html' },
      }),
    );
    const res = await request(app.getHttpServer())
      .get(`${S123}/share/abc?portalUrl=x&token=client-supplied`)
      .set('Cookie', cookie)
      .set('Accept-Encoding', 'identity')
      .expect(200);

    expect(issueToken).not.toHaveBeenCalled();
    const [target] = fetchMock.mock.calls[0] as [URL, RequestInit];
    expect(target.origin).toBe('https://survey123.arcgis.com');
    expect(target.pathname).toBe('/share/abc');
    expect(target.searchParams.get('portalUrl')).toBe('x');
    expect(target.searchParams.has('token')).toBe(false);
    expect(res.text).toBe(page);
    expect(res.headers['x-frame-options']).toBe('SAMEORIGIN');
  });

  it('proxy only reads from Survey123 and still needs the session and origin', async () => {
    await request(app.getHttpServer()).get(`${S123}/share/abc`).expect(401);
    const cookie = await signIn();
    await request(app.getHttpServer())
      .post(`${S123}/share/abc`)
      .set('Cookie', cookie)
      .set('Origin', ORIGIN)
      .expect(403);
    await request(app.getHttpServer())
      .get(`${S123}/share/abc`)
      .set('Cookie', cookie)
      .set('Origin', 'https://evil.example')
      .expect(403);
    expect(fetchMock).not.toHaveBeenCalled();
    expect(issueToken).not.toHaveBeenCalled();
  });

  /** GET with the raw bytes as sent (superagent would decompress them). */
  async function rawGet(
    path: string,
    headers: Record<string, string>,
  ): Promise<{ status: number; headers: IncomingHttpHeaders; body: Buffer }> {
    const server = app.getHttpServer() as Server;
    if (!server.listening) {
      await new Promise<void>((resolve) => server.listen(0, resolve));
    }
    const { port } = server.address() as AddressInfo;
    return new Promise((resolve, reject) => {
      httpGet({ host: '127.0.0.1', port, path, headers }, (res) => {
        const chunks: Buffer[] = [];
        res.on('data', (chunk: Buffer) => chunks.push(chunk));
        res.on('end', () =>
          resolve({
            status: res.statusCode ?? 0,
            headers: res.headers,
            body: Buffer.concat(chunks),
          }),
        );
      }).on('error', reject);
    });
  }

  const BUNDLE = `${PREFIX}/portal/apps/dashboards/assets/vendor-f9627cdb61e6c03f68d01f4b39fc0478.js`;
  const bundleSource = () =>
    `var portal="${ORIGIN}/portal";var t="${SERVICE_TOKEN}";` +
    'console.log(1);'.repeat(500);

  it('proxy lets the browser cache static bundles, compresses them and serves repeats from memory', async () => {
    const cookie = await signIn();
    fetchMock.mockResolvedValueOnce(
      new Response(bundleSource(), {
        status: 200,
        headers: {
          'content-type': 'application/javascript',
          'cache-control': 'private',
          etag: '"upstream"',
        },
      }),
    );

    const first = await rawGet(BUNDLE, {
      cookie,
      'accept-encoding': 'gzip, deflate, br',
    });
    expect(first.status).toBe(200);
    expect(first.headers['cache-control']).toBe(
      'private, max-age=31536000, immutable',
    );
    expect(first.headers['content-encoding']).toBe('br');
    expect(first.headers.vary).toContain('Accept-Encoding');
    expect(first.headers.etag).not.toBe('"upstream"');
    const text = brotliDecompressSync(first.body).toString();
    expect(text).toContain(`var portal="${ORIGIN}${PREFIX}/portal"`);
    expect(text).not.toContain(SERVICE_TOKEN);
    expect(first.body.length).toBeLessThan(text.length / 4);

    issueToken.mockClear();
    const again = await rawGet(BUNDLE, { cookie, 'accept-encoding': 'gzip' });
    expect(again.status).toBe(200);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(issueToken).not.toHaveBeenCalled();
    expect(again.headers['content-encoding']).toBe('gzip');
    expect(gunzipSync(again.body).toString()).toBe(text);

    // A cached copy is still only for a signed-in session.
    await request(app.getHttpServer()).get(BUNDLE).expect(401);
  });

  it('proxy keeps portal data uncached but compressed', async () => {
    const cookie = await signIn();
    const json = JSON.stringify({
      url: `${ORIGIN}/portal`,
      pad: 'x'.repeat(4000),
    });
    fetchMock.mockImplementation(() =>
      Promise.resolve(
        new Response(json, {
          status: 200,
          headers: { 'content-type': 'application/json' },
        }),
      ),
    );
    const res = await rawGet(
      `${PREFIX}/portal/sharing/rest/portals/self?f=json`,
      {
        cookie,
        'accept-encoding': 'gzip',
      },
    );
    expect(res.status).toBe(200);
    expect(res.headers['cache-control']).toBe('private, no-store');
    expect(res.headers['content-encoding']).toBe('gzip');
    expect(gunzipSync(res.body).toString()).toContain(
      `"url":"${ORIGIN}${PREFIX}/portal"`,
    );

    await request(app.getHttpServer())
      .get(`${PREFIX}/portal/sharing/rest/portals/self?f=json`)
      .set('Cookie', cookie)
      .expect(200);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('proxy sends bodies uncompressed to clients that do not accept it', async () => {
    const cookie = await signIn();
    fetchMock.mockResolvedValueOnce(
      new Response(bundleSource(), {
        status: 200,
        headers: { 'content-type': 'application/javascript' },
      }),
    );
    const res = await request(app.getHttpServer())
      .get(BUNDLE)
      .set('Cookie', cookie)
      .set('Accept-Encoding', 'identity')
      .expect(200);
    expect(res.headers['content-encoding']).toBeUndefined();
    expect(res.text).toContain(`var portal="${ORIGIN}${PREFIX}/portal"`);
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

  it('lets through only the read-only oauth2 validateAppAccess check', () => {
    const check = 'portal/sharing/rest/oauth2/validateAppAccess';
    expect(isProxyRequestAllowed('GET', check)).toBe(true);
    expect(isProxyRequestAllowed('POST', check)).toBe(false);
    expect(
      isProxyRequestAllowed('GET', 'portal/sharing/rest/oauth2/token'),
    ).toBe(false);
    expect(
      isProxyRequestAllowed(
        'GET',
        'portal/portaladmin/../sharing/rest/oauth2/validateAppAccess',
      ),
    ).toBe(false);
    expect(isProxyRequestAllowed('GET', `${check}/../../generateToken`)).toBe(
      false,
    );
    expect(
      isProxyRequestAllowed('GET', 'portal/sharing/rest/generateToken'),
    ).toBe(false);
  });

  it('allows only GET and HEAD on Survey123', () => {
    expect(isProxyRequestAllowed('GET', 'share/abc', 's123')).toBe(true);
    expect(isProxyRequestAllowed('HEAD', 'share/abc', 's123')).toBe(true);
    expect(isProxyRequestAllowed('POST', 'share/abc', 's123')).toBe(false);
    expect(isProxyRequestAllowed('OPTIONS', 'share/abc', 's123')).toBe(false);
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

  it('makes absolute portal URLs absolute on the app origin, root-relative ones stay relative', () => {
    const app = 'https://app.example';
    const portal = 'https://other-portal.example';
    const absolute = `${app}${PREFIX}`;
    const out = rewritePayload(
      [
        `{"owningSystemUrl":"${portal}/portal"`,
        `"esc":"https:\\/\\/other-portal.example\\/server"`,
        `"enc":"${encodeURIComponent(`${portal}/portal/home`)}"`,
        `"plain":"http://other-portal.example/arcgis"`,
        `"root":"/portal/sharing"`,
        `"done":"${portal}${PREFIX}/portal"}`,
      ].join(','),
      {
        portalOrigin: portal,
        prefix: PREFIX,
        contentType: 'application/json',
        restPath: 'server/rest/info',
        token: null,
        appOrigin: `${app}/`,
      },
    );
    const json = JSON.parse(out) as Record<string, string>;
    expect(json.owningSystemUrl).toBe(`${absolute}/portal`);
    expect(json.esc).toBe(`${absolute}/server`);
    expect(json.enc).toBe(encodeURIComponent(`${absolute}/portal/home`));
    expect(json.plain).toBe(`${absolute}/arcgis`);
    expect(json.root).toBe(`${PREFIX}/portal/sharing`);
    expect(json.done).toBe(`${absolute}/portal`);
  });

  it('leaves StoryMap links on their portal, since a story cannot run under the proxy', () => {
    const story = `${ORIGIN}/portal/apps/storymaps/stories/0ad919ea544d408da446c518ab8da0e8`;
    const out = rewritePayload(
      JSON.stringify({
        staticUrl: story,
        encoded: encodeURIComponent(story),
        dashboard: `${ORIGIN}/portal/apps/dashboards/abc`,
      }),
      {
        portalOrigin: ORIGIN,
        prefix: PREFIX,
        contentType: 'application/json',
        restPath: 'portal/sharing/rest/content/items/x/data',
        token: null,
      },
    );
    const json = JSON.parse(out) as Record<string, string>;
    expect(json.staticUrl).toBe(story);
    expect(json.encoded).toBe(encodeURIComponent(story));
    expect(json.dashboard).toBe(`${PREFIX}/portal/apps/dashboards/abc`);
  });

  it('rewrites root-relative redirects', () => {
    expect(rewriteLocation('/portal/home/', ORIGIN, PREFIX, null)).toBe(
      `${PREFIX}/portal/home/`,
    );
  });
});
