/**
 * Speed for the session-gated portal proxy (see portal-proxy.controller.ts).
 *
 * Every framed dashboard pulls the ArcGIS Dashboards / Experience Builder
 * engine (~7 MB of JS/CSS uncompressed) through the proxy. Marked no-store and
 * sent uncompressed, it was downloaded in full on every open. Three remedies:
 *
 *  1. Static portal files (app bundles, fonts, images under /apps/, /jsapi/,
 *     /sharing/files/) may be cached by the viewer's browser. Portal data
 *     (/sharing/rest, map and feature services, HTML pages) never is.
 *  2. Text responses are compressed (brotli, else gzip).
 *  3. Rewritten static files are kept in memory per app + host, so repeat
 *     requests skip token issuance, the upstream fetch, the rewrite and the
 *     compression. Only files public on the portal qualify, and the controller
 *     still checks the session before serving one.
 */
import { promisify } from 'node:util';
import { brotliCompress, constants, gzip } from 'node:zlib';

const brotli = promisify(brotliCompress);
const gzipAsync = promisify(gzip);

/** Paths that hold the portal's own static web files. */
const STATIC_ROOT = /(?:^|\/)(?:apps|jsapi|sharing\/files)\//i;
/** Never cache anything that is portal or service data. */
const DATA_PATH =
  /(?:^|\/)(?:sharing\/rest|rest\/services|rest\/info)(?:\/|$)/i;
const STATIC_FILE =
  /\.(?:m?js|css|woff2?|ttf|otf|eot|png|jpe?g|gif|svg|webp|ico|json|wasm|map)$/i;
/** Build tools put a content hash in file names that never change content. */
const HASHED_FILE = /[.-][0-9a-f]{8,}\.[a-z0-9]+$/i;
const COMPRESSIBLE =
  /^(?:text\/|application\/(?:javascript|x-javascript|ecmascript|json|xml|.*\+json|.*\+xml)|image\/svg\+xml)/i;

const HOUR_MS = 60 * 60 * 1000;
const DAY_MS = 24 * HOUR_MS;
/** Below this, compression costs more than it saves. */
const MIN_COMPRESS_BYTES = 1024;

export interface AssetPolicy {
  /** Cache-Control sent to the browser. */
  cacheControl: string;
  /** How long the service keeps its own rewritten copy. */
  ttlMs: number;
}

/**
 * Whether a proxied response is a static portal file, and how long it may be
 * cached. Decided on the request path (the URL query is ignored so nothing
 * per-user can sneak in) plus the upstream status and its own cache policy.
 */
export function staticAssetPolicy(
  method: string,
  restPath: string,
  status: number,
  upstreamCacheControl: string | null,
): AssetPolicy | null {
  if (method.toUpperCase() !== 'GET' || status !== 200) return null;
  const path = `/${restPath.replace(/^\/+/, '')}`;
  if (!STATIC_ROOT.test(path) || DATA_PATH.test(path)) return null;
  if (!STATIC_FILE.test(path)) return null;
  if (/no-store/i.test(upstreamCacheControl || '')) return null;
  return HASHED_FILE.test(path)
    ? { cacheControl: 'private, max-age=31536000, immutable', ttlMs: DAY_MS }
    : { cacheControl: 'private, max-age=3600', ttlMs: HOUR_MS };
}

export function isCompressible(contentType: string): boolean {
  return COMPRESSIBLE.test(contentType);
}

/** The encoding to send for this Accept-Encoding header, or null. */
export function pickEncoding(
  acceptEncoding: string | undefined,
): 'br' | 'gzip' | null {
  const accepted = String(acceptEncoding || '')
    .split(',')
    .map((part) => part.trim().split(';'))
    .filter(([, q]) => !q || !/^q=0(?:\.0*)?$/.test(q.trim()))
    .map(([name]) => name.toLowerCase());
  if (accepted.includes('br')) return 'br';
  if (accepted.includes('gzip')) return 'gzip';
  return null;
}

