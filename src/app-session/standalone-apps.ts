/**
 * Standalone apps on the session origin that sign in to the portal themselves
 * (their own OAuth), so the portal proxy cannot help them. /api/v1/app-launch
 * opens them with the user's own portal token, handed over the way each one
 * already accepts:
 *
 * - `arcgis`: ArcGIS Maps SDK apps. The launch page frames the app with
 *   `arcgis-auth-origin` / `arcgis-auth-portal` and answers the SDK's
 *   `arcgis:auth:requestCredential` message.
 * - `token-endpoint`: apps with their own backend. The launch page posts
 *   `{ token }` to the endpoint the app's OAuth callback uses, then opens it.
 * - `session-storage`: apps that only read a session their own OAuth callback
 *   wrote to sessionStorage (Crop Health; its source is not available). The
 *   launch page writes that session, in the shape the deployed bundle reads,
 *   then opens the app in the same tab. It has no refresh token, so when the
 *   token runs out the app drops the session and asks for its own sign-in.
 *   This copies app internals: re-check the shape whenever the app is rebuilt.
 */
export type StandaloneApp = {
  title: string;
  /** Path on the session origin. */
  path: string;
} & (
  | { handoff: 'arcgis' }
  | { handoff: 'token-endpoint'; tokenEndpoint: string }
  | { handoff: 'session-storage'; storageKey: string }
);

export const STANDALONE_APPS: Readonly<Record<string, StandaloneApp>> = {
  'water-quality': {
    title: 'Water Quality Monitoring',
    path: '/water-quality/',
    handoff: 'arcgis',
  },
  'forest-health': {
    title: 'Forest Health Monitoring',
    path: '/forest-mapping/',
    handoff: 'arcgis',
  },
  'mining-inspection': {
    title: 'Mining Inspection',
    path: '/mining-inspection-mapping/',
    handoff: 'arcgis',
  },
  'school-demand': {
    title: 'Schools Demand & Demographics',
    path: '/school/dashboard',
    handoff: 'token-endpoint',
    tokenEndpoint: '/school/api/auth/portal-token',
  },
  'crop-health': {
    title: 'Crop Health Monitoring',
    path: '/crop-health/',
    handoff: 'session-storage',
    storageKey: 'crop-health:session',
  },
};

export function findStandaloneApp(key: string): StandaloneApp | null {
  return Object.prototype.hasOwnProperty.call(STANDALONE_APPS, key)
    ? STANDALONE_APPS[key]
    : null;
}
