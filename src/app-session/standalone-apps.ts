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
 *
 * Crop Health is left out: it only takes a token through its sessionStorage
 * internals, and its source is not available to change.
 */
export type StandaloneApp = {
  title: string;
  /** Path on the session origin. */
  path: string;
} & (
  { handoff: 'arcgis' } | { handoff: 'token-endpoint'; tokenEndpoint: string }
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
};

export function findStandaloneApp(key: string): StandaloneApp | null {
  return Object.prototype.hasOwnProperty.call(STANDALONE_APPS, key)
    ? STANDALONE_APPS[key]
    : null;
}
