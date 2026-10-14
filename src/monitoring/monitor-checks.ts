import { HttpException } from '@nestjs/common';
import type { CertificateInfo } from './tls-probe';
import type {
  AppTarget,
  ItemTarget,
  PortalTarget,
  TlsTarget,
  TokenTarget,
} from './monitor-targets';

export type MonitorOutcomeValue = 'PASS' | 'WARN' | 'FAIL' | 'SKIP';

export const CHECK_TYPES = [
  'service',
  'app',
  'tls',
  'portal',
  'token',
  'item',
] as const;
export type CheckType = (typeof CHECK_TYPES)[number];

export type CheckResult = {
  checkType: CheckType;
  targetKey: string;
  targetLabel: string;
  outcome: MonitorOutcomeValue;
  latencyMs: number | null;
  detail: string | null;
  meta: Record<string, unknown> | null;
};

export type IssuedToken = { token: string; portalUrl: string };

export type CheckDeps = {
  now: () => number;
  timeoutMs: number;
  referer: string;
  appFetch: (url: string, init: RequestInit) => Promise<Response>;
  portalFetch: (url: string, init: RequestInit) => Promise<Response>;
  inspectCertificate: (
    host: string,
    port: number,
    timeoutMs: number,
  ) => Promise<CertificateInfo>;
  issueToken: (input: {
    appKey: string;
    portalHostKey: string;
    origin: string;
  }) => Promise<IssuedToken>;
  pingDatabase: () => Promise<void>;
};

/** Failures needed in a row before a check shows red (and alerts). */
export const RED_AFTER_FAILURES = 2;

/** Responses slower than this are amber. */
export const SLOW_MS = 3_000;
export const CERT_WARN_DAYS = 14;
export const CERT_FAIL_DAYS = 3;
const DAY_MS = 24 * 60 * 60_000;
const MAX_JSON_BYTES = 512 * 1024;

/** Configured kind → ArcGIS item type it should point at. */
const EXPECTED_ITEM_TYPES: Record<string, string> = {
  dashboard: 'Dashboard',
  experience: 'Web Experience',
  survey123: 'Form',
};

export function describeError(error: unknown, timeoutMs: number): string {
  if (error instanceof HttpException) return error.message;
  if (error instanceof Error) {
    if (error.name === 'TimeoutError' || error.name === 'AbortError') {
      return `Timed out after ${Math.round(timeoutMs / 1000)}s`;
    }
    const cause = (error as { cause?: { code?: unknown; message?: unknown } })
      .cause;
    const ownCode = (error as { code?: unknown }).code;
    const code =
      typeof cause?.code === 'string'
        ? cause.code
        : typeof ownCode === 'string'
          ? ownCode
          : null;
    if (code === 'ENOTFOUND' || code === 'EAI_AGAIN') {
      return `DNS lookup failed (${code})`;
    }
    if (code === 'ECONNREFUSED') return 'Connection refused';
    if (code === 'ECONNRESET') return 'Connection reset';
    if (code) return `${error.message} (${code})`;
    return error.message;
  }
  return 'Unknown error';
}

function speed(latencyMs: number): MonitorOutcomeValue {
  return latencyMs >= SLOW_MS ? 'WARN' : 'PASS';
}

function slowNote(latencyMs: number): string | null {
  return latencyMs >= SLOW_MS
    ? `Slow response (${(latencyMs / 1000).toFixed(1)}s)`
    : null;
}

