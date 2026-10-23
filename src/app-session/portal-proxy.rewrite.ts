/**
 * Pure helpers for the session-gated portal proxy (see portal-proxy.controller.ts).
 * Mirrors the mapping apps' dev-server proxy rewrites: portal URLs inside
 * proxied responses are pointed back at the proxy so framed dashboards keep
 * loading through it, and the service-account token is never sent onward.
 */

import { keepStoryMapLinks } from './storymap-links';

export const PORTAL_PROXY_ROUTE = '/api/v1/portal-proxy';

/** Above this size, JS bodies only get absolute-URL rewrites (as in the apps). */
const HEAVY_REWRITE_BYTES = 250_000;

/** Root-relative portal paths rewritten when quoted in text payloads. */
const ROOT_PATHS = ['/portal/', '/server/', '/arcgis/'];

/**
 * Upstream calls that must not run with the service account: credential
 * issuance, administration, sharing/content mutation and feature edits.
 * Dashboards only read; anything matching here is refused with 403.
 */
const BLOCKED_PATH =
  /(?:^|\/)(?:generateToken|oauth2|portaladmin|admin|tokens|signout|signin)(?:\/|$)|\/sharing\/rest\/.*\/(?:delete\w*|update\w*|add\w*|remove\w*|share|unshare|reassign|move\w*|protect|unprotect|createService|createGroup|join|leave|invite\w*|publish|export)(?:\/|$)|\/(?:applyEdits|addFeatures|updateFeatures|deleteFeatures|calculate|truncate|append)(?:\/|$)/i;

/**
 * The one oauth2 call let through: it only reports whether the token's user
 * may use an app ({ valid }) and issues nothing. Survey123 refuses to open a
 * form without it.
 */
const ALLOWED_OAUTH_PATH =
  /^(?:\/[\w-]+)*\/sharing\/rest\/oauth2\/validateAppAccess$/i;

const ALLOWED_METHODS = new Set(['GET', 'HEAD', 'POST', 'OPTIONS']);

/**
 * Reserved host key for the Survey123 web app, which runs on
 * survey123.arcgis.com rather than on a portal. Served same-origin, a form
 * reads its portal (?portalUrl=) through this proxy like a dashboard does,
 * so viewing it needs no second sign-in. It never gets a token and only
 * reads: submitting still hits BLOCKED_PATH on the portal side.
 */
export const SURVEY123_HOST_KEY = 's123';
export const SURVEY123_ORIGIN = 'https://survey123.arcgis.com';
const SURVEY123_METHODS = new Set(['GET', 'HEAD']);

/** Files portal users upload to items: anyone who can publish controls them. */
const USER_CONTENT_PATH =
  /(?:^|\/)sharing\/rest\/content\/items\/[^/]+\/(?:data|resources|info)(?:\/|$)/i;
const ACTIVE_CONTENT_TYPE =
  /^\s*(?:text\/html|application\/xhtml\+xml|image\/svg\+xml|text\/xml|application\/xml)\b/i;

/**
 * Uploaded HTML/SVG/XML served on the app origin could run script there and
 * read the user's portal token (/api/v1/app-auth/portal-token). Such files are
 * sent as sandboxed downloads instead; apps read item data as JSON, not pages.
 */
export function isActiveUserContent(
  restPath: string,
  contentType: string,
): boolean {
  let decoded: string;
  try {
    decoded = decodeURIComponent(restPath);
  } catch {
    decoded = restPath;
  }
  return (
    USER_CONTENT_PATH.test(decoded) && ACTIVE_CONTENT_TYPE.test(contentType)
  );
}

export function proxyPrefix(appKey: string, hostKey: string): string {
  return `${PORTAL_PROXY_ROUTE}/${appKey}/${hostKey}`;
}

export function isProxyRequestAllowed(
  method: string,
  path: string,
  hostKey?: string,
): boolean {
  const methods =
    hostKey === SURVEY123_HOST_KEY ? SURVEY123_METHODS : ALLOWED_METHODS;
  if (!methods.has(method.toUpperCase())) return false;
  let decoded: string;
  try {
    decoded = decodeURIComponent(path);
  } catch {
    return false;
  }
  const normalized = `/${decoded.replace(/^\/+/, '')}`;
  if (method.toUpperCase() === 'GET' && ALLOWED_OAUTH_PATH.test(normalized)) {
    return true;
  }
  return !BLOCKED_PATH.test(normalized);
}

/**
 * Resolve the upstream URL for a proxied path, refusing anything that would
 * leave the portal origin (e.g. `//evil.example/` or `..` tricks).
 */
