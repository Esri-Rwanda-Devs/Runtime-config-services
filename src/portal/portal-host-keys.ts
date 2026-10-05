/**
 * Collect portalHostKey values referenced by an Application Runtime Config document.
 * Non-secret routing metadata only.
 */
export function collectPortalHostKeysFromConfig(config: unknown): string[] {
  if (!config || typeof config !== 'object' || Array.isArray(config)) {
    return [];
  }

  const modules = (config as { modules?: unknown }).modules;
  if (!Array.isArray(modules)) {
    return [];
  }

  const keys = new Set<string>();
  for (const mod of modules) {
    if (!mod || typeof mod !== 'object' || Array.isArray(mod)) continue;
    const apps = (mod as { apps?: unknown }).apps;
    if (!Array.isArray(apps)) continue;
    for (const app of apps) {
      if (!app || typeof app !== 'object' || Array.isArray(app)) continue;
      const raw = (app as { portalHostKey?: unknown }).portalHostKey;
      if (typeof raw !== 'string') continue;
      const key = raw.trim().toLowerCase();
      if (isPortalHostKeyFormat(key)) {
        keys.add(key);
      }
    }
  }

  return [...keys].sort();
}

export const PORTAL_HOST_KEY_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

export function isPortalHostKeyFormat(value: string): boolean {
  return PORTAL_HOST_KEY_PATTERN.test(value);
}

export function normalizePortalHostKey(value: string): string {
  return value.trim().toLowerCase();
}
