import {
  All,
  BadRequestException,
  Controller,
  ForbiddenException,
  Param,
  Req,
  Res,
  UnauthorizedException,
} from '@nestjs/common';
import { ApiExcludeController } from '@nestjs/swagger';
import type { Request, Response } from 'express';
import { PortalAuthTokenService } from '../portal/portal-auth-token.service';
import { portalFetch } from '../portal/portal-fetch';
import { isPortalHostKeyFormat } from '../portal/portal-host-keys';
import { AppSessionService } from './app-session.service';
import {
  type CachedAsset,
  chooseEncoding,
  encodeBody,
  isCompressible,
  ProxyAssetCache,
  staticAssetPolicy,
} from './portal-proxy.cache';
import {
  isProxyRequestAllowed,
  proxyPrefix,
  resolveUpstreamUrl,
  rewriteLocation,
  rewritePayload,
  shouldRewriteBody,
  softenPermissionRefusal,
} from './portal-proxy.rewrite';

const PROXY_TIMEOUT_MS = 120_000;
/** Memory for rewritten static portal files (PORTAL_PROXY_CACHE_MB, 0 = off). */
const ASSET_CACHE_MB = Number(process.env.PORTAL_PROXY_CACHE_MB ?? 64);
const REDIRECTS = new Set([301, 302, 303, 307, 308]);
const SKIP_HEADERS = new Set([
  'x-frame-options',
  'content-security-policy',
  'content-security-policy-report-only',
  'strict-transport-security',
  'public-key-pins',
  'public-key-pins-report-only',
  'content-encoding',
  'content-length',
  'transfer-encoding',
  'connection',
  'set-cookie',
  'cache-control',
  // The body is rewritten and re-encoded here; Express derives its own ETag
  // from what is actually sent.
  'etag',
  'last-modified',
  'vary',
]);

type RawBodyRequest = Request & { rawBody?: Buffer };

/**
 * Session-gated portal proxy for static mapping SPAs.
 *
 * The browser frames /api/v1/portal-proxy/<appKey>/<hostKey>/<portal path>.
 * The service-account token comes from the existing broker
 * (PortalAuthTokenService: config host authorization + cache) and is attached
 * here, server-side; it is scrubbed from everything sent back.
 */
@ApiExcludeController()
@Controller('api/v1/portal-proxy')
export class PortalProxyController {
  private readonly assets = new ProxyAssetCache(
    Math.max(0, ASSET_CACHE_MB) * 1024 * 1024,
  );

  constructor(
    private readonly sessions: AppSessionService,
    private readonly tokens: PortalAuthTokenService,
  ) {}

