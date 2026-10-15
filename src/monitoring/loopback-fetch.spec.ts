import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { loopbackFetch } from './loopback-fetch';

describe('loopbackFetch', () => {
  let server: Server;
  let base: string;
  const external = jest.fn();
  const isLoopback = (host: string) => host === '127.0.0.1';

  beforeAll(async () => {
    server = createServer((req, res) => {
      if (req.url === '/redirect') {
        res.writeHead(302, { Location: '/page' });
        res.end();
      } else if (req.url === '/away') {
        res.writeHead(302, { Location: 'https://example.com/app' });
        res.end();
      } else {
        // Large body + Connection: close is what crashed the undici client.
        res.writeHead(200, {
          'Content-Type': 'text/html',
          Connection: 'close',
        });
        res.end('<html>' + 'x'.repeat(2_000_000) + '</html>');
      }
    });
    await new Promise<void>((resolve) =>
      server.listen(0, '127.0.0.1', resolve),
    );
    base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  });

  afterAll(() => new Promise((resolve) => server.close(resolve)));

  it('returns status and headers without reading the body', async () => {
    for (let i = 0; i < 20; i++) {
      const res = await loopbackFetch(`${base}/page`, {}, isLoopback, external);
      expect(res.status).toBe(200);
      expect(res.headers.get('content-type')).toBe('text/html');
    }
  });

  it('follows loopback redirects', async () => {
    const res = await loopbackFetch(
      `${base}/redirect`,
      { redirect: 'follow' },
      isLoopback,
      external,
    );
    expect(res.status).toBe(200);
  });

  it('hands off-machine redirects to the verifying fetch', async () => {
    external.mockResolvedValueOnce(new Response(null, { status: 204 }));
    const res = await loopbackFetch(`${base}/away`, {}, isLoopback, external);
    expect(external).toHaveBeenCalledWith('https://example.com/app', {});
    expect(res.status).toBe(204);
  });

  it('rejects with AbortError when the signal times out', async () => {
    const hang = createServer(() => undefined);
    await new Promise<void>((r) => hang.listen(0, '127.0.0.1', r));
    const port = (hang.address() as AddressInfo).port;
    await expect(
      loopbackFetch(
        `http://127.0.0.1:${port}/`,
        { signal: AbortSignal.timeout(50) },
        isLoopback,
        external,
      ),
    ).rejects.toMatchObject({ name: 'AbortError' });
    hang.closeAllConnections();
    await new Promise((r) => hang.close(r));
  });
});
