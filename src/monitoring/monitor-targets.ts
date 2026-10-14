import { normalizePortalUrl } from '../portal/arcgis-portal.client';
import {
  collectPortalHostKeysFromConfig,
  isPortalHostKeyFormat,
  normalizePortalHostKey,
} from '../portal/portal-host-keys';
import type { MonitorAppUrl } from './monitor-settings';

export type MonitorApplication = {
  key: string;
  name: string;
  isActive: boolean;
  config: unknown;
};

export type MonitorCredential = {
  key: string;
  name: string;
  portalUrl: string;
  isActive: boolean;
};

export type AppTarget = { appKey: string; label: string; url: string };
export type PortalTarget = {
  hostKey: string;
  label: string;
  portalUrl: string;
};
export type TlsTarget = { host: string; port: number; usedBy: string[] };
export type TokenTarget = { appKey: string; hostKey: string };
export type ItemTarget = {
  appKey: string;
  moduleId: string;
  appId: string;
  name: string;
  kind: string;
  portalItemId: string;
  hostKey: string | null;
};

export type MonitorTargets = {
  apps: AppTarget[];
  portals: PortalTarget[];
  tls: TlsTarget[];
  tokens: TokenTarget[];
  items: ItemTarget[];
};

const PORTAL_ITEM_KINDS = new Set(['experience', 'dashboard', 'survey123']);

export function isLoopbackHost(hostname: string): boolean {
  const host = hostname.toLowerCase().replace(/^\[|\]$/g, '');
  return host === 'localhost' || host === '::1' || host.startsWith('127.');
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function str(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

/** Portal items (dashboard / experience / survey123) configured for one app. */
export function collectPortalItems(
  appKey: string,
  config: unknown,
): ItemTarget[] {
  const modules = asRecord(config)?.modules;
  if (!Array.isArray(modules)) return [];
  const items: ItemTarget[] = [];
  for (const mod of modules) {
    const modRecord = asRecord(mod);
    const apps = modRecord?.apps;
    if (!Array.isArray(apps)) continue;
    for (const app of apps) {
      const appRecord = asRecord(app);
      if (!appRecord) continue;
      const kind = str(appRecord.kind);
      const portalItemId = str(appRecord.portalItemId);
      if (!PORTAL_ITEM_KINDS.has(kind) || !portalItemId) continue;
      const rawHost = normalizePortalHostKey(str(appRecord.portalHostKey));
      items.push({
        appKey,
        moduleId: str(modRecord?.id),
        appId: str(appRecord.id),
        name: str(appRecord.name) || portalItemId,
        kind,
        portalItemId,
        hostKey: rawHost && isPortalHostKeyFormat(rawHost) ? rawHost : null,
      });
    }
  }
  return items;
}

/**
 * Everything one monitor run checks. Inactive applications and inactive
 * portal credentials are left out: they are switched off on purpose.
 */
export function buildMonitorTargets(input: {
  applications: MonitorApplication[];
  credentials: MonitorCredential[];
  appUrls: MonitorAppUrl[];
}): MonitorTargets {
  const activeApps = input.applications
    .filter((app) => app.isActive)
    .sort((a, b) => a.key.localeCompare(b.key));
  const names = new Map(input.applications.map((app) => [app.key, app.name]));

  const apps: AppTarget[] = input.appUrls.map(({ appKey, url }) => ({
    appKey,
    label: names.get(appKey) ?? appKey,
    url,
  }));

  const portals: PortalTarget[] = [];
  for (const credential of input.credentials) {
    if (!credential.isActive) continue;
    let portalUrl: string;
    try {
      portalUrl = normalizePortalUrl(credential.portalUrl);
    } catch {
      continue;
    }
    portals.push({
      hostKey: credential.key,
      label: credential.name,
      portalUrl,
    });
  }
  portals.sort((a, b) => a.hostKey.localeCompare(b.hostKey));

  const tlsByHost = new Map<string, TlsTarget>();
  const addTls = (rawUrl: string, usedBy: string) => {
    let url: URL;
    try {
      url = new URL(rawUrl);
    } catch {
      return;
    }
    if (url.protocol !== 'https:' || isLoopbackHost(url.hostname)) return;
    const port = url.port ? Number(url.port) : 443;
    const id = `${url.hostname.toLowerCase()}:${port}`;
    const entry = tlsByHost.get(id) ?? {
      host: url.hostname.toLowerCase(),
      port,
      usedBy: [],
    };
    if (!entry.usedBy.includes(usedBy)) entry.usedBy.push(usedBy);
    tlsByHost.set(id, entry);
  };
  for (const portal of portals)
    addTls(portal.portalUrl, `portal:${portal.hostKey}`);
  for (const app of apps) addTls(app.url, `app:${app.appKey}`);

  const tokens: TokenTarget[] = [];
  const items: ItemTarget[] = [];
  for (const app of activeApps) {
    for (const hostKey of collectPortalHostKeysFromConfig(app.config)) {
      tokens.push({ appKey: app.key, hostKey });
    }
    items.push(...collectPortalItems(app.key, app.config));
  }

  return {
    apps,
    portals,
    tls: [...tlsByHost.values()].sort((a, b) => a.host.localeCompare(b.host)),
    tokens,
    items,
  };
}
