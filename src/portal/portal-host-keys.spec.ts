import {
  collectPortalHostKeysFromConfig,
  isPortalHostKeyFormat,
  normalizePortalHostKey,
} from './portal-host-keys';

describe('portal-host-keys', () => {
  it('normalizes and validates key format', () => {
    expect(normalizePortalHostKey(' GH ')).toBe('gh');
    expect(isPortalHostKeyFormat('gh')).toBe(true);
    expect(isPortalHostKeyFormat('gis-rbc')).toBe(true);
    expect(isPortalHostKeyFormat('Bad')).toBe(false);
    expect(isPortalHostKeyFormat('')).toBe(false);
  });

  it('collects unique portalHostKey values from config', () => {
    const keys = collectPortalHostKeysFromConfig({
      modules: [
        {
          apps: [
            { portalHostKey: 'gh' },
            { portalHostKey: 'RBC' },
            { portalHostKey: 'gh' },
            { kind: 'external', externalUrl: 'https://x' },
          ],
        },
      ],
    });
    expect(keys).toEqual(['gh', 'rbc']);
  });

  it('returns empty for invalid config shapes', () => {
    expect(collectPortalHostKeysFromConfig(null)).toEqual([]);
    expect(collectPortalHostKeysFromConfig({})).toEqual([]);
  });
});