async function readJson(response: Response): Promise<unknown> {
  const text = await response.text();
  if (text.length > MAX_JSON_BYTES) throw new Error('Response too large');
  return JSON.parse(text) as unknown;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

/**
 * ArcGIS often answers errors with HTTP 200 and `{ error: { code, message } }`
 * in the body, so the body decides, not the status code.
 */
export function arcgisBodyError(body: unknown): string | null {
  const error = asRecord(asRecord(body)?.error);
  if (!error) return null;
  const parts = [
    typeof error.code === 'number' || typeof error.code === 'string'
      ? String(error.code)
      : null,
    typeof error.messageCode === 'string' ? error.messageCode : null,
    typeof error.message === 'string' ? error.message : null,
  ].filter(Boolean);
  return parts.length > 0 ? parts.join(' ') : 'Portal returned an error';
}

export async function checkService(deps: CheckDeps): Promise<CheckResult> {
  const started = deps.now();
  const base = {
    checkType: 'service' as const,
    targetKey: 'runtime-config',
    targetLabel: 'Runtime Config database',
    meta: null,
  };
  try {
    await deps.pingDatabase();
    const latencyMs = deps.now() - started;
    return {
      ...base,
      outcome: speed(latencyMs),
      latencyMs,
      detail: slowNote(latencyMs),
    };
  } catch (error) {
    return {
      ...base,
      outcome: 'FAIL',
      latencyMs: deps.now() - started,
      detail: `Database unreachable: ${describeError(error, deps.timeoutMs)}`,
    };
  }
}

export async function checkApp(
  target: AppTarget,
  deps: CheckDeps,
): Promise<CheckResult> {
  const started = deps.now();
  const base = {
    checkType: 'app' as const,
    targetKey: target.appKey,
    targetLabel: target.label,
    meta: { url: target.url },
  };
  try {
    const response = await deps.appFetch(target.url, {
      method: 'GET',
      redirect: 'follow',
      headers: { Accept: 'text/html' },
      signal: AbortSignal.timeout(deps.timeoutMs),
    });
    const latencyMs = deps.now() - started;
    const contentType = response.headers.get('content-type') ?? '';
    await response.body?.cancel().catch(() => undefined);
    if (response.status !== 200) {
      return {
        ...base,
        outcome: 'FAIL',
        latencyMs,
        detail: `HTTP ${response.status}`,
      };
    }
    if (!contentType.includes('text/html')) {
      return {
        ...base,
        outcome: 'FAIL',
        latencyMs,
        detail: `Expected an HTML page, got ${contentType || 'no content type'}`,
      };
    }
    return {
      ...base,
      outcome: speed(latencyMs),
      latencyMs,
      detail: slowNote(latencyMs),
    };
  } catch (error) {
    return {
      ...base,
      outcome: 'FAIL',
      latencyMs: deps.now() - started,
      detail: describeError(error, deps.timeoutMs),
    };
  }
}

export function certificateOutcome(
  info: CertificateInfo,
  now: number,
): {
  outcome: MonitorOutcomeValue;
  detail: string | null;
  daysLeft: number | null;
} {
  const validToMs = info.validTo ? Date.parse(info.validTo) : Number.NaN;
  const daysLeft = Number.isFinite(validToMs)
    ? Math.floor((validToMs - now) / DAY_MS)
    : null;
  const expiry = Number.isFinite(validToMs)
    ? new Date(validToMs).toISOString().slice(0, 10)
    : 'unknown date';

  if (
    info.authorizationError === 'CERT_HAS_EXPIRED' ||
    (daysLeft !== null && daysLeft < 0)
  ) {
    return {
      outcome: 'FAIL',
      detail: `Certificate expired on ${expiry}`,
      daysLeft,
    };
  }
  if (!info.authorized) {
    return {
      outcome: 'FAIL',
      detail: `Certificate not trusted: ${info.authorizationError ?? 'unknown reason'}`,
      daysLeft,
    };
  }
  if (daysLeft === null) {
    return {
      outcome: 'WARN',
      detail: 'Certificate expiry date unreadable',
      daysLeft,
    };
  }
  if (daysLeft < CERT_FAIL_DAYS) {
    return {
      outcome: 'FAIL',
      detail: `Certificate expires ${expiry} (${daysLeft} days left)`,
      daysLeft,
    };
  }
  if (daysLeft < CERT_WARN_DAYS) {
    return {
      outcome: 'WARN',
      detail: `Certificate expires ${expiry} (${daysLeft} days left)`,
      daysLeft,
    };
  }
  return { outcome: 'PASS', detail: null, daysLeft };
}

export async function checkTls(
  target: TlsTarget,
  deps: CheckDeps,
): Promise<CheckResult> {
  const started = deps.now();
  const targetKey =
    target.port === 443 ? target.host : `${target.host}:${target.port}`;
  const base = {
    checkType: 'tls' as const,
    targetKey,
    targetLabel: targetKey,
  };
  try {
    const info = await deps.inspectCertificate(
      target.host,
      target.port,
      deps.timeoutMs,
    );
    const latencyMs = deps.now() - started;
    const result = certificateOutcome(info, deps.now());
    return {
      ...base,
      outcome: result.outcome,
      latencyMs,
      detail: result.detail,
      meta: {
        validTo: info.validTo
          ? new Date(Date.parse(info.validTo)).toISOString()
          : null,
        daysLeft: result.daysLeft,
        issuer: info.issuer,
        usedBy: target.usedBy,
      },
    };
  } catch (error) {
    return {
      ...base,
      outcome: 'FAIL',
      latencyMs: deps.now() - started,
      detail: describeError(error, deps.timeoutMs),
      meta: { usedBy: target.usedBy },
    };
  }
}

export async function checkPortal(
  target: PortalTarget,
  deps: CheckDeps,
): Promise<CheckResult> {
  const started = deps.now();
  const base = {
    checkType: 'portal' as const,
    targetKey: target.hostKey,
    targetLabel: target.label,
  };
  const meta: Record<string, unknown> = { portalUrl: target.portalUrl };
  try {
    const response = await deps.portalFetch(
      `${target.portalUrl}/sharing/rest?f=json`,
      {
        method: 'GET',
        headers: { Accept: 'application/json' },
        signal: AbortSignal.timeout(deps.timeoutMs),
      },
    );
    const latencyMs = deps.now() - started;
    if (response.status !== 200) {
      await response.body?.cancel().catch(() => undefined);
      return {
        ...base,
        outcome: 'FAIL',
        latencyMs,
        detail: `HTTP ${response.status}`,
        meta,
      };
    }
    let body: unknown;
    try {
      body = await readJson(response);
    } catch {
      return {
        ...base,
        outcome: 'FAIL',
        latencyMs,
        detail: 'Portal did not return JSON',
        meta,
      };
    }
    const bodyError = arcgisBodyError(body);
    if (bodyError) {
      return { ...base, outcome: 'FAIL', latencyMs, detail: bodyError, meta };
    }
    const version = asRecord(body)?.currentVersion;
    if (typeof version === 'string' || typeof version === 'number') {
      meta.currentVersion = String(version);
    }
    return {
      ...base,
      outcome: speed(latencyMs),
      latencyMs,
      detail: slowNote(latencyMs),
      meta,
    };
  } catch (error) {
    return {
      ...base,
      outcome: 'FAIL',
      latencyMs: deps.now() - started,
      detail: describeError(error, deps.timeoutMs),
      meta,
    };
  }
}

/**
 * Runs the real broker logic (application active, host referenced by config,
 * active credential, portal sign-in). The token is returned to the caller for
 * item checks and never stored.
 */
export async function checkToken(
  target: TokenTarget,
  deps: CheckDeps,
): Promise<{ result: CheckResult; issued: IssuedToken | null }> {
  const started = deps.now();
  const base = {
    checkType: 'token' as const,
    targetKey: `${target.appKey}/${target.hostKey}`,
    targetLabel: `${target.appKey} → ${target.hostKey}`,
    meta: { appKey: target.appKey, hostKey: target.hostKey },
  };
  try {
    const issued = await deps.issueToken({
      appKey: target.appKey,
      portalHostKey: target.hostKey,
      origin: deps.referer,
    });
    const latencyMs = deps.now() - started;
    return {
      result: {
        ...base,
        outcome: speed(latencyMs),
        latencyMs,
        detail: slowNote(latencyMs),
      },
      issued,
    };
  } catch (error) {
    return {
      result: {
        ...base,
        outcome: 'FAIL',
        latencyMs: deps.now() - started,
        detail: describeError(error, deps.timeoutMs),
      },
      issued: null,
    };
  }
}

export async function checkItem(
  target: ItemTarget,
  issued: IssuedToken | null | undefined,
  deps: CheckDeps,
): Promise<CheckResult> {
  const base = {
    checkType: 'item' as const,
    targetKey: `${target.appKey}/${target.moduleId}/${target.appId}`,
    targetLabel: target.name,
  };
  const meta: Record<string, unknown> = {
    appKey: target.appKey,
    moduleId: target.moduleId,
    appId: target.appId,
    kind: target.kind,
    portalItemId: target.portalItemId,
    hostKey: target.hostKey,
  };
  if (!target.hostKey) {
    return {
      ...base,
      outcome: 'SKIP',
      latencyMs: null,
      detail: 'Not monitored: no portalHostKey in the config',
      meta,
    };
  }
  if (!issued) {
    return {
      ...base,
      outcome: 'SKIP',
      latencyMs: null,
      detail: `Not checked: no ${target.hostKey} token (see token issuance)`,
      meta,
    };
  }

  const started = deps.now();
  const url = `${issued.portalUrl}/sharing/rest/content/items/${encodeURIComponent(target.portalItemId)}?f=json`;
  try {
    const response = await deps.portalFetch(url, {
      method: 'GET',
      headers: {
        Accept: 'application/json',
        Referer: deps.referer,
        'X-Esri-Authorization': `Bearer ${issued.token}`,
      },
      signal: AbortSignal.timeout(deps.timeoutMs),
    });
    const latencyMs = deps.now() - started;
    if (response.status !== 200) {
      await response.body?.cancel().catch(() => undefined);
      return {
        ...base,
        outcome: 'FAIL',
        latencyMs,
        detail: `HTTP ${response.status}`,
        meta,
      };
    }
    let body: unknown;
    try {
      body = await readJson(response);
    } catch {
      return {
        ...base,
        outcome: 'FAIL',
        latencyMs,
        detail: 'Portal did not return JSON',
        meta,
      };
    }
    const bodyError = arcgisBodyError(body);
    if (bodyError) {
      return { ...base, outcome: 'FAIL', latencyMs, detail: bodyError, meta };
    }
    const record = asRecord(body);
    const itemType = typeof record?.type === 'string' ? record.type : null;
    if (typeof record?.title === 'string') meta.title = record.title;
    if (itemType) meta.itemType = itemType;
    if (typeof record?.access === 'string') meta.access = record.access;

    const expected = EXPECTED_ITEM_TYPES[target.kind];
    if (expected && itemType && itemType !== expected) {
      return {
        ...base,
        outcome: 'WARN',
        latencyMs,
        detail: `Configured as ${target.kind} but the item is a ${itemType}`,
        meta,
      };
    }
    return {
      ...base,
      outcome: speed(latencyMs),
      latencyMs,
      detail: slowNote(latencyMs),
      meta,
    };
  } catch (error) {
    return {
      ...base,
      outcome: 'FAIL',
      latencyMs: deps.now() - started,
      detail: describeError(error, deps.timeoutMs),
      meta,
    };
  }
}
