import { createHash } from 'node:crypto';
import { Injectable } from '@nestjs/common';
import { ThrottlerGuard } from '@nestjs/throttler';
import { appSessionCookieName, readCookie } from './app-session.service';

/**
 * Rate limit per app session rather than per IP: behind IIS every user can
 * share one address. Requests without the session cookie fall back to the IP.
 */
@Injectable()
export class SessionThrottlerGuard extends ThrottlerGuard {
  protected getTracker(req: Record<string, any>): Promise<string> {
    const body = req.body as { appKey?: unknown } | undefined;
    const headers = req.headers as { cookie?: string } | undefined;
    const appKey = typeof body?.appKey === 'string' ? body.appKey : '';
    const cookie = appKey
      ? readCookie(headers?.cookie, appSessionCookieName(appKey))
      : null;
    if (!cookie) return super.getTracker(req);
    return Promise.resolve(
      `session:${createHash('sha256').update(cookie).digest('base64url')}`,
    );
  }
}
