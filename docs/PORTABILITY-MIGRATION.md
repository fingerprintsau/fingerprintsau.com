# Manus portability migration plan

This document covers the remaining portability work identified in `docs/NOTES.md`:

- Replace the Manus maps proxy with **Google Maps Platform** or **Mapbox**.
- Replace legacy OAuth/session behavior with standard **OIDC/OAuth 2.0** and an application-owned session.
- Replace configured provider presigning and `/manus-storage/` redirects with **AWS S3 presigned URLs**.

The recommended architecture is: use a standards-based OIDC provider for identity, keep only an opaque session ID in a secure cookie, keep S3 objects private by default, and issue short-lived signed URLs from the server.

## 1. Maps: replace the Manus proxy

### Current coupling

| Current file | Current behavior | Replacement |
|---|---|---|
| `server/_core/map.ts` | Sends Google Maps REST requests to `BUILT_IN_FORGE_API_URL/v1/maps/proxy` and uses the Forge key as the Google key. | Delete the Forge URL/key dependency. Use a server-side Google key or Mapbox server token only for server REST calls. |
| `client/src/components/Map.tsx` | Loads the Maps JavaScript bundle from the Forge proxy and uses `VITE_FRONTEND_FORGE_API_KEY`. | Load Google Maps directly with `@googlemaps/js-api-loader`, or replace the component with Mapbox GL JS. |
| `server/_core/env.ts` | Exposes `forgeApiUrl` and `forgeApiKey` for maps and other services. | Add provider-specific variables. |
| `client/src/components/Map.tsx` | Uses a hard-coded `DEMO_MAP_ID`. | Set a real Google Map ID through configuration, or omit it for a basic map. |

### Option A: Google Maps Platform (lowest application-code change)

Install the loader and keep the existing Google-shaped types:

```bash
npm install @googlemaps/js-api-loader
```

Add environment variables:

```dotenv
# Server-side Google Maps Web Services key; never expose this to the browser.
GOOGLE_MAPS_SERVER_API_KEY=
# Browser key restricted by HTTP referrer to the production origins.
VITE_GOOGLE_MAPS_BROWSER_API_KEY=
# Optional Google Cloud Map ID for Advanced Markers.
VITE_GOOGLE_MAPS_MAP_ID=
```

Replace the proxy loader in `client/src/components/Map.tsx`:

```tsx
import { importLibrary, setOptions } from "@googlemaps/js-api-loader";

let mapsConfigured = false;

async function loadGoogleMaps() {
  if (!mapsConfigured) {
    const key = import.meta.env.VITE_GOOGLE_MAPS_BROWSER_API_KEY;
    if (!key) throw new Error("Maps are not configured");
    setOptions({
      key,
      v: "weekly",
      authReferrerPolicy: "origin",
    });
    mapsConfigured = true;
  }

  const [{ Map }, { AdvancedMarkerElement }] = await Promise.all([
    importLibrary("maps") as Promise<google.maps.MapsLibrary>,
    importLibrary("marker") as Promise<google.maps.MarkerLibrary>,
  ]);
  return { Map, AdvancedMarkerElement };
}

// Inside MapView's init callback:
const { Map } = await loadGoogleMaps();
const instance = new Map(mapContainer.current, {
  zoom: initialZoom,
  center: initialCenter,
  mapId: import.meta.env.VITE_GOOGLE_MAPS_MAP_ID || undefined,
});
map.current = instance;
onMapReady?.(instance);
```

The Google browser key is not a secret in the same sense as a server credential, but it must be restricted in Google Cloud Console to the production origins and only the required APIs. Enable only Maps JavaScript API, Places/Geocoding if used, and any required Routes API. Do not put `GOOGLE_MAPS_SERVER_API_KEY` in a `VITE_` variable.

Replace `server/_core/map.ts` configuration and REST URL construction:

```ts
import { ENV } from "./env";

function mapsUrl(path: string, params: Record<string, string | number | undefined>) {
  const key = ENV.googleMapsServerApiKey;
  if (!key) throw new Error("Maps are not configured");

  const url = new URL(`https://maps.googleapis.com${path}`);
  url.searchParams.set("key", key);
  for (const [name, value] of Object.entries(params)) {
    if (value !== undefined) url.searchParams.set(name, String(value));
  }
  return url;
}

