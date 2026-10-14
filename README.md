# runtime-config-service

Small NestJS API that serves centrally managed runtime configuration to frontend applications.
Consumers can change app names, labels, ArcGIS item IDs, organization details, and related values
without rebuilding or redeploying those frontends.

The first consumer is **education-mapping**. The service also stores HARM-01
**Runtime Config V1** documents for additional applications (population, trade,
land, disaster, health, infrastructure) without requiring Education Mapping to
migrate.

**Contract source of truth:** HARM-01 Runtime Config V1
(`docs/runtime-config-harmonized-contract.md` in the multi-app workspace).

This milestone includes: read-only public config lookup, admin management APIs
with JWT authentication, immutable configuration audit history, Prisma/PostgreSQL,
CORS allowlist, seeding, Swagger, and structural validation for the harmonized V1
document shape.

## Local setup

1. Install dependencies:

```bash
npm install
```

2. Copy environment template and fill in values:

```bash
cp .env.example .env
```

3. Ensure PostgreSQL is running and `DATABASE_URL` points at an empty database
   (for example `runtime_config`).

4. Generate the Prisma client, apply migrations, and seed:

```bash
npm run prisma:generate
npm run prisma:migrate:deploy
npm run prisma:seed
```

For local iterative schema work you can also use:

```bash
npm run prisma:migrate
```

5. Start the API in development mode:

```bash
npm run start:dev
```

## Environment variables

