import {
  buildMonitorTargets,
  collectPortalItems,
  isLoopbackHost,
} from './monitor-targets';

const healthConfig = {
  modules: [
    {
      id: 'surveillance',
      name: 'Surveillance',
      apps: [
        {
          id: 'emergency',
          name: 'Emergency Response',
          kind: 'dashboard',
          portalItemId: 'a1',
          portalHostKey: 'RBC',
        },
        {
          id: 'stunting',
          name: 'Stunting',
          kind: 'dashboard',
          portalItemId: 'a2',
          portalHostKey: 'gh2',
        },
        {
          id: 'legacy',
          name: 'Legacy',
          kind: 'experience',
          portalItemId: 'a3',
        },
        {
          id: 'site',
          name: 'Site',
          kind: 'external',
          url: 'https://example.com',
        },
        {
          id: 'shell',
          name: 'Shell',
          kind: 'localShell',
          localShellPath: '/x',
        },
      ],
    },
  ],
};

describe('monitor targets', () => {
  it('collects only portal items, keeping items without a host as unmonitored', () => {
    const items = collectPortalItems('health-mapping', healthConfig);
    expect(items.map((i) => [i.appId, i.hostKey])).toEqual([
      ['emergency', 'rbc'],
      ['stunting', 'gh2'],
      ['legacy', null],
    ]);
  });

  it('builds targets from active apps and credentials only', () => {
    const targets = buildMonitorTargets({
      applications: [
        {
          key: 'health-mapping',
          name: 'Health',
          isActive: true,
          config: healthConfig,
        },
        { key: 'old-app', name: 'Old', isActive: false, config: healthConfig },
      ],
      credentials: [
        {
          key: 'rbc',
          name: 'RBC',
          portalUrl: 'https://gis.rbc.gov.rw/portal/',
          isActive: true,
        },
        {
          key: 'gh2',
          name: 'GeoHub 2',
          portalUrl: 'https://gh.space.gov.rw/portal',
          isActive: true,
        },
        {
          key: 'gh',
          name: 'GeoHub',
          portalUrl: 'https://gh.space.gov.rw/portal',
          isActive: true,
        },
        {
          key: 'off',
          name: 'Off',
          portalUrl: 'https://off.example.com/portal',
          isActive: false,
        },
      ],
      appUrls: [
        {
          appKey: 'health-mapping',
          url: 'https://localhost:5175/health-mapping/',
        },
        { appKey: 'not-in-db', url: 'https://gh.space.gov.rw/not-in-db/' },
      ],
    });

    expect(targets.apps).toEqual([
      {
        appKey: 'health-mapping',
        label: 'Health',
        url: 'https://localhost:5175/health-mapping/',
      },
      {
        appKey: 'not-in-db',
        label: 'not-in-db',
        url: 'https://gh.space.gov.rw/not-in-db/',
      },
    ]);
    expect(targets.portals.map((p) => [p.hostKey, p.portalUrl])).toEqual([
      ['gh', 'https://gh.space.gov.rw/portal'],
      ['gh2', 'https://gh.space.gov.rw/portal'],
      ['rbc', 'https://gis.rbc.gov.rw/portal'],
    ]);
    // One certificate check per host; loopback app hosts get none.
    expect(targets.tls).toEqual([
      {
        host: 'gh.space.gov.rw',
        port: 443,
        usedBy: ['portal:gh', 'portal:gh2', 'app:not-in-db'],
      },
      { host: 'gis.rbc.gov.rw', port: 443, usedBy: ['portal:rbc'] },
    ]);
    expect(targets.tokens).toEqual([
      { appKey: 'health-mapping', hostKey: 'gh2' },
      { appKey: 'health-mapping', hostKey: 'rbc' },
    ]);
    expect(targets.items).toHaveLength(3);
    expect(targets.items.every((i) => i.appKey === 'health-mapping')).toBe(
      true,
    );
  });

  it('recognises loopback hosts', () => {
    expect(isLoopbackHost('localhost')).toBe(true);
    expect(isLoopbackHost('127.0.0.1')).toBe(true);
    expect(isLoopbackHost('[::1]')).toBe(true);
    expect(isLoopbackHost('gh.space.gov.rw')).toBe(false);
  });
});
