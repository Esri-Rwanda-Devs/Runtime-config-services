import { runInNewContext } from 'node:vm';
import { launchPage } from './app-launch.controller';
import { STANDALONE_APPS } from './standalone-apps';

const ORIGIN = 'https://gh.space.gov.rw';
const CREDENTIAL = {
  token: 'user-token',
  expires: 1_900_000_000_000,
  userId: 'alice',
  server: `${ORIGIN}/portal`,
  ssl: true,
};

type Frame = {
  title?: string;
  allow?: string;
  src?: string;
  contentWindow: { postMessage: jest.Mock };
};

/** Runs the launch page's script against a minimal browser stand-in. */
function runLaunchPage(appId: string, fetchImpl: jest.Mock) {
  const html = launchPage('water-resources', STANDALONE_APPS[appId], 'n0nce');
  const config = /id="launch-config">([^<]*)<\/script>/.exec(html)![1];
  const script = /<script nonce="n0nce">([\s\S]*?)<\/script>/.exec(html)![1];

  const frames: Frame[] = [];
  const listeners: Array<(event: unknown) => void> = [];
  const replace = jest.fn();
  const context = {
    URL,
    JSON,
    fetch: fetchImpl,
    document: {
      getElementById: (id: string) =>
        id === 'launch-config' ? { textContent: config } : { remove: () => {} },
      createElement: () => {
        const frame: Frame = { contentWindow: { postMessage: jest.fn() } };
        frames.push(frame);
        return frame;
      },
      body: { appendChild: () => {} },
    },
    window: {
      location: { origin: ORIGIN, replace },
      addEventListener: (type: string, fn: (event: unknown) => void) => {
        if (type === 'message') listeners.push(fn);
      },
    },
  };
  runInNewContext(script, context);
  return { frames, listeners, replace };
}

const json = (status: number, body: unknown) =>
  Promise.resolve({
    ok: status < 400,
    status,
    json: () => Promise.resolve(body),
  });

async function settle(): Promise<void> {
  for (let i = 0; i < 5; i += 1) {
    await new Promise((resolve) => setImmediate(resolve));
  }
}

describe('app launch page script', () => {
  it('frames an ArcGIS SDK app for the parent hand-off and answers its credential request', async () => {
    const fetchMock = jest.fn(() => json(200, CREDENTIAL));
    const { frames, listeners } = runLaunchPage('water-quality', fetchMock);
    await settle();

    expect(fetchMock).toHaveBeenCalledWith(
      '/api/v1/app-auth/portal-token',
      expect.objectContaining({
        method: 'POST',
        credentials: 'same-origin',
        body: JSON.stringify({ appKey: 'water-resources' }),
        headers: expect.objectContaining({
          'X-Requested-With': 'fetch',
        }) as unknown,
      }),
    );
    expect(frames).toHaveLength(1);
    const src = new URL(frames[0].src!);
    expect(src.origin + src.pathname).toBe(`${ORIGIN}/water-quality/`);
    expect(src.searchParams.get('arcgis-auth-origin')).toBe(ORIGIN);
    expect(src.searchParams.get('arcgis-auth-portal')).toBe(`${ORIGIN}/portal`);
    // The token never goes into the URL.
    expect(frames[0].src).not.toContain('user-token');

    const child = frames[0].contentWindow;
    // Messages from anything but the framed app, or another origin, are ignored.
    listeners[0]({
      source: {},
      origin: ORIGIN,
      data: { type: 'arcgis:auth:requestCredential' },
    });
    listeners[0]({
      source: child,
      origin: 'https://evil.example',
      data: { type: 'arcgis:auth:requestCredential' },
    });
    listeners[0]({ source: child, origin: ORIGIN, data: { type: 'other' } });
    await settle();
    expect(child.postMessage).not.toHaveBeenCalled();

    listeners[0]({
      source: child,
      origin: ORIGIN,
      data: { type: 'arcgis:auth:requestCredential' },
    });
    await settle();
    expect(child.postMessage).toHaveBeenCalledWith(
      { type: 'arcgis:auth:credential', credential: CREDENTIAL },
      ORIGIN,
    );
  });

  it('reports an error to the SDK when the token has gone by the time it asks', async () => {
    const fetchMock = jest
      .fn()
      .mockImplementationOnce(() => json(200, CREDENTIAL))
      .mockImplementationOnce(() => json(401, {}));
    const { frames, listeners } = runLaunchPage('forest-health', fetchMock);
    await settle();
    const child = frames[0].contentWindow;
    listeners[0]({
      source: child,
      origin: ORIGIN,
      data: { type: 'arcgis:auth:requestCredential' },
    });
    await settle();
    expect(child.postMessage).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'arcgis:auth:error' }),
      ORIGIN,
    );
  });

  it('without a token, frames the app as before so it can sign in itself', async () => {
    const { frames, listeners } = runLaunchPage(
      'mining-inspection',
      jest.fn(() => json(401, {})),
    );
    await settle();
    expect(frames[0].src).toBe(`${ORIGIN}/mining-inspection-mapping/`);
    expect(listeners).toHaveLength(0);
  });

  it("posts the token to the school app's own endpoint, then opens it", async () => {
    const fetchMock = jest
      .fn()
      .mockImplementationOnce(() => json(200, CREDENTIAL))
      .mockImplementationOnce(() => json(204, null));
    const { frames, replace } = runLaunchPage('school-demand', fetchMock);
    await settle();

    expect(fetchMock).toHaveBeenLastCalledWith(
      '/school/api/auth/portal-token',
      expect.objectContaining({
        method: 'POST',
        credentials: 'include',
        body: JSON.stringify({ token: 'user-token' }),
      }),
    );
    expect(replace).toHaveBeenCalledWith(`${ORIGIN}/school/dashboard`);
    expect(frames).toHaveLength(0);
  });

  it('still opens the school app when either token step fails', async () => {
    const noToken = runLaunchPage(
      'school-demand',
      jest.fn(() => json(401, {})),
    );
    await settle();
    expect(noToken.replace).toHaveBeenCalledWith(`${ORIGIN}/school/dashboard`);

    const rejected = runLaunchPage(
      'school-demand',
      jest
        .fn()
        .mockImplementationOnce(() => json(200, CREDENTIAL))
        .mockImplementationOnce(() => Promise.reject(new Error('offline'))),
    );
    await settle();
    expect(rejected.replace).toHaveBeenCalledWith(`${ORIGIN}/school/dashboard`);
  });
});