export async function encodeBody(
  body: Buffer,
  encoding: 'br' | 'gzip',
): Promise<Buffer> {
  return encoding === 'br'
    ? brotli(body, {
        params: {
          // Quality 5 compresses close to gzip -9 at a fraction of the cost of
          // brotli's default 11, which matters for multi-MB bundles.
          [constants.BROTLI_PARAM_QUALITY]: 5,
          [constants.BROTLI_PARAM_SIZE_HINT]: body.length,
        },
      })
    : gzipAsync(body, { level: 6 });
}

/**
 * The Content-Encoding to send a body with, or null to send it as it is
 * (small, binary, or a client that accepts neither).
 */
export function chooseEncoding(
  bodyBytes: number,
  contentType: string,
  acceptEncoding: string | undefined,
): 'br' | 'gzip' | null {
  if (bodyBytes < MIN_COMPRESS_BYTES || !isCompressible(contentType)) {
    return null;
  }
  return pickEncoding(acceptEncoding);
}

export interface CachedAsset {
  status: number;
  headers: Record<string, string>;
  cacheControl: string;
  contentType: string;
  body: Buffer;
  /** Compressed variants, made on first request for each. */
  encoded: Partial<Record<'br' | 'gzip', Buffer>>;
  expiresAt: number;
}

function entryBytes(entry: CachedAsset): number {
  return (
    entry.body.length +
    (entry.encoded.br?.length ?? 0) +
    (entry.encoded.gzip?.length ?? 0)
  );
}

/**
 * Size-bounded LRU of rewritten static files. A Map keeps insertion order, so
 * re-inserting on read makes the first key the least recently used.
 */
export class ProxyAssetCache {
  private readonly entries = new Map<string, CachedAsset>();
  private bytes = 0;

  constructor(
    private readonly maxBytes: number,
    private readonly maxEntryBytes = Math.min(16 * 1024 * 1024, maxBytes),
    private readonly now: () => number = Date.now,
  ) {}

  /**
   * One entry per app + host + file (+ query, minus any token), and per
   * browser origin: rewritten bodies carry absolute URLs on that origin.
   */
  static key(
    appKey: string,
    hostKey: string,
    restPath: string,
    search = '',
    origin = '',
  ): string {
    const query = new URLSearchParams(search);
    for (const name of [...query.keys()]) {
      if (name.toLowerCase() === 'token') query.delete(name);
    }
    const suffix = query.size ? `?${query.toString()}` : '';
    const scope = origin ? `${origin}|` : '';
    return `${scope}${appKey}|${hostKey}|/${restPath.replace(/^\/+/, '')}${suffix}`;
  }

  get size(): number {
    return this.bytes;
  }

  get(key: string): CachedAsset | null {
    const entry = this.entries.get(key);
    if (!entry) return null;
    if (entry.expiresAt <= this.now()) {
      this.delete(key);
      return null;
    }
    this.entries.delete(key);
    this.entries.set(key, entry);
    return entry;
  }

  set(key: string, entry: CachedAsset): void {
    this.delete(key);
    const size = entryBytes(entry);
    if (this.maxBytes <= 0 || size > this.maxEntryBytes) return;
    this.entries.set(key, entry);
    this.bytes += size;
    this.evict();
  }

  /** Record a compressed variant made after the entry was stored. */
  addEncoding(key: string, encoding: 'br' | 'gzip', body: Buffer): void {
    const entry = this.entries.get(key);
    if (!entry || entry.encoded[encoding]) return;
    entry.encoded[encoding] = body;
    this.bytes += body.length;
    this.evict();
  }

  private delete(key: string): void {
    const entry = this.entries.get(key);
    if (!entry) return;
    this.entries.delete(key);
    this.bytes -= entryBytes(entry);
  }

  private evict(): void {
    for (const key of this.entries.keys()) {
      if (this.bytes <= this.maxBytes) break;
      this.delete(key);
    }
  }
}
