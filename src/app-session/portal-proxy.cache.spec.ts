import { brotliDecompressSync, gunzipSync } from 'node:zlib';
import {
  type CachedAsset,
  chooseEncoding,
  encodeBody,
  pickEncoding,
  ProxyAssetCache,
  staticAssetPolicy,
} from './portal-proxy.cache';

const HASHED =
  'portal/apps/dashboards/assets/vendor-f9627cdb61e6c03f68d01f4b39fc0478.js';

describe('staticAssetPolicy', () => {
  it('lets the browser keep hashed portal bundles for a year', () => {
    expect(staticAssetPolicy('GET', HASHED, 200, 'private')).toEqual({
      cacheControl: 'private, max-age=31536000, immutable',
      ttlMs: 24 * 60 * 60 * 1000,
    });
    expect(
      staticAssetPolicy(
        'GET',
        'portal/apps/dashboards/assets/chunk.33167.6d270a3a385f8f671797.css',
        200,
        null,
      )?.cacheControl,
    ).toContain('immutable');
  });

  it('gives unhashed static files an hour', () => {
    for (const path of [
      'portal/apps/dashboards/assets/ckeditor/translations.js',
      'portal/apps/dashboards/translations/en.json',
      'portal/sharing/files/css/site.min.css',
      'portal/jsapi/jsapi4/esri/themes/light/main.css',
      'portal/apps/dashboards/assets/arcgis-core/themes/base/fonts/fonts/x.woff2',
    ]) {
      expect(staticAssetPolicy('GET', path, 200, 'private')).toEqual({
        cacheControl: 'private, max-age=3600',
        ttlMs: 60 * 60 * 1000,
      });
    }
  });

  it('never caches portal data, pages, other methods or failures', () => {
    for (const path of [
      'portal/sharing/rest/portals/self',
      'portal/sharing/rest/content/items/abc/data',
      'portal/sharing/rest/content/items/abc/resources/a.json',
      'server/rest/services/X/FeatureServer/0/query',
      'server/rest/info',
      'portal/apps/dashboards/abc',
      'portal/apps/experiencebuilder/experience/',
      'portal/apps/dashboards/index.html',
    ]) {
      expect(staticAssetPolicy('GET', path, 200, null)).toBeNull();
    }
    expect(staticAssetPolicy('POST', HASHED, 200, null)).toBeNull();
    expect(staticAssetPolicy('HEAD', HASHED, 200, null)).toBeNull();
    expect(staticAssetPolicy('GET', HASHED, 404, null)).toBeNull();
    expect(staticAssetPolicy('GET', HASHED, 304, null)).toBeNull();
    expect(staticAssetPolicy('GET', HASHED, 200, 'no-store')).toBeNull();
  });
});

describe('compression choice', () => {
  it('prefers brotli, then gzip, and honours q=0', () => {
    expect(pickEncoding('gzip, deflate, br, zstd')).toBe('br');
    expect(pickEncoding('gzip, deflate')).toBe('gzip');
    expect(pickEncoding('br;q=0, gzip')).toBe('gzip');
    expect(pickEncoding('identity')).toBeNull();
    expect(pickEncoding(undefined)).toBeNull();
  });

  it('compresses only text bodies worth compressing', () => {
    expect(chooseEncoding(5000, 'application/javascript', 'br')).toBe('br');
    expect(
      chooseEncoding(5000, 'application/json; charset=utf-8', 'gzip'),
    ).toBe('gzip');
    expect(chooseEncoding(5000, 'image/svg+xml', 'gzip')).toBe('gzip');
    expect(chooseEncoding(500, 'application/javascript', 'br')).toBeNull();
    expect(chooseEncoding(5000, 'image/png', 'br')).toBeNull();
    expect(chooseEncoding(5000, 'font/woff2', 'br')).toBeNull();
  });

  it('round-trips both encodings', async () => {
    const body = Buffer.from('x'.repeat(10_000));
    expect(
      brotliDecompressSync(await encodeBody(body, 'br')).equals(body),
    ).toBe(true);
    expect(gunzipSync(await encodeBody(body, 'gzip')).equals(body)).toBe(true);
  });
});

describe('ProxyAssetCache', () => {
  const entry = (
    bytes: number,
    expiresAt = Date.now() + 60_000,
  ): CachedAsset => ({
    status: 200,
    headers: {},
    cacheControl: 'private, max-age=3600',
    contentType: 'application/javascript',
    body: Buffer.alloc(bytes),
    encoded: {},
    expiresAt,
  });

  it('keys by app, host, path and query, never by token', () => {
    expect(ProxyAssetCache.key('a', 'gh', '/x.js', '?v=1&token=SECRET')).toBe(
      'a|gh|/x.js?v=1',
    );
    expect(ProxyAssetCache.key('a', 'gh', 'x.js', '?Token=SECRET')).toBe(
      'a|gh|/x.js',
    );
    expect(ProxyAssetCache.key('a', 'gh', 'x.js')).not.toBe(
      ProxyAssetCache.key('b', 'gh', 'x.js'),
    );
    expect(ProxyAssetCache.key('a', 'gh', 'x.js')).not.toBe(
      ProxyAssetCache.key('a', 'gh2', 'x.js'),
    );
  });

  it('keys by browser origin, since rewritten bodies carry it', () => {
    expect(
      ProxyAssetCache.key('a', 'gh', 'x.js', '', 'https://one.example'),
    ).toBe('https://one.example|a|gh|/x.js');
    expect(
      ProxyAssetCache.key('a', 'gh', 'x.js', '', 'https://one.example'),
    ).not.toBe(
      ProxyAssetCache.key('a', 'gh', 'x.js', '', 'https://two.example'),
    );
  });

  it('drops expired entries', () => {
    let now = 1_000;
    const cache = new ProxyAssetCache(1000, 1000, () => now);
    cache.set('k', entry(10, 2_000));
    expect(cache.get('k')).not.toBeNull();
    now = 2_000;
    expect(cache.get('k')).toBeNull();
    expect(cache.size).toBe(0);
  });

  it('stays within its byte budget, evicting the least recently used', () => {
    const cache = new ProxyAssetCache(300);
    cache.set('a', entry(100));
    cache.set('b', entry(100));
    cache.set('c', entry(100));
    cache.get('a');
    cache.set('d', entry(100));
    expect(cache.get('b')).toBeNull();
    expect(cache.get('a')).not.toBeNull();
    expect(cache.size).toBeLessThanOrEqual(300);
    cache.addEncoding('a', 'br', Buffer.alloc(150));
    expect(cache.size).toBeLessThanOrEqual(300);
  });

  it('refuses entries larger than the per-entry limit, and does nothing when off', () => {
    const cache = new ProxyAssetCache(1000, 100);
    cache.set('big', entry(101));
    expect(cache.get('big')).toBeNull();
    const off = new ProxyAssetCache(0);
    off.set('k', entry(1));
    expect(off.get('k')).toBeNull();
  });
});
