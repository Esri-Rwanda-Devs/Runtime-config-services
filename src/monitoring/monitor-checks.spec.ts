import {
  ForbiddenException,
  ServiceUnavailableException,
} from '@nestjs/common';
import {
  certificateOutcome,
  checkApp,
  checkItem,
  checkPortal,
  checkService,
  checkTls,
  checkToken,
  type CheckDeps,
} from './monitor-checks';
import type { ItemTarget } from './monitor-targets';

const NOW = Date.parse('2026-10-14T12:00:00Z');

function response(
  status: number,
  body: unknown,
  contentType = 'application/json',
): Response {
  const text = typeof body === 'string' ? body : JSON.stringify(body);
  return new Response(text, {
    status,
    headers: { 'content-type': contentType },
  });
}

type TestDeps = CheckDeps & { advance: (ms: number) => void };

/** Fake clock: a fake fetch can call advance() to simulate a slow response. */
function makeDeps(overrides: Partial<CheckDeps> = {}): TestDeps {
  let clock = NOW;
  return {
    now: () => clock,
    timeoutMs: 10_000,
    referer: 'https://runtime-config-monitor.local',
    appFetch: jest.fn(),
    portalFetch: jest.fn(),
    inspectCertificate: jest.fn(),
    issueToken: jest.fn(),
    pingDatabase: jest.fn().mockResolvedValue(undefined),
    ...overrides,
    advance: (ms: number) => {
      clock += ms;
    },
  };
}

const advance = (deps: TestDeps, ms: number) => deps.advance(ms);

const item: ItemTarget = {
  appKey: 'mining-sites',
  moduleId: 'm1',
  appId: 'dash',
  name: 'Mining Dashboard',
  kind: 'dashboard',
  portalItemId: 'e0ff7e39',
  hostKey: 'gh',
};

describe('checkApp', () => {
  const target = {
    appKey: 'health-mapping',
    label: 'Health',
    url: 'https://h/health-mapping/',
  };

  it('passes on a fast HTML 200', async () => {
    const deps = makeDeps();
    (deps.appFetch as jest.Mock).mockResolvedValue(
      response(200, '<html>', 'text/html'),
    );
    const result = await checkApp(target, deps);
    expect(result).toMatchObject({
      checkType: 'app',
      targetKey: 'health-mapping',
      outcome: 'PASS',
    });
  });

  it('is amber when slower than 3 s', async () => {
    const deps = makeDeps();
    (deps.appFetch as jest.Mock).mockImplementation(() => {
      advance(deps, 4_200);
      return Promise.resolve(
        response(200, '<html>', 'text/html; charset=utf-8'),
      );
    });
    const result = await checkApp(target, deps);
    expect(result.outcome).toBe('WARN');
    expect(result.detail).toBe('Slow response (4.2s)');
  });

  it('fails on non-200 and on non-HTML', async () => {
    const deps = makeDeps();
    (deps.appFetch as jest.Mock).mockResolvedValueOnce(
      response(404, 'nope', 'text/html'),
    );
    expect((await checkApp(target, deps)).detail).toBe('HTTP 404');
    (deps.appFetch as jest.Mock).mockResolvedValueOnce(
      response(200, {}, 'application/json'),
    );
    expect((await checkApp(target, deps)).detail).toMatch(
      /Expected an HTML page/,
    );
  });

  it('describes timeouts and refused connections', async () => {
    const deps = makeDeps();
    const timeout = new Error('aborted');
    timeout.name = 'TimeoutError';
    (deps.appFetch as jest.Mock).mockRejectedValueOnce(timeout);
    expect((await checkApp(target, deps)).detail).toBe('Timed out after 10s');
    (deps.appFetch as jest.Mock).mockRejectedValueOnce(
      Object.assign(new TypeError('fetch failed'), {
        cause: { code: 'ECONNREFUSED' },
      }),
    );
    const refused = await checkApp(target, deps);
    expect(refused).toMatchObject({
      outcome: 'FAIL',
      detail: 'Connection refused',
    });
  });
});