  @All(':appKey/:hostKey/*path')
  async proxy(
    @Param('appKey') appKey: string,
    @Param('hostKey') hostKey: string,
    @Req() req: RawBodyRequest,
    @Res() res: Response,
  ): Promise<void> {
    if (!isPortalHostKeyFormat(appKey) || !isPortalHostKeyFormat(hostKey)) {
      throw new BadRequestException('Invalid proxy path');
    }

    const session = await this.sessions.verify(req.headers.cookie, appKey);
    if (!session) {
      throw new UnauthorizedException('Application login required');
    }
    // Cross-site writes cannot ride the cookie (SameSite=Lax); also refuse any
    // request that announces a different origin than the one signed in.
    const origin = req.headers.origin;
    if (origin && origin !== session.origin) {
      throw new ForbiddenException('Origin is not allowed');
    }

    const prefix = proxyPrefix(appKey, hostKey);
    const original = req.originalUrl;
    const queryIndex = original.indexOf('?');
    const pathPart = queryIndex < 0 ? original : original.slice(0, queryIndex);
    const search = queryIndex < 0 ? '' : original.slice(queryIndex);
    if (!pathPart.startsWith(`${prefix}/`)) {
      throw new BadRequestException('Invalid proxy path');
    }
    const restPath = pathPart.slice(prefix.length + 1);

    if (!isProxyRequestAllowed(req.method, restPath)) {
      throw new ForbiddenException('This portal operation is not available');
    }

    // Static portal files already fetched for this app + host: no token, no
    // upstream call. The session above has been checked all the same.
    const assetKey =
      req.method === 'GET'
        ? ProxyAssetCache.key(appKey, hostKey, restPath, search)
        : null;
    const cached = assetKey ? this.assets.get(assetKey) : null;
    if (assetKey && cached) {
      await this.sendAsset(req, res, assetKey, cached);
      return;
    }

    const issued = await this.tokens.issueToken({
      appKey,
      portalHostKey: hostKey,
      origin: session.origin,
    });
    const portalOrigin = new URL(issued.portalUrl).origin;
    const target = resolveUpstreamUrl(portalOrigin, restPath, search);
    if (!target) {
      throw new BadRequestException('Invalid proxy path');
    }
    target.searchParams.set('token', issued.token);

    const headers: Record<string, string> = {
      accept: req.headers.accept || '*/*',
      'user-agent': req.headers['user-agent'] || 'runtime-config-portal-proxy',
      referer: `${session.origin}/`,
    };
    if (req.headers['content-type']) {
      headers['content-type'] = req.headers['content-type'];
    }

    const init: RequestInit & { duplex?: 'half' } = {
      method: req.method,
      headers,
      redirect: 'manual',
      signal: AbortSignal.timeout(PROXY_TIMEOUT_MS),
    };
    if (req.method !== 'GET' && req.method !== 'HEAD') {
      if (req.rawBody) {
        init.body = new Uint8Array(req.rawBody);
      } else if (!req.readableEnded) {
        // Bodies Nest did not parse (e.g. multipart) are streamed through.
        init.body = req as unknown as ReadableStream;
        init.duplex = 'half';
      }
    }

    let upstream: globalThis.Response;
    try {
      upstream = await portalFetch(target, init);
    } catch (error) {
      const timeout = (error as Error)?.name === 'TimeoutError';
      res.status(timeout ? 504 : 502).json({
        error: timeout
          ? 'The mapping portal did not respond in time'
          : 'Unable to reach ArcGIS Portal',
      });
      return;
    }

    res.setHeader('Cache-Control', 'private, no-store');
    res.setHeader('X-Frame-Options', 'SAMEORIGIN');

    const location = upstream.headers.get('location');
    if (REDIRECTS.has(upstream.status) && location) {
      res.redirect(
        upstream.status,
        rewriteLocation(location, portalOrigin, prefix, issued.token),
      );
      return;
    }

    // Read the whole body before committing headers, so a broken upstream
    // body (e.g. a mislabelled gzip error page) becomes a clean 502.
    const type = upstream.headers.get('content-type') || '';
    let body: string | Buffer;
    try {
      body = shouldRewriteBody(type)
        ? rewritePayload(softenPermissionRefusal(await upstream.text()), {
            portalOrigin,
            prefix,
            contentType: type,
            restPath,
            token: issued.token,
          })
        : Buffer.from(await upstream.arrayBuffer());
    } catch {
      res
        .status(502)
        .json({ error: 'The mapping portal sent an unreadable response' });
      return;
    }

    const forwarded: Record<string, string> = {};
    upstream.headers.forEach((value, key) => {
      if (!SKIP_HEADERS.has(key.toLowerCase())) forwarded[key] = value;
    });
    const payload = typeof body === 'string' ? Buffer.from(body, 'utf8') : body;

    const policy = staticAssetPolicy(
      req.method,
      restPath,
      upstream.status,
      upstream.headers.get('cache-control'),
    );
    if (policy && assetKey) {
      const entry: CachedAsset = {
        status: upstream.status,
        headers: forwarded,
        cacheControl: policy.cacheControl,
        contentType: type,
        body: payload,
        encoded: {},
        expiresAt: Date.now() + policy.ttlMs,
      };
      this.assets.set(assetKey, entry);
      await this.sendAsset(req, res, assetKey, entry);
      return;
    }

    res.status(upstream.status);
    for (const [key, value] of Object.entries(forwarded)) {
      res.setHeader(key, value);
    }
    const encoding = chooseEncoding(
      payload.length,
      type,
      req.headers['accept-encoding'],
    );
    if (isCompressible(type)) res.setHeader('Vary', 'Accept-Encoding');
    if (encoding) {
      res.setHeader('Content-Encoding', encoding);
      res.send(await encodeBody(payload, encoding));
      return;
    }
    res.send(payload);
  }

  /** Send a static portal file, browser-cacheable and compressed once. */
  private async sendAsset(
    req: Request,
    res: Response,
    key: string,
    entry: CachedAsset,
  ): Promise<void> {
    res.status(entry.status);
    for (const [name, value] of Object.entries(entry.headers)) {
      res.setHeader(name, value);
    }
    res.setHeader('Cache-Control', entry.cacheControl);
    res.setHeader('X-Frame-Options', 'SAMEORIGIN');
    if (isCompressible(entry.contentType)) {
      res.setHeader('Vary', 'Accept-Encoding');
    }
    const encoding = chooseEncoding(
      entry.body.length,
      entry.contentType,
      req.headers['accept-encoding'],
    );
    if (!encoding) {
      res.send(entry.body);
      return;
    }
    let encoded = entry.encoded[encoding];
    if (!encoded) {
      encoded = await encodeBody(entry.body, encoding);
      this.assets.addEncoding(key, encoding, encoded);
    }
    res.setHeader('Content-Encoding', encoding);
    res.send(encoded);
  }
}
