/**
 * Pure helpers for the session-gated portal proxy (see portal-proxy.controller.ts).
 * Mirrors the mapping apps' dev-server proxy rewrites: portal URLs inside
 * proxied responses are pointed back at the proxy so framed dashboards keep
 * loading through it, and the service-account token is never sent onward.
 */

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

const ALLOWED_METHODS = new Set(['GET', 'HEAD', 'POST', 'OPTIONS']);

export function proxyPrefix(appKey: string, hostKey: string): string {
  return `${PORTAL_PROXY_ROUTE}/${appKey}/${hostKey}`;
}

export function isProxyRequestAllowed(method: string, path: string): boolean {
  if (!ALLOWED_METHODS.has(method.toUpperCase())) return false;
  let decoded: string;
  try {
    decoded = decodeURIComponent(path);
  } catch {
    return false;
  }
  return !BLOCKED_PATH.test(`/${decoded.replace(/^\/+/, '')}`);
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

/** Point portal URLs in a text payload at the proxy and drop the token. */
export function rewritePayload(
  text: string,
  options: {
    portalOrigin: string;
    prefix: string;
    contentType: string;
    restPath: string;
    token: string | null;
  },
): string {
  const { portalOrigin, prefix, contentType, restPath, token } = options;
  let next = scrubToken(text, token);
  if (!next) return next;

  for (const from of originVariants(portalOrigin)) {
    next = next.replaceAll(from, prefix);
    next = next.replaceAll(
      encodeURIComponent(from),
      encodeURIComponent(prefix),
    );
    next = next.replaceAll(escapeSlashes(from), escapeSlashes(prefix));
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