describe('certificates', () => {
  const info = (
    validTo: string,
    authorized = true,
    authorizationError: string | null = null,
  ) => ({
    authorized,
    authorizationError,
    validTo,
    issuer: 'RapidSSL',
  });

  it('flags the expired RBC certificate as a failure', () => {
    expect(
      certificateOutcome(
        info('Oct  8 23:59:59 2026 GMT', false, 'CERT_HAS_EXPIRED'),
        NOW,
      ),
    ).toEqual({
      outcome: 'FAIL',
      detail: 'Certificate expired on 2026-10-08',
      daysLeft: -6,
    });
  });

  it('is amber under 14 days and red under 3 days', () => {
    expect(
      certificateOutcome(info('Oct 24 12:00:00 2026 GMT'), NOW).outcome,
    ).toBe('WARN');
    expect(
      certificateOutcome(info('Oct 16 12:00:00 2026 GMT'), NOW).outcome,
    ).toBe('FAIL');
    expect(certificateOutcome(info('Dec 31 12:00:00 2026 GMT'), NOW)).toEqual({
      outcome: 'PASS',
      detail: null,
      daysLeft: 78,
    });
  });

  it('fails an untrusted certificate even when it is in date', () => {
    expect(
      certificateOutcome(
        info('Dec 31 12:00:00 2026 GMT', false, 'SELF_SIGNED_CERT_IN_CHAIN'),
        NOW,
      ),
    ).toMatchObject({
      outcome: 'FAIL',
      detail: 'Certificate not trusted: SELF_SIGNED_CERT_IN_CHAIN',
    });
  });

  it('checkTls records expiry details and who uses the host', async () => {
    const deps = makeDeps({
      inspectCertificate: jest
        .fn()
        .mockResolvedValue(info('Nov 13 12:00:00 2026 GMT')),
    });
    const result = await checkTls(
      { host: 'ewis.minema.gov.rw', port: 443, usedBy: ['portal:ewis'] },
      deps,
    );
    expect(result).toMatchObject({
      checkType: 'tls',
      targetKey: 'ewis.minema.gov.rw',
      outcome: 'PASS',
      meta: {
        daysLeft: 30,
        usedBy: ['portal:ewis'],
        validTo: '2026-11-13T12:00:00.000Z',
      },
    });
  });
});

describe('checkPortal', () => {
  const target = {
    hostKey: 'gh',
    label: 'GeoHub',
    portalUrl: 'https://gh.space.gov.rw/portal',
  };

  it('passes when /sharing/rest answers JSON without an error', async () => {
    const deps = makeDeps();
    (deps.portalFetch as jest.Mock).mockResolvedValue(
      response(200, { currentVersion: '2024.1' }),
    );
    const result = await checkPortal(target, deps);
    expect(deps.portalFetch).toHaveBeenCalledWith(
      'https://gh.space.gov.rw/portal/sharing/rest?f=json',
      expect.objectContaining({ method: 'GET' }),
    );
    expect(result).toMatchObject({
      outcome: 'PASS',
      meta: { currentVersion: '2024.1' },
    });
  });

  it('fails on an error inside an HTTP 200 body', async () => {
    const deps = makeDeps();
    (deps.portalFetch as jest.Mock).mockResolvedValue(
      response(200, { error: { code: 500, message: 'Portal is down' } }),
    );
    expect(await checkPortal(target, deps)).toMatchObject({
      outcome: 'FAIL',
      detail: '500 Portal is down',
    });
  });
});

