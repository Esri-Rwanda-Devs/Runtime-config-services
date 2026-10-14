import {
  DEFAULT_INTERVAL_MS,
  DEFAULT_REFERER,
  parseAppUrls,
  readMonitorSettings,
} from './monitor-settings';

describe('monitor settings', () => {
  const env = (values: Record<string, string>) => (key: string) => values[key];

  it('defaults to disabled with a 5 minute interval', () => {
    const settings = readMonitorSettings(env({}));
    expect(settings.enabled).toBe(false);
    expect(settings.intervalMs).toBe(DEFAULT_INTERVAL_MS);
    expect(settings.appUrls).toEqual([]);
    expect(settings.appUrlsError).toBeNull();
    expect(settings.referer).toBe(DEFAULT_REFERER);
    expect(settings.concurrency).toBe(6);
    expect(settings.retentionDays).toBe(30);
  });

  it('rejects intervals under one minute', () => {
    expect(
      readMonitorSettings(env({ MONITOR_INTERVAL_MS: '1000' })).intervalMs,
    ).toBe(DEFAULT_INTERVAL_MS);
    expect(
      readMonitorSettings(env({ MONITOR_INTERVAL_MS: '120000' })).intervalMs,
    ).toBe(120_000);
  });

  it('parses MONITOR_APP_URLS sorted by key', () => {
    expect(
      parseAppUrls(
        '{"water-resources":"https://localhost:5184/water-resources/","agriculture-livestock":"http://gh.space.gov.rw/agriculture-livestock/"}',
      ),
    ).toEqual({
      appUrls: [
        {
          appKey: 'agriculture-livestock',
          url: 'http://gh.space.gov.rw/agriculture-livestock/',
        },
        {
          appKey: 'water-resources',
          url: 'https://localhost:5184/water-resources/',
        },
      ],
      error: null,
    });
  });

  it('reports invalid MONITOR_APP_URLS instead of guessing', () => {
    expect(parseAppUrls('{not json').error).toMatch(/not valid JSON/);
    expect(parseAppUrls('["https://a"]').error).toMatch(/JSON object/);
    expect(parseAppUrls('{"a":"ftp://x"}')).toEqual({
      appUrls: [],
      error: 'MONITOR_APP_URLS has an invalid URL for "a"',
    });
  });

  it('uses only the origin of MONITOR_REFERER', () => {
    expect(
      readMonitorSettings(
        env({ MONITOR_REFERER: 'https://ops.example.com/x?y=1' }),
      ).referer,
    ).toBe('https://ops.example.com');
    expect(readMonitorSettings(env({ MONITOR_REFERER: 'nope' })).referer).toBe(
      DEFAULT_REFERER,
    );
  });
});
