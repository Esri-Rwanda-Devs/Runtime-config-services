import { request as httpRequest, type IncomingMessage } from 'node:http';
import { request as httpsRequest } from 'node:https';

const MAX_REDIRECTS = 5;

/**
 * Status-and-headers GET for app servers on this machine, which use
 * self-signed certificates. The body is never read: the socket is destroyed as
 * soon as headers arrive, so no response stream is left half-consumed. (The
 * undici client crashed the process with `assert(!this.paused)` when a server
 * closed the connection while a cancelled body was still paused.)
 *
 * Redirects to another loopback URL are followed here; a redirect off the
 * machine is handed to `external` so it gets normal certificate verification.
 */
export async function loopbackFetch(
  url: string,
  init: RequestInit,
  isLoopback: (hostname: string) => boolean,
  external: (url: string, init: RequestInit) => Promise<Response>,
): Promise<Response> {
  let current = new URL(url);
  for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
    if (!isLoopback(current.hostname)) {
      return external(current.toString(), init);
    }
    const head = await requestHead(current, init);
    const location = head.headers.location;
    if (
      init.redirect !== 'manual' &&
      head.status >= 300 &&
      head.status < 400 &&
      typeof location === 'string'
    ) {
      current = new URL(location, current);
      continue;
    }
    return new Response(null, {
      status: head.status,
      headers: toHeaders(head.headers),
    });
  }
  throw new Error(`Too many redirects (more than ${MAX_REDIRECTS})`);
}

function requestHead(
  url: URL,
  init: RequestInit,
): Promise<{ status: number; headers: IncomingMessage['headers'] }> {
  const send = url.protocol === 'https:' ? httpsRequest : httpRequest;
  return new Promise((resolve, reject) => {
    const req = send(url, {
      method: init.method ?? 'GET',
      headers: Object.fromEntries(new Headers(init.headers).entries()),
      signal: init.signal ?? undefined,
      rejectUnauthorized: false,
    });
    req.once('response', (res) => {
      resolve({ status: res.statusCode ?? 0, headers: res.headers });
      res.destroy();
      req.destroy();
    });
    req.once('error', reject);
    req.end();
  });
}

function toHeaders(raw: IncomingMessage['headers']): Headers {
  const headers = new Headers();
  for (const [name, value] of Object.entries(raw)) {
    if (value === undefined) continue;
    for (const item of Array.isArray(value) ? value : [value]) {
      headers.append(name, item);
    }
  }
  return headers;
}
