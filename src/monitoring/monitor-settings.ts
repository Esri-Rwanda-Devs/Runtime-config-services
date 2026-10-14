/** Status monitor settings, read from the environment. */
export type MonitorAppUrl = { appKey: string; url: string };

export type MonitorSettings = {
  /** Scheduled runs only; a manual run works either way. */
  enabled: boolean;
  intervalMs: number;
  appUrls: MonitorAppUrl[];
  /** Why MONITOR_APP_URLS was ignored, when it was. */
  appUrlsError: string | null;
  /** Referer the monitor's portal tokens are bound to. */
  referer: string;
  concurrency: number;
  timeoutMs: number;
  retentionDays: number;
};

export const DEFAULT_INTERVAL_MS = 5 * 60_000;
export const MIN_INTERVAL_MS = 60_000;
export const DEFAULT_REFERER = 'https://runtime-config-monitor.local';

type EnvReader = (key: string) => string | undefined;

function intIn(
  raw: string | undefined,
  fallback: number,
  min: number,
  max: number,
): number {
  if (!raw?.trim()) return fallback;
  const parsed = Number.parseInt(raw, 10);
  if (!Number.isFinite(parsed) || parsed < min || parsed > max) {
    return fallback;
  }
  return parsed;
}

function httpUrl(raw: string): string | null {
  try {
    const url = new URL(raw.trim());
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return null;
    return url.toString();
  } catch {
    return null;
  }
}

/** MONITOR_APP_URLS is a JSON object: { "<appKey>": "<base URL>" }. */
export function parseAppUrls(raw: string | undefined): {
  appUrls: MonitorAppUrl[];
  error: string | null;
} {
  if (!raw?.trim()) return { appUrls: [], error: null };
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return { appUrls: [], error: 'MONITOR_APP_URLS is not valid JSON' };
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    return {
      appUrls: [],
      error: 'MONITOR_APP_URLS must be a JSON object of appKey to URL',
    };
  }
  const appUrls: MonitorAppUrl[] = [];
  for (const [appKey, value] of Object.entries(parsed)) {
    const url = typeof value === 'string' ? httpUrl(value) : null;
    if (!url) {
      return {
        appUrls: [],
        error: `MONITOR_APP_URLS has an invalid URL for "${appKey}"`,
      };
    }
    appUrls.push({ appKey, url });
  }
  appUrls.sort((a, b) => a.appKey.localeCompare(b.appKey));
  return { appUrls, error: null };
}

export function readMonitorSettings(get: EnvReader): MonitorSettings {
  const { appUrls, error } = parseAppUrls(get('MONITOR_APP_URLS'));
  return {
    enabled: get('MONITOR_ENABLED')?.trim().toLowerCase() === 'true',
    intervalMs: intIn(
      get('MONITOR_INTERVAL_MS'),
      DEFAULT_INTERVAL_MS,
      MIN_INTERVAL_MS,
      24 * 60 * 60_000,
    ),
    appUrls,
    appUrlsError: error,
    referer: httpUrl(get('MONITOR_REFERER') ?? '')
      ? new URL(get('MONITOR_REFERER')!.trim()).origin
      : DEFAULT_REFERER,
    concurrency: intIn(get('MONITOR_CONCURRENCY'), 6, 1, 32),
    timeoutMs: intIn(get('MONITOR_TIMEOUT_MS'), 10_000, 1_000, 60_000),
    retentionDays: intIn(get('MONITOR_RETENTION_DAYS'), 30, 1, 365),
  };
}