export async function makeRequest<T>(
  endpoint: string,
  params: Record<string, unknown> = {},
): Promise<T> {
  const response = await fetch(mapsUrl(endpoint, params as Record<string, string>));
  if (!response.ok) {
    console.error("[Maps] request failed", response.status);
    throw new Error("Maps request failed");
  }
  return response.json() as Promise<T>;
}
```

Update `server/_core/env.ts`:

```ts
  googleMapsServerApiKey: process.env.GOOGLE_MAPS_SERVER_API_KEY ?? "",
```

For server calls, use the current Google Maps Web Services endpoint for the specific API rather than the old proxy-shaped paths. Keep the existing public `makeRequest` interface temporarily so callers can migrate incrementally.

### Option B: Mapbox GL JS

Choose Mapbox instead if the product needs a strongly customizable map style, vector tiles, or Mapbox geocoding. Install:

```bash
npm install mapbox-gl
```

Add:

```dotenv
# Public token, restricted by allowed URLs and minimum scopes.
VITE_MAPBOX_PUBLIC_TOKEN=
# Secret token only for server-side Mapbox APIs.
MAPBOX_SECRET_TOKEN=
```

A minimal replacement component is:

```tsx
import mapboxgl from "mapbox-gl";
import "mapbox-gl/dist/mapbox-gl.css";
import { useEffect, useRef } from "react";

export function MapView({ className, initialCenter, initialZoom = 12, onMapReady }: MapViewProps) {
  const element = useRef<HTMLDivElement>(null);
  const map = useRef<mapboxgl.Map>();

  useEffect(() => {
    if (!element.current) return;
    mapboxgl.accessToken = import.meta.env.VITE_MAPBOX_PUBLIC_TOKEN;
    const instance = new mapboxgl.Map({
      container: element.current,
      style: "mapbox://styles/mapbox/streets-v12",
      center: [initialCenter.lng, initialCenter.lat],
      zoom: initialZoom,
    });
    map.current = instance;
    instance.once("load", () => onMapReady?.(instance as unknown as google.maps.Map));
    return () => instance.remove();
  }, [initialCenter.lat, initialCenter.lng, initialZoom, onMapReady]);

  return <div ref={element} className={cn("w-full h-[500px]", className)} />;
}
```

For a clean implementation, change `MapViewProps.onMapReady` to a provider-neutral interface instead of casting to `google.maps.Map`. Mapbox public tokens are intended for browser use; restrict them by URL and least-privilege scopes. Never expose a Mapbox secret token.

### Maps migration sequence

1. Add provider-specific environment variables and billing/usage alerts.
2. Add contract tests around geocoding and map initialization; mock HTTP responses, never call paid APIs in tests.
3. Ship the Google or Mapbox client behind `MAP_PROVIDER=google|mapbox`.
4. Migrate consumers of `makeRequest` one endpoint at a time.
5. Remove `VITE_FRONTEND_FORGE_API_URL`, `VITE_FRONTEND_FORGE_API_KEY`, `BUILT_IN_FORGE_API_URL`, and `BUILT_IN_FORGE_API_KEY` from map code only after all other Forge-backed features have their own adapters.
6. Remove proxy references from `server/_core/map.ts`, `client/src/components/Map.tsx`, and `docs/NOTES.md`.

Google's official loader supports runtime `importLibrary()` so only the required libraries load. Mapbox requires public browser tokens and recommends URL restrictions and minimal scopes.

## 2. Login and sessions: replace legacy OAuth

### Recommended target

Use an external OIDC provider that supports Authorization Code + PKCE, such as Auth0, Amazon Cognito, Keycloak, or another standards-compliant provider. The application should:

1. Redirect the browser to the provider's authorization endpoint.
2. Generate a one-time `state` and PKCE `code_verifier`.
3. Store state/verifier server-side or in a short-lived, signed, `HttpOnly` cookie.
4. Exchange the callback code on the server.
5. Validate the ID token issuer, audience, signature, nonce, and timestamps.
6. Upsert the local user by stable provider subject (`iss + sub`).
7. Create an application-owned session row.
8. Set only an opaque `__Host-session` cookie.

Do not put access tokens, refresh tokens, or user objects in `localStorage`. The current `client/src/_core/hooks/useAuth.ts` writes `legacy runtime user info` to local storage and removes `legacy session token`; both should disappear in the target implementation.

### Database changes

Add provider accounts and server-side sessions. Preserve existing users and link the old identity during the cutover:

```ts
export const oauthAccounts = mysqlTable("oauthAccounts", {
  id: int("id").autoincrement().primaryKey(),
  userId: int("userId").notNull(),
  issuer: varchar("issuer", { length: 255 }).notNull(),
  subject: varchar("subject", { length: 255 }).notNull(),
  email: varchar("email", { length: 320 }),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
}, (table) => ({
  providerSubjectUnique: uniqueIndex("oauthAccounts_issuer_subject_unique")
    .on(table.issuer, table.subject),
  userIdx: index("oauthAccounts_user_idx").on(table.userId),
}));