describe('checkToken', () => {
  const target = { appKey: 'health-mapping', hostKey: 'rbc' };

  it('uses the broker and hands the token back without putting it in the result', async () => {
    const deps = makeDeps({
      issueToken: jest
        .fn()
        .mockResolvedValue({ token: 'tok-123456789', portalUrl: 'https://p' }),
    });
    const { result, issued } = await checkToken(target, deps);
    expect(deps.issueToken).toHaveBeenCalledWith({
      appKey: 'health-mapping',
      portalHostKey: 'rbc',
      origin: 'https://runtime-config-monitor.local',
    });
    expect(issued?.token).toBe('tok-123456789');
    expect(JSON.stringify(result)).not.toContain('tok-123456789');
    expect(result.outcome).toBe('PASS');
  });

  it('reports broker refusals with the broker message', async () => {
    const deps = makeDeps({
      issueToken: jest
        .fn()
        .mockRejectedValueOnce(
          new ServiceUnavailableException('Unable to reach ArcGIS Portal'),
        )
        .mockRejectedValueOnce(
          new ForbiddenException('Portal host is not available'),
        ),
    });
    expect((await checkToken(target, deps)).result).toMatchObject({
      outcome: 'FAIL',
      detail: 'Unable to reach ArcGIS Portal',
    });
    const refused = await checkToken(target, deps);
    expect(refused.issued).toBeNull();
    expect(refused.result.detail).toBe('Portal host is not available');
  });
});

describe('checkItem', () => {
  const issued = {
    token: 'tok-abcdefgh123',
    portalUrl: 'https://gh.space.gov.rw/portal',
  };

  it('sends the token in a header, never in the URL', async () => {
    const deps = makeDeps();
    (deps.portalFetch as jest.Mock).mockResolvedValue(
      response(200, {
        id: 'e0ff7e39',
        title: 'Mining',
        type: 'Dashboard',
        access: 'org',
      }),
    );
    const result = await checkItem(item, issued, deps);
    const [url, init] = (deps.portalFetch as jest.Mock).mock.calls[0] as [
      string,
      RequestInit,
    ];
    expect(url).toBe(
      'https://gh.space.gov.rw/portal/sharing/rest/content/items/e0ff7e39?f=json',
    );
    expect(url).not.toContain('tok-');
    expect(init.headers).toMatchObject({
      'X-Esri-Authorization': 'Bearer tok-abcdefgh123',
      Referer: 'https://runtime-config-monitor.local',
    });
    expect(result).toMatchObject({
      outcome: 'PASS',
      targetKey: 'mining-sites/m1/dash',
      meta: { title: 'Mining', itemType: 'Dashboard', access: 'org' },
    });
  });

  it('fails on the 403 GWM_0003 that portals return with HTTP 200', async () => {
    const deps = makeDeps();
    (deps.portalFetch as jest.Mock).mockResolvedValue(
      response(200, {
        error: {
          code: 403,
          messageCode: 'GWM_0003',
          message:
            'You do not have permissions to access this resource or perform this operation.',
        },
      }),
    );
    expect(await checkItem(item, issued, deps)).toMatchObject({
      outcome: 'FAIL',
      detail:
        '403 GWM_0003 You do not have permissions to access this resource or perform this operation.',
    });
  });

  it('warns when the item type does not match the configured kind', async () => {
    const deps = makeDeps();
    (deps.portalFetch as jest.Mock).mockResolvedValue(
      response(200, { id: 'x', type: 'Dashboard' }),
    );
    const result = await checkItem(
      { ...item, kind: 'experience' },
      issued,
      deps,
    );
    expect(result).toMatchObject({
      outcome: 'WARN',
      detail: 'Configured as experience but the item is a Dashboard',
    });
  });

  it('skips items without a host or without a token', async () => {
    const deps = makeDeps();
    expect(
      (await checkItem({ ...item, hostKey: null }, issued, deps)).outcome,
    ).toBe('SKIP');
    const noToken = await checkItem(item, null, deps);
    expect(noToken).toMatchObject({
      outcome: 'SKIP',
      detail: 'Not checked: no gh token (see token issuance)',
    });
    expect(deps.portalFetch).not.toHaveBeenCalled();
  });
});

describe('checkService', () => {
  it('fails when the database cannot be reached', async () => {
    const deps = makeDeps({
      pingDatabase: jest.fn().mockRejectedValue(new Error('ECONN')),
    });
    expect(await checkService(deps)).toMatchObject({
      checkType: 'service',
      outcome: 'FAIL',
      detail: 'Database unreachable: ECONN',
    });
  });
});
