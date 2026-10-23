import {
  BadRequestException,
  Controller,
  Get,
  NotFoundException,
  Param,
  Res,
} from '@nestjs/common';
import { ApiExcludeController } from '@nestjs/swagger';
import type { Response } from 'express';
import { randomBytes } from 'node:crypto';
import { isPortalHostKeyFormat } from '../portal/portal-host-keys';
import { findStandaloneApp, type StandaloneApp } from './standalone-apps';

/**
 * Launch page for standalone apps (see standalone-apps.ts). A shell frames
 * /api/v1/app-launch/<appKey>/<app> instead of the app itself; the page reads
 * the user's own portal token from POST /api/v1/app-auth/portal-token (the
 * session cookie only reaches /api/v1/) and hands it to the app.
 *
 * When there is no token (signed out, older session) the app opens as before
 * and asks for its own sign-in, so this is never worse than framing it directly.
 */
@ApiExcludeController()
@Controller('api/v1/app-launch')
export class AppLaunchController {
  @Get(':appKey/:app')
  launch(
    @Param('appKey') appKey: string,
    @Param('app') appId: string,
    @Res() res: Response,
  ): void {
    if (!isPortalHostKeyFormat(appKey)) {
      throw new BadRequestException('Invalid appKey');
    }
    const target = findStandaloneApp(appId);
    if (!target) {
      throw new NotFoundException('Unknown app');
    }

    const nonce = randomBytes(16).toString('base64');
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('X-Frame-Options', 'SAMEORIGIN');
    res.setHeader('Referrer-Policy', 'same-origin');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader(
      'Content-Security-Policy',
      [
        "default-src 'none'",
        `script-src 'nonce-${nonce}'`,
        `style-src 'nonce-${nonce}'`,
        "connect-src 'self'",
        "frame-src 'self'",
        "frame-ancestors 'self'",
        "base-uri 'none'",
        "form-action 'none'",
      ].join('; '),
    );
    res.send(launchPage(appKey, target, nonce));
  }
}

export function launchPage(
  appKey: string,
  target: StandaloneApp,
  nonce: string,
): string {
  const config = JSON.stringify({
    appKey,
    title: target.title,
    path: target.path,
    handoff: target.handoff,
    tokenEndpoint:
      target.handoff === 'token-endpoint' ? target.tokenEndpoint : null,
    storageKey: target.handoff === 'session-storage' ? target.storageKey : null,
  }).replace(/</g, '\\u003c');
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escapeHtml(target.title)}</title>
<style nonce="${nonce}">
html, body { margin: 0; height: 100%; background: transparent; }
iframe { display: block; width: 100%; height: 100%; border: 0; }
p { font: 14px system-ui, sans-serif; color: #6b6b6b; text-align: center; margin-top: 40vh; }
</style>
</head>
<body>
<p id="status">Opening ${escapeHtml(target.title)}…</p>
<script type="application/json" id="launch-config">${config}</script>
<script nonce="${nonce}">${LAUNCH_SCRIPT}</script>
</body>
</html>`;
}

/** Plain ES5 so it runs before (and regardless of) any app bundle. */
const LAUNCH_SCRIPT = `
(function () {
  var cfg = JSON.parse(document.getElementById('launch-config').textContent);
  var origin = window.location.origin;

  function fetchToken() {
    return fetch('/api/v1/app-auth/portal-token', {
      method: 'POST',
      credentials: 'same-origin',
      headers: { 'Content-Type': 'application/json', 'X-Requested-With': 'fetch' },
      body: JSON.stringify({ appKey: cfg.appKey })
    }).then(function (res) {
      if (!res.ok) throw new Error('No portal token (' + res.status + ')');
      return res.json();
    });
  }

  function frameApp(credential) {
    var url = new URL(cfg.path, origin);
    if (credential) {
      url.searchParams.set('arcgis-auth-origin', origin);
      url.searchParams.set('arcgis-auth-portal', credential.server);
    }
    var frame = document.createElement('iframe');
    frame.title = cfg.title;
    frame.allow = 'fullscreen; geolocation; clipboard-write';
    frame.src = url.href;
    document.getElementById('status').remove();
    document.body.appendChild(frame);
    if (!credential) return;

    // ArcGIS Maps SDK parent hand-off: the framed IdentityManager asks for a
    // credential instead of starting its own OAuth sign-in.
    window.addEventListener('message', function (event) {
      if (event.source !== frame.contentWindow || event.origin !== origin) return;
      if (!event.data || event.data.type !== 'arcgis:auth:requestCredential') return;
      fetchToken().then(function (fresh) {
        frame.contentWindow.postMessage(
          { type: 'arcgis:auth:credential', credential: fresh },
          origin
        );
      }, function (error) {
        frame.contentWindow.postMessage(
          { type: 'arcgis:auth:error', error: { name: 'identity-manager:not-authorized', message: error.message } },
          origin
        );
      });
    });
  }

  function openWithEndpoint(credential) {
    var done = function () { window.location.replace(new URL(cfg.path, origin).href); };
    if (!credential) return done();
    fetch(cfg.tokenEndpoint, {
      method: 'POST',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json', 'X-Requested-With': 'fetch' },
      body: JSON.stringify({ token: credential.token })
    }).then(done, done);
  }

  function readStored() {
    try { return JSON.parse(window.sessionStorage.getItem(cfg.storageKey) || 'null'); } catch (e) { return null; }
  }

  // The app's own profile lookup (sharing/rest/community/self), so its header
  // shows the same name as after its own sign-in. Falls back to the username.
  function lookupUser(credential) {
    var fallback = { username: credential.userId, fullName: credential.userId, email: '' };
    var url;
    try { url = new URL(credential.server.replace(/\\/+$/, '') + '/sharing/rest/community/self'); } catch (e) { return Promise.resolve(fallback); }
    if (url.origin !== origin) return Promise.resolve(fallback);
    return fetch(url.href, {
      method: 'POST',
      credentials: 'omit',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: 'f=json&token=' + encodeURIComponent(credential.token)
    }).then(function (res) { return res.json(); }).then(function (self) {
      var username = (self && self.username) || credential.userId;
      return { username: username, fullName: (self && self.fullName) || username, email: (self && self.email) || '' };
    }, function () { return fallback; });
  }

  // Writes the session the app's OAuth callback would have written: no refresh
  // token, valid until the portal token expires.
  function openWithSession(credential) {
    var done = function () { window.location.replace(new URL(cfg.path, origin).href); };
    var expires = credential && Number(credential.expires);
    if (!credential || !credential.token || !(expires > Date.now())) return done();
    var stored = readStored();
    // Keep the app's own sign-in for this user: it can refresh, ours cannot.
    if (stored && stored.token && Date.now() < stored.expiresAt &&
        stored.user && stored.user.username === credential.userId) return done();
    lookupUser(credential).then(function (user) {
      try {
        window.sessionStorage.setItem(cfg.storageKey, JSON.stringify({
          token: credential.token,
          tokenExpiresAt: expires,
          refreshToken: null,
          expiresAt: expires,
          user: user
        }));
      } catch (e) {}
      done();
    });
  }

  var open = cfg.handoff === 'arcgis' ? frameApp
    : cfg.handoff === 'token-endpoint' ? openWithEndpoint
    : openWithSession;
  fetchToken().then(open, function () { open(null); });
})();
`;

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}