export const sessions = mysqlTable("sessions", {
  id: varchar("id", { length: 64 }).primaryKey(), // hash, never the raw cookie value
  userId: int("userId").notNull(),
  expiresAt: timestamp("expiresAt").notNull(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  lastSeenAt: timestamp("lastSeenAt").defaultNow().notNull(),
  revokedAt: timestamp("revokedAt"),
  userAgentHash: varchar("userAgentHash", { length: 128 }),
}, (table) => ({
  userIdx: index("sessions_user_idx").on(table.userId),
  expiryIdx: index("sessions_expiry_idx").on(table.expiresAt),
}));

export const oauthStates = mysqlTable("oauthStates", {
  hash: varchar("hash", { length: 64 }).primaryKey(),
  redirectPath: varchar("redirectPath", { length: 512 }).notNull(),
  expiresAt: timestamp("expiresAt").notNull(),
  consumedAt: timestamp("consumedAt"),
});
```

Use the project's existing `users` table as the local authorization source. Roles, plan, credits, listings, and ownership remain local and are never read from provider claims except for initial identity/email mapping.

### Server-side session helpers

The project already has `jose`; use it only for short-lived signed state or a random session identifier, not as a long-lived self-contained user authorization token. A practical session helper is:

```ts
import { createHash, randomBytes } from "node:crypto";

function rawSessionId() {
  return randomBytes(32).toString("base64url");
}
function sessionHash(raw: string) {
  return createHash("sha256").update(raw).digest("hex");
}

export async function createSession(userId: number, req: Request, res: Response) {
  const raw = rawSessionId();
  await db.insertSession({
    id: sessionHash(raw),
    userId,
    expiresAt: new Date(Date.now() + 1000 * 60 * 60 * 24 * 30),
    userAgentHash: hashUserAgent(req.get("user-agent") ?? ""),
  });
  res.cookie("__Host-session", raw, {
    httpOnly: true,
    secure: true,
    sameSite: "lax",
    path: "/",
    maxAge: 60 * 60 * 24 * 30,
  });
}

export async function getAuthenticatedUser(req: Request) {
  const raw = req.cookies?.["__Host-session"];
  if (!raw) return null;
  const session = await db.getSessionByHash(sessionHash(raw));
  if (!session || session.revokedAt || session.expiresAt <= new Date()) return null;
  await db.touchSession(session.id);
  return db.getUserById(session.userId);
}
```

Set `SameSite=Lax` or `Strict` and always set `Secure` and `HttpOnly` in production. Add CSRF protection for state-changing requests if the application accepts cross-site requests. Use a `__Host-` cookie with `Path=/` and no `Domain`.

### OAuth start/callback replacement

Replace `server/_core/oauth.ts` and `server/_core/sdk.ts` with an OIDC adapter. The exact library may vary by provider; the flow must be equivalent to:

```ts
// Pseudocode using an OIDC discovery client.
app.get("/auth/login", async (req, res) => {
  const state = randomBytes(24).toString("base64url");
  const verifier = randomBytes(32).toString("base64url");
  const challenge = base64url(sha256(verifier));

  await db.insertOAuthState({
    hash: sha256(state),
    redirectPath: safeRedirect(req.query.returnTo),
    expiresAt: new Date(Date.now() + 10 * 60 * 1000),
  });
  res.cookie("__Host-oauth-state", `${state}.${verifier}`, {
    httpOnly: true, secure: true, sameSite: "lax", path: "/", maxAge: 600,
  });

  const url = new URL(ENV.oidcAuthorizationEndpoint);
  url.searchParams.set("client_id", ENV.oidcClientId);
  url.searchParams.set("redirect_uri", ENV.oidcRedirectUri);
  url.searchParams.set("response_type", "code");
  url.searchParams.set("scope", "openid profile email");
  url.searchParams.set("state", state);
  url.searchParams.set("code_challenge", challenge);
  url.searchParams.set("code_challenge_method", "S256");
  res.redirect(url.toString());
});

app.get("/api/auth/callback", async (req, res) => {
  const code = stringParam(req.query.code);
  const state = stringParam(req.query.state);
  const stateCookie = req.cookies?.["__Host-oauth-state"];
  const [cookieState, verifier] = stateCookie?.split(".") ?? [];
  if (!code || !state || state !== cookieState || !verifier) {
    return res.status(400).send("Invalid sign-in response");
  }

  const stored = await db.consumeOAuthState(sha256(state));
  if (!stored) return res.status(400).send("Expired sign-in response");

  const tokens = await exchangeCode(code, verifier); // server-to-provider HTTPS call
  const claims = await validateIdToken(tokens.id_token);
  const user = await upsertUserFromOIDC({
    issuer: claims.iss,
    subject: claims.sub,
    email: claims.email,
    name: claims.name,
  });
  await createSession(user.id, req, res);
  res.clearCookie("__Host-oauth-state", { path: "/" });
  res.redirect(stored.redirectPath);
});
```

Validate the ID token against the provider's JWKS, and verify `iss`, `aud`, `exp`, `iat`, and `nonce`. Use the provider's official SDK when available rather than hand-rolling token validation.

### Client changes

- Replace `client/src/const.ts:startLogin` with `window.location.href = "/auth/login?returnTo=" + encodeURIComponent(path)`.
- Remove `old provider app identifier`, `old provider portal URL`, and all `legacy session token`/`legacy runtime user info` behavior.
- Keep `useAuth()` calling `trpc.auth.me`; the hook can remain structurally similar because the browser only needs the session-backed `me` query.
- Keep logout as a server mutation that revokes the current session and clears `__Host-session`.
- Update `server/_core/context.ts` to call `getAuthenticatedUser(req)` instead of `legacy session resolver(req)`.
- Remove legacy scheduled-task branches from `sdk.ts`; if background jobs remain, use a separate internal service credential or signed job token, not a user login token.

### Auth cutover sequence

1. Add `oauthAccounts`, `sessions`, and `oauthStates` migrations.
2. Add the new `/auth/login`, callback, logout, and session lookup routes alongside legacy authentication.
3. Add a feature flag `AUTH_PROVIDER=oidc` and write contract tests for both paths.
4. Link existing users by an explicit one-time migration. Do not guess account matches solely by email without a verified provider claim.
5. Switch the client login entry point to `/auth/login`.
6. Monitor callback errors, session creation, logout, and protected tRPC access.
7. Revoke/expire legacy sessions and remove legacy authentication code only after the migration window.
8. Remove `old provider server URL`, `old provider app identifier`, legacy provider types, `server/_core/oauth.ts`, and legacy provider branches from `sdk.ts`.

## 3. Storage: replace configured provider with AWS S3

### Current coupling

| Current file | Current behavior | Replacement |
|---|---|---|
| `server/storage.ts` | Calls Forge `v1/storage/presign/put|get|delete`, then returns `/manus-storage/{key}`. | Use `S3Client`, `PutObjectCommand`, `GetObjectCommand`, `DeleteObjectCommand`, and `getSignedUrl`. |
| `server/_core/storageProxy.ts` | Converts `/manus-storage/{key}` to a Forge-signed redirect. | Remove it or replace it with an ownership-checked `/storage/:key` download route. |
| `server/_core/index.ts` | Registers the Manus storage proxy. | Register the new S3 route only if private object URLs are not returned directly. |
| `server/_core/env.ts` | Uses Forge URL/key. | Use S3 endpoint, region, bucket, access key, secret, and public URL/CDN settings. |
| Database rows | Existing image/file URLs contain `/manus-storage/`. | Dual-read during migration, then rewrite keys/URLs to S3. |

### Environment variables

```dotenv
AWS_REGION=ap-southeast-2
AWS_S3_BUCKET=
AWS_ACCESS_KEY_ID=
AWS_SECRET_ACCESS_KEY=
# Optional for LocalStack, MinIO, or another S3-compatible provider.
AWS_S3_ENDPOINT=
# Optional CDN or public object base URL for public listing images.
AWS_S3_PUBLIC_BASE_URL=
# Seconds for private download URLs.
AWS_S3_SIGNED_URL_TTL=900
```

Prefer an IAM role or workload identity in production over long-lived access keys. If keys are unavoidable, scope them to this bucket and the required prefixes.

### S3 client implementation

The project already includes the AWS SDK packages needed for this refactor. Replace `server/storage.ts` with an adapter like:

```ts
import {
  DeleteObjectCommand,
  GetObjectCommand,
  PutObjectCommand,
  S3Client,
} from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { randomUUID } from "node:crypto";
import { ENV } from "./_core/env";

const s3 = new S3Client({
  region: ENV.awsRegion,
  endpoint: ENV.awsS3Endpoint || undefined,
  forcePathStyle: Boolean(ENV.awsS3Endpoint),
  credentials: ENV.awsAccessKeyId && ENV.awsSecretAccessKey
    ? { accessKeyId: ENV.awsAccessKeyId, secretAccessKey: ENV.awsSecretAccessKey }
    : undefined,
});

function normalizeKey(key: string) {
  const normalized = key.replace(/^\/+/, "");
  if (!normalized || normalized.includes("..") || normalized.includes("\\")) {
    throw new Error("Invalid storage key");
  }
  return normalized;
}

function uniqueKey(relKey: string) {
  const key = normalizeKey(relKey);
  const dot = key.lastIndexOf(".");
  return dot === -1
    ? `${key}-${randomUUID()}`
    : `${key.slice(0, dot)}-${randomUUID()}${key.slice(dot)}`;
}

export async function storagePut(
  relKey: string,
  data: Buffer | Uint8Array | string,
  contentType = "application/octet-stream",
) {
  const key = uniqueKey(relKey);
  await s3.send(new PutObjectCommand({
    Bucket: ENV.awsS3Bucket,
    Key: key,
    Body: data,
    ContentType: contentType,
    ServerSideEncryption: "AES256",
  }));
  return { key, url: publicUrl(key) };
}

export async function storageGetSignedUrl(relKey: string) {
  const key = normalizeKey(relKey);
  return getSignedUrl(s3, new GetObjectCommand({
    Bucket: ENV.awsS3Bucket,
    Key: key,
  }), { expiresIn: ENV.awsSignedUrlTtl });
}

export async function storageDelete(relKey: string) {
  await s3.send(new DeleteObjectCommand({
    Bucket: ENV.awsS3Bucket,
    Key: normalizeKey(relKey),
  }));
  return true;
}

function publicUrl(key: string) {
  if (ENV.awsS3PublicBaseUrl) {
    return `${ENV.awsS3PublicBaseUrl.replace(/\/+$/, "")}/${encodeURI(key)}`;
  }
  // Do not expose a raw private bucket URL. Callers should use the signed URL.
  return `/storage/${encodeURIComponent(key)}`;
}
```

Add the corresponding fields to `server/_core/env.ts`:

```ts
  awsRegion: process.env.AWS_REGION ?? "ap-southeast-2",
  awsS3Bucket: process.env.AWS_S3_BUCKET ?? "",
  awsS3Endpoint: process.env.AWS_S3_ENDPOINT ?? "",
  awsAccessKeyId: process.env.AWS_ACCESS_KEY_ID ?? "",
  awsSecretAccessKey: process.env.AWS_SECRET_ACCESS_KEY ?? "",
  awsS3PublicBaseUrl: process.env.AWS_S3_PUBLIC_BASE_URL ?? "",
  awsSignedUrlTtl: Number(process.env.AWS_S3_SIGNED_URL_TTL ?? 900),
```

For public listing images, use a dedicated CDN/public prefix with an explicit cache policy, or expose a short-lived signed URL through a server route. For private seller documents, always use signed URLs and never put the AWS secret in browser code.

### Ownership-checked download route

If objects remain private, replace the Manus proxy with an application route that checks the database owner before signing:

```ts
app.get("/storage/:key(*)", async (req, res) => {
  const key = decodeURIComponent(req.params.key);
  const user = await getAuthenticatedUser(req);
  const file = await db.getOwnedStorageReference(user?.id ?? null, key);
  if (!file) return res.status(404).send("Not found");

  const signed = await storageGetSignedUrl(file.storageKey);
  res.set("Cache-Control", "private, no-store");
  res.redirect(302, signed);
});
```

Do not make this route a generic arbitrary-key signer. Every key must be resolved through an ownership-aware database record. Public listing images should be handled separately through public listing authorization.

### S3 bucket and IAM baseline

- Keep Block Public Access enabled for private objects.
- Use separate prefixes: `users/{userId}/`, `listings/{listingId}/`, `office/{userId}/`.
- Grant the application only `s3:PutObject`, `s3:GetObject`, and `s3:DeleteObject` for the bucket prefixes it needs; do not grant `ListAllMyBuckets` or unrestricted bucket administration.
- Configure CORS only for the production browser origins and only the required methods/headers.
- Enforce maximum object size in the application and, for browser uploads, in the presigned POST policy or a server-side upload endpoint.
- Add checksum validation where practical. AWS notes that presigned URLs are bearer tokens, so keep them short-lived and do not log them.
- Configure lifecycle rules for abandoned multipart uploads and, if desired, old temporary objects.

### Storage migration sequence

1. Add the AWS variables and a feature flag `STORAGE_PROVIDER=manus|s3`.
2. Implement `s3Storage.ts` behind the existing `storagePut`, `storageGetSignedUrl`, and `storageDelete` interface.
3. Add unit tests with an injected S3 client mock; test key traversal rejection, ownership, content type, delete fallback, and signed URL expiry configuration.
4. Add dual-read support: if a row has a legacy `/manus-storage/` URL, use the old reader; if it has an S3 key, use S3.
5. Copy objects from Manus storage to S3 in a resumable, idempotent job. Record `sourceKey`, `destinationKey`, checksum, and migration status.
6. Update database rows to store `storageKey` and provider-neutral URLs. Do not overwrite rows until the destination checksum is verified.
7. Switch new uploads to S3 and monitor failed uploads/deletes.
8. After all legacy rows are migrated and verified, remove `registerStorageProxy`, `/manus-storage/` URL generation, Forge storage variables, and the Manus storage adapter.

## Cross-cutting validation

Before removing any Manus adapter:

- `npm test` passes with provider calls mocked.
- `npm run check` passes.
- `npm run build` passes without the Manus Vite runtime plugin.
- A fresh production process starts with only the new environment variables.
- Protected tRPC reads/writes reject missing, expired, revoked, and cross-user sessions.
- S3 file reads and deletes verify ownership on every request.
- Map keys/tokens are restricted and no server secret appears in client bundles.
- Existing listings, seller accounts, credits, and office files remain unchanged during dual-read migration.
- The old providers stay enabled until migration metrics show zero legacy traffic for an agreed observation period.

## References

- [Google Maps JavaScript API loading and dynamic `importLibrary()`](https://developers.google.com/maps/documentation/javascript/load-maps-js-api)
- [Mapbox access tokens, scopes, and URL restrictions](https://docs.mapbox.com/help/dive-deeper/access-tokens/)
- [AWS S3 presigned upload/download URLs](https://docs.aws.amazon.com/AmazonS3/latest/userguide/using-presigned-url.html)
- [RFC 7636: OAuth 2.0 PKCE](https://datatracker.ietf.org/doc/html/rfc7636)
- [OWASP Session Management Cheat Sheet](https://cheatsheetseries.owasp.org/cheatsheets/Session_Management_Cheat_Sheet.html)