| Variable | Required | Description |
| --- | --- | --- |
| `DATABASE_URL` | Yes | PostgreSQL connection string for Prisma |
| `PORT` | No | HTTP port (default `3000`) |
| `ALLOWED_ORIGINS` | Yes for browsers | Comma-separated CORS allowlist |
| `JWT_SECRET` | Yes | High-entropy JWT signing secret (≥ 32 chars) |
| `JWT_EXPIRES_IN` | No | Access token lifetime (default `1h`) |
| `PORTAL_CREDENTIAL_ENCRYPTION_KEY` | Yes | 32-byte key (base64 or hex) encrypting stored portal passwords |
| `PORTAL_TOKEN_EXPIRATION_MINUTES` | No | Lifetime of broker-issued portal tokens (default `60`) |
| `APP_LOGIN_PORTAL_HOST` | No | Portal credential key users sign in against (default `gh`) |
| `APP_SESSION_MINUTES` | No | App sign-in session lifetime (default `480`) |
| `PORTAL_PROXY_CACHE_MB` | No | Memory for cached static portal files in the proxy (default `64`, `0` = off) |
| `MONITOR_*` | No | Status monitor and email alerts, see [Status monitor](#status-monitor) |

Example:

```env
DATABASE_URL=postgresql://USER:PASSWORD@localhost:5432/runtime_config?schema=public
PORT=3000
ALLOWED_ORIGINS=https://education.example.com,http://localhost:5173
JWT_SECRET=replace-with-a-long-random-secret-at-least-32-chars
JWT_EXPIRES_IN=1h
```

Never commit a real `.env` file or credentials.

## Prisma commands

```bash
# Validate schema
npm run prisma:validate

# Generate Prisma Client
npm run prisma:generate

# Create/apply migrations during development
npm run prisma:migrate

# Apply existing migrations (CI / production)
npm run prisma:migrate:deploy

# Seed initial application data
npm run prisma:seed
```

## Seed process

Seed source of truth for education-mapping config:

`prisma/seed-data/education-mapping.config.json`

That file is a copy of Education Mapping's working `public/config.json`.
The seed upserts:

- `key`: `education-mapping`
- `name`: `Education Mapping`
- `config`: contents of the JSON file above

To refresh the seed payload after Education Mapping config changes, copy the
updated `public/config.json` over `prisma/seed-data/education-mapping.config.json`
and run `npm run prisma:seed` again.

## Development

```bash
npm run start:dev
```

## Production build / start

```bash
npm run build
npm run start:prod
```

Typical deploy sequence:

```bash
npm ci
npm run prisma:generate
npm run prisma:migrate:deploy
npm run prisma:seed
npm run build
npm run start:prod
```

## API documentation (Swagger)

Interactive OpenAPI docs are available when the service is running:

```text
http://localhost:<PORT>/api/docs
```

With the default port:

```text
http://localhost:3000/api/docs
```

OpenAPI JSON is served at:

```text
http://localhost:<PORT>/api/docs-json
```

## API endpoints

### `GET /health`

Deployment health check.

```bash
curl http://localhost:3000/health
```

### `GET /api/v1/config/:appKey`

Returns the application's `config` JSON **directly** (no wrapper) when the
application exists and is active.
Returns `404` when the application key does not exist **or** is inactive.
Does not expose database metadata (`id`, `createdAt`, `updatedAt`, etc.).
Unknown fields and `extensions` are returned exactly as stored.

Example:

```bash
curl http://localhost:3000/api/v1/config/education-mapping
```

## Runtime Config V1 document (HARM-01)

Stored as a single JSON document per application (`Application.config`).
Validation is structural: sections are checked **when present**; Education-only
sections are **not** required for every application. The submitted document is
**not mutated** on write.

### COMMON CONFIG

Optional/recommended sections shared across applications:

| Section | Notes |
| --- | --- |
| `app` | name, shortName, description, eyebrow, homeTitle, homeLead, tagline, hero, documentTitle |
| `organization` | name, legalName, copyrightYear |
| `contact` | heading, email, agency, phone, phoneLabel |
| `footer` | blurb; optional `quickLinks[]` `{ label, to }` |
| `legal` | keyed pages: disclaimer / privacy / terms / accessibility (`title`, `body[]`) |
| `modules` | catalog: `modules[].apps[]` (not `solutions`) |

Hero imagery stays on `app.hero` (not moved under branding).

### OPTIONAL CONFIG

| Section / field | Notes |
| --- | --- |
| `branding` | `logo`, `favicon` only |
| `app.documentTitle` | browser tab title |
| `footer.quickLinks` | footer nav links |
| `modules[].hidden` | hide module from published nav |
| `apps[].portalHostKey` | deploy-time host map key |
| `apps[].externalUrl` | required when `kind` is `external` |
| `apps[].localShellPath` | required when `kind` is `localShell` |
| `apps[].published` | optional publish flag |
| `kind` | `experience` \| `dashboard` \| `survey123` \| `external` \| `localShell` |

`portalItemId` is required when `kind` is `experience`, `dashboard`, or
`survey123`. The API does **not** construct ArcGIS URLs.

### EXTENSIONS

```json
"extensions": { "<topic>": { "...": "app-owned opaque fields" } }
```

- Top-level `extensions` must be an object when present.
- Nested properties are opaque; the backend does **not** strip them.
- No plugin registry or per-app schema tables in V1.

### DEPLOYMENT CONFIG (outside this service)

Not stored in Runtime Config: `PORTAL_URL`, partner portal bases, proxy maps,
`PUBLIC_ORIGIN`, CORS origins, Vite/build ports, Runtime Config API base URL
wired into consumers.

### SECRETS

**Runtime Config is NOT a secret store.** Do not put passwords, JWT secrets,
database credentials, ArcGIS/OAuth client secrets, or portal/partner tokens in
config documents.

### Admin authentication

Admin management uses **local AdminUser accounts** and **short-lived JWT**
access tokens (Argon2id password hashes). There is **no public registration**
and **no refresh tokens** in V1.

#### Environment

| Variable | Required | Description |
| --- | --- | --- |
| `JWT_SECRET` | Yes | High-entropy secret (≥ 32 chars). Never commit a real value. |
| `JWT_EXPIRES_IN` | No | Access token lifetime (default `1h`) |

Generate a secret:

```bash
node -e "console.log(require('crypto').randomBytes(48).toString('hex'))"
```

Production must use HTTPS for login and admin calls.

#### Create an administrator (CLI)

```bash
npm run admin:create -- --email admin@example.com
```

You will be prompted for a password (hidden when a TTY is available).
Password minimum length is **12**.

Less preferred (may appear in shell history):

```bash
npm run admin:create -- --email admin@example.com --password 'your-long-password'
```

#### Login

```bash
curl -X POST http://localhost:3000/api/v1/auth/login \
  -H "Content-Type: application/json" \
  -d "{\"email\":\"admin@example.com\",\"password\":\"your-long-password\"}"
```

Response:

```json
{
  "accessToken": "...",
  "tokenType": "Bearer",
  "expiresIn": 3600
}
```

Login is rate-limited (~5 attempts / minute / IP).

#### Protected admin endpoints

All `/api/v1/admin/**` routes require:

```http
Authorization: Bearer <accessToken>
```

| Method | Path | Purpose |
| --- | --- | --- |
| `GET` | `/api/v1/admin/applications` | List registry metadata (no config) |
| `GET` | `/api/v1/admin/applications/:appKey` | Detail including config |
| `POST` | `/api/v1/admin/applications` | Create application |
| `PATCH` | `/api/v1/admin/applications/:appKey` | Update `name` / `isActive` only |
| `PUT` | `/api/v1/admin/applications/:appKey/config` | Replace config document |
| `GET` | `/api/v1/admin/audit-logs` | Platform-wide configuration audit history |
| `GET` | `/api/v1/admin/applications/:appKey/audit-logs` | Per-application audit history |

`appKey` is immutable after creation. Soft-disable apps with `isActive: false`
instead of deleting them.

Every admin request re-checks that the AdminUser still exists and
`isActive=true` (JWT alone is not enough).

#### Configuration audit history

Mutating admin operations write an **append-only** `ApplicationAuditLog` row in
the **same database transaction** as the application write. There is never a
committed configuration change without its audit record (and vice versa).

Recorded actions:

| Action | Trigger |
| --- | --- |
| `APPLICATION_CREATED` | `POST /applications` |
| `APPLICATION_METADATA_UPDATED` | `PATCH` when `name` changes (or `name` + `isActive`) |
| `APPLICATION_ACTIVATED` | `PATCH` when only `isActive` flips to `true` |
| `APPLICATION_DEACTIVATED` | `PATCH` when only `isActive` flips to `false` |
| `APPLICATION_CONFIG_REPLACED` | `PUT .../config` |

GET endpoints (public config, admin list/detail, audit reads) do **not** create
audit rows. Login events are not audited.

Each row stores:

- `applicationKey` and `actorEmail` snapshots (survive renames / email changes)
- nullable `applicationId` / `actorId` foreign keys (`ON DELETE SET NULL`)
- JSON `before` / `after` snapshots (no passwords, JWTs, or secrets)
- no `updatedAt` — rows are never patched or deleted via API

History is **not** backfilled for applications that existed before audit
logging shipped (for example `education-mapping` starts empty until the next
mutation).

Audit list filters (global): `applicationKey`, `action`, `actorEmail`,
`dateFrom`, `dateTo`, plus `page` / `limit` (default `page=1`, `limit=20`,
max `limit=100`). Ordering is newest first (`createdAt DESC`, `id DESC`).

Per-application history supports the same filters except `applicationKey`
(taken from the path). Unknown `appKey` → `404`; existing app with no rows →
`200` with `items: []`.

There is no restore/rollback endpoint, no persisted diff column, and no audit
edit/delete API in this milestone.

#### Swagger Authorize

1. Open `http://localhost:<PORT>/api/docs`
2. `POST /api/v1/auth/login`
3. Click **Authorize**
4. Paste the `accessToken` as a Bearer token
5. Call Admin Applications / Admin Audit endpoints

## Portal access for the mapping apps

The static mapping apps (`EA Apps/*-app`, built with `npm run build:static`)
have no backend of their own. This service gives them sign-in and portal
access. The full design is in `EA Apps/docs/architecture.md`.

### Portal credentials and the token broker

Admins store one service account per portal host key (`gh`, `gh2`, `rbc`,
`rdb`, …) under `/api/v1/admin/portal-credentials`. Passwords are encrypted with
`PORTAL_CREDENTIAL_ENCRYPTION_KEY` and never returned.

`POST /api/v1/portal-auth/token` `{ appKey, portalHostKey }` issues a
short-lived token. It requires an allowed `Origin`, an active app whose config
references that host, and an active credential. Tokens are cached until 60 s
before expiry and are bound to the caller's origin. The broker is limited to
30 calls per minute.

### App sign-in

| Method | Path | Purpose |
| --- | --- | --- |
| `POST` | `/api/v1/app-auth/login` | `{ appKey, username, password }`: verifies the user's own portal account on `APP_LOGIN_PORTAL_HOST`, discards that token, sets HttpOnly `rc_app_session_<appKey>` (Path `/api/v1/`, SameSite=Lax) |
| `GET` | `/api/v1/app-auth/session?appKey=` | Current session or `401` |
| `POST` | `/api/v1/app-auth/logout?appKey=` | Clears that app's session (all, without `appKey`) |

### Portal proxy

`ALL /api/v1/portal-proxy/<appKey>/<hostKey>/<path on the portal origin>`
requires the app session. It attaches a broker token server-side, rewrites
portal URLs back to the proxy, and scrubs the token from bodies and `Location`.
It refuses a foreign `Origin` and blocks sign-in, admin and content-changing
operations (`BLOCKED_PATH` in `portal-proxy.rewrite.ts`). Static portal files
are cached, with browser cache headers, brotli/gzip compression and an
in-memory LRU. StoryMap links are left unproxied.

`gis.rbc.gov.rw` has an expired certificate. `src/portal/portal-fetch.ts` pins
an exception for that one certificate fingerprint until 2026-11-15. Remove it
once RBC renews.

### Shared typography

`GET /api/v1/theme/typography.css` renders the `shared-theme` application's
`branding.typography` as CSS. `GET /api/v1/config/:appKey` merges it under each
app's own `branding.typography`. See `EA Apps/docs/typography.md`.

## Status monitor

`src/monitoring/` checks, on a schedule, the database, each app URL, TLS
certificates, each portal, token issuance per (app, host) and every configured
dashboard, experience and Survey123 item. Results appear on the admin console's
**Status** page and are stored in `MonitorRun` / `MonitorCheckResult`.
Optional email alerts are sent when a check turns red (2 failures in a row),
recovers, or a certificate nears expiry.

| Method | Path (all require admin JWT) | Purpose |
| --- | --- | --- |
| `GET` | `/api/v1/admin/monitoring/status` | Latest result per check, uptime, settings |
| `GET` | `/api/v1/admin/monitoring/history?checkType=&targetKey=&hours=` | One check over time (≤ 168 h) |
| `POST` | `/api/v1/admin/monitoring/run` | Start a run now (`202`; `409` if running; 3/min) |
| `POST` | `/api/v1/admin/monitoring/test-alert` | Send a test email (`400` not configured, `502` SMTP failure) |

Settings (`MONITOR_ENABLED`, `MONITOR_APP_URLS`, `MONITOR_SMTP_*`, …) are
documented in `.env.example`. How to read the page and act on red checks is in
`EA Apps/docs/monitoring.md`.

## How Education Mapping will connect

Education Mapping currently loads `public/config.json` at runtime.
Later it can fetch the same document from this service instead:

```ts
const response = await fetch(
  `${import.meta.env.VITE_RUNTIME_CONFIG_URL}/api/v1/config/education-mapping`,
);
const config = await response.json();
```

Ensure the Education Mapping origin is included in `ALLOWED_ORIGINS`.

## Tests

```bash
npm test
npm run test:e2e
```

Covered cases:

- existing app returns config
- unknown app returns 404
- response does not expose Application DB metadata
- invalid `appKey` is rejected
- health endpoint returns ok
- HARM-01 Education / Population / Health fixtures validate and round-trip
- additive fields (`branding`, `quickLinks`, `extensions`, extra kinds) accepted
- malformed sections rejected when present
- Education Mapping documents remain valid without branding/extensions

## Out of scope (later milestones)

- refresh tokens / password reset email
- OAuth / OIDC / GeoHub login for admins
- multiple roles / application-level ACL
- DELETE application
- configuration restore / rollback from audit snapshots
- audit retention / archive jobs
- login audit
- Redis / queues / microservice transport