export function resolveUpstreamUrl(
  portalOrigin: string,
  restPath: string,
  search: string,
): URL | null {
  const path = `/${restPath.replace(/^\/+/, '')}`;
  let target: URL;
  try {
    target = new URL(path, `${portalOrigin}/`);
  } catch {
    return null;
  }
  if (target.origin !== portalOrigin) return null;
  new URLSearchParams(search).forEach((value, key) => {
    if (key.toLowerCase() !== 'token') target.searchParams.append(key, value);
  });
  return target;
}

function originVariants(portalOrigin: string): string[] {
  const host = portalOrigin.replace(/^https?:\/\//, '');
  return [`https://${host}`, `http://${host}`];
}

function escapeSlashes(url: string): string {
  return url.replaceAll('/', '\\/');
}

function collapse(text: string, prefix: string): string {
  let next = text;
  const doubled = `${prefix}${prefix}`;
  while (next.includes(doubled)) next = next.replaceAll(doubled, prefix);
  return next;
}

function scrubToken(text: string, token: string | null): string {
  return token ? text.replaceAll(token, '') : text;
}

/** Rewrite a redirect Location so it stays on the proxy. */
export function rewriteLocation(
  location: string,
  portalOrigin: string,
  prefix: string,
  token: string | null,
): string {
  let next = scrubToken(location, token);
  for (const from of originVariants(portalOrigin)) {
    if (next.startsWith(from)) {
      next = prefix + next.slice(from.length);
      break;
    }
  }
  if (ROOT_PATHS.some((root) => next.startsWith(root))) next = prefix + next;
  return collapse(next, prefix);
}

/** Error bodies are tiny; never parse a real payload looking for one. */
const MAX_ERROR_BODY = 4096;

/**
 * Ported from the mapping apps (server/portal-refusal.js): a portal 403 error
 * body makes ArcGIS IdentityManager retry forever with the same token. The
 * proxy always attaches a token, so report it as 400 (message kept) and
 * Dashboards shows its error page instead.
 */
export function softenPermissionRefusal(text: string): string {
  if (text.length > MAX_ERROR_BODY || !/^\s*\{\s*"error"/.test(text)) {
    return text;
  }
  let body: { error?: { code?: unknown } };
  try {
    body = JSON.parse(text) as { error?: { code?: unknown } };
  } catch {
    return text;
  }
  if (!body.error || Number(body.error.code) !== 403) return text;
  body.error.code = 400;
  return JSON.stringify(body);
}

export function shouldRewriteBody(contentType: string): boolean {
  return /text\/html|javascript|json|css|text\/plain|xml/i.test(contentType);
}

interface RewriteOptions {
  portalOrigin: string;
  prefix: string;
  contentType: string;
  restPath: string;
  token: string | null;
  /**
   * Browser origin the proxy is served on (the session origin). Absolute
   * portal URLs stay absolute on it: ArcGIS IdentityManager matches a
   * server's owningSystemUrl against the portal it knows by full URL, and an
   * origin-less one never matches, sending it into an endless sign-in loop
   * that freezes the page.
   */
  appOrigin?: string;
}

/**
 * Point portal URLs in a text payload at the proxy and drop the token.
 * StoryMap links are the exception and stay on their portal (see storymap-links).
 */
export function rewritePayload(text: string, options: RewriteOptions): string {
  return keepStoryMapLinks(text, (t) => rewritePortalUrls(t, options));
}

function rewritePortalUrls(text: string, options: RewriteOptions): string {
  const { portalOrigin, prefix, contentType, restPath, token } = options;
  let next = scrubToken(text, token);
  if (!next) return next;

  const absolute = `${(options.appOrigin || '').replace(/\/+$/, '')}${prefix}`;
  for (const from of originVariants(portalOrigin)) {
    next = next.replaceAll(from, absolute);
    next = next.replaceAll(
      encodeURIComponent(from),
      encodeURIComponent(absolute),
    );
    next = next.replaceAll(escapeSlashes(from), escapeSlashes(absolute));
  }

  const isJs = /javascript|ecmascript|application\/json/i.test(contentType);
  const isHtml = /text\/html/i.test(contentType);
  const isJsapi = /(?:^|\/)jsapi(?:\/|$)/i.test(restPath);
  const lightOnly =
    !isHtml && (isJsapi || (isJs && next.length >= HEAVY_REWRITE_BYTES));

  if (!lightOnly) {
    for (const root of ROOT_PATHS) {
      const to = `${prefix}${root}`;
      for (const quote of ['"', "'", '`', '(']) {
        next = next.replaceAll(`${quote}${root}`, `${quote}${to}`);
      }
    }
  }

  return collapse(next, prefix);
}
