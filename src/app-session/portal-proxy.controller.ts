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
import { isPortalHostKeyFormat } from '../portal/portal-host-keys';
import { AppSessionService } from './app-session.service';
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
      upstream = await fetch(target, init);
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

    res.status(upstream.status);
    upstream.headers.forEach((value, key) => {
      if (!SKIP_HEADERS.has(key.toLowerCase())) res.setHeader(key, value);
    });
    res.send(body);
  }
}
