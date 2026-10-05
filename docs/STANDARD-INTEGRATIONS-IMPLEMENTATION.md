# Standard OAuth, Google Maps, and AWS S3 implementation

This guide is tailored to the current Fingerprints repository. It provides code that can replace the legacy adapters, but it does **not** apply the provider cutover automatically because the OAuth provider, Google Cloud project, AWS account, bucket, redirect URLs, and production secrets must be chosen first.

## 0. Target environment variables

Add these to the deployment environment and `.env.example`:

```dotenv
# Authentication
AUTH_PROVIDER=oidc
OIDC_ISSUER_URL=https://your-oidc-provider.example.com
OIDC_CLIENT_ID=
OIDC_CLIENT_SECRET=
OIDC_REDIRECT_URI=https://fingerprintsau.com/api/auth/callback
AUTH_SESSION_TTL_SECONDS=2592000

# Google Maps
GOOGLE_MAPS_SERVER_API_KEY=
VITE_GOOGLE_MAPS_BROWSER_API_KEY=
VITE_GOOGLE_MAPS_MAP_ID=

# AWS S3
AWS_REGION=ap-southeast-2
AWS_S3_BUCKET=
AWS_S3_ENDPOINT=
AWS_S3_PUBLIC_BASE_URL=
AWS_S3_SIGNED_URL_TTL=900
AWS_ACCESS_KEY_ID=
AWS_SECRET_ACCESS_KEY=
```

`OIDC_CLIENT_SECRET`, `GOOGLE_MAPS_SERVER_API_KEY`, `AWS_ACCESS_KEY_ID`, and `AWS_SECRET_ACCESS_KEY` are server secrets. Never prefix them with `VITE_` and never send them to the browser. The Google browser key is intentionally public but must be restricted by HTTP referrer and API scope.

---

## 1. Standard OAuth/OIDC authentication

### 1.1 Choose the provider and register the application

Use any standards-compliant OIDC provider that supports Authorization Code + PKCE. Register:

- Redirect URI: `https://fingerprintsau.com/api/auth/callback`
- Logout return URI: `https://fingerprintsau.com/`
- Allowed origin: `https://fingerprintsau.com`
- Scopes: `openid profile email`
- A confidential web-client secret stored only on the server

For local development also register the exact local callback URI, for example `http://localhost:3000/api/auth/callback`.

### 1.2 Add database tables

Add provider identity links, one-time OAuth state, and opaque sessions to `drizzle/schema.ts`:

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
  identityUnique: uniqueIndex("oauthAccounts_issuer_subject_unique")
    .on(table.issuer, table.subject),
  userIdx: index("oauthAccounts_user_idx").on(table.userId),
}));

export const authSessions = mysqlTable("authSessions", {
  idHash: varchar("idHash", { length: 64 }).primaryKey(),
  userId: int("userId").notNull(),
  expiresAt: timestamp("expiresAt").notNull(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  lastSeenAt: timestamp("lastSeenAt").defaultNow().notNull(),
  revokedAt: timestamp("revokedAt"),
}, (table) => ({
  userIdx: index("authSessions_user_idx").on(table.userId),
  expiresIdx: index("authSessions_expires_idx").on(table.expiresAt),
}));

export const oauthStates = mysqlTable("oauthStates", {
  hash: varchar("hash", { length: 64 }).primaryKey(),
  codeVerifierHash: varchar("codeVerifierHash", { length: 64 }).notNull(),
  redirectPath: varchar("redirectPath", { length: 512 }).notNull(),
  expiresAt: timestamp("expiresAt").notNull(),
  consumedAt: timestamp("consumedAt"),
});
```

Generate and apply a migration using the repository's normal Drizzle workflow. Do not alter existing users or listings.

### 1.3 Add OIDC configuration

Extend `server/_core/env.ts`:

```ts
  authProvider: process.env.AUTH_PROVIDER ?? "oidc",
  oidcIssuerUrl: (process.env.OIDC_ISSUER_URL ?? "").replace(/\/+$/, ""),
  oidcClientId: process.env.OIDC_CLIENT_ID ?? "",
  oidcClientSecret: process.env.OIDC_CLIENT_SECRET ?? "",
  oidcRedirectUri: process.env.OIDC_REDIRECT_URI ?? "",
  authSessionTtlSeconds: Number(process.env.AUTH_SESSION_TTL_SECONDS ?? 2_592_000),
```

At startup, fail fast in production if the OIDC variables are missing. Do not silently fall back to Manus.

### 1.4 Crypto and cookie helpers

Create `server/auth/crypto.ts`:

```ts
import { createHash, randomBytes } from "node:crypto";

export function randomUrlSecret(bytes = 32) {
  return randomBytes(bytes).toString("base64url");
}

export function sha256(value: string) {
  return createHash("sha256").update(value).digest("hex");
}

export function pkceChallenge(verifier: string) {
  return createHash("sha256").update(verifier).digest("base64url");
}

export function safeReturnPath(value: unknown) {
  if (typeof value !== "string") return "/dashboard";
  if (!value.startsWith("/") || value.startsWith("//") || value.includes("\\")) return "/dashboard";
  return value;
}
```

Create `server/auth/session.ts`:

```ts
import type { Request, Response } from "express";
import { createHash, randomBytes } from "node:crypto";
import * as db from "../db";
import { ENV } from "../_core/env";

const COOKIE = "__Host-session";

function hash(value: string) {
  return createHash("sha256").update(value).digest("hex");
}

export async function createSession(userId: number, res: Response) {
  const raw = randomBytes(32).toString("base64url");
  const expiresAt = new Date(Date.now() + ENV.authSessionTtlSeconds * 1000);
  await db.insertAuthSession({ idHash: hash(raw), userId, expiresAt });
  res.cookie(COOKIE, raw, {
    httpOnly: true,
    secure: ENV.isProduction,
    sameSite: "lax",
    path: "/",
    maxAge: ENV.authSessionTtlSeconds * 1000,
  });
}

export async function getSessionUser(req: Request) {
  const raw = req.cookies?.[COOKIE] ?? readCookie(req.headers.cookie, COOKIE);
  if (!raw) return null;
  const session = await db.getAuthSession(hash(raw));
  if (!session || session.revokedAt || session.expiresAt <= new Date()) return null;
  await db.touchAuthSession(session.idHash);
  return db.getUserById(session.userId);
}

export async function revokeSession(req: Request, res: Response) {
  const raw = req.cookies?.[COOKIE] ?? readCookie(req.headers.cookie, COOKIE);
  if (raw) await db.revokeAuthSession(hash(raw));
  res.clearCookie(COOKIE, { httpOnly: true, secure: ENV.isProduction, sameSite: "lax", path: "/" });
}

function readCookie(header: string | undefined, name: string) {
  const match = header?.split(";").map((part) => part.trim()).find((part) => part.startsWith(`${name}=`));
  return match ? decodeURIComponent(match.slice(name.length + 1)) : undefined;
}
```

If the application already has `cookie` parsing helpers, reuse them rather than maintaining a second parser. The session cookie contains only a random opaque value; user ID and permissions remain server-side.

### 1.5 OIDC discovery and token validation

Create `server/auth/oidc.ts`. This uses standard discovery and `jose` for ID-token signature validation. In production, prefer the provider's maintained OIDC SDK if it is available.

```ts
import { createRemoteJWKSet, jwtVerify, type JWTPayload } from "jose";
import { ENV } from "../_core/env";

let discoveryPromise: Promise<OidcDiscovery> | undefined;
let jwks: ReturnType<typeof createRemoteJWKSet> | undefined;

type OidcDiscovery = {
  authorization_endpoint: string;
  token_endpoint: string;
  jwks_uri: string;
  issuer: string;
};

async function discovery() {
  if (!ENV.oidcIssuerUrl) throw new Error("OIDC_ISSUER_URL is missing");
  discoveryPromise ??= fetch(`${ENV.oidcIssuerUrl}/.well-known/openid-configuration`)
    .then(async (response) => {
      if (!response.ok) throw new Error("OIDC discovery failed");
      const value = await response.json() as OidcDiscovery;
      if (value.issuer !== ENV.oidcIssuerUrl) throw new Error("OIDC issuer mismatch");
      return value;
    });
  return discoveryPromise;
}

export async function authorizationUrl(input: {
  state: string;
  codeChallenge: string;
}) {
  const config = await discovery();
  const url = new URL(config.authorization_endpoint);
  url.searchParams.set("client_id", ENV.oidcClientId);
  url.searchParams.set("redirect_uri", ENV.oidcRedirectUri);
  url.searchParams.set("response_type", "code");
  url.searchParams.set("scope", "openid profile email");
  url.searchParams.set("state", input.state);
  url.searchParams.set("code_challenge", input.codeChallenge);
  url.searchParams.set("code_challenge_method", "S256");
  return url.toString();
}

export async function exchangeCode(code: string, verifier: string) {
  const config = await discovery();
  const body = new URLSearchParams({
    grant_type: "authorization_code",
    code,
    client_id: ENV.oidcClientId,
    client_secret: ENV.oidcClientSecret,
    redirect_uri: ENV.oidcRedirectUri,
    code_verifier: verifier,
  });
  const response = await fetch(config.token_endpoint, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body,
  });
  if (!response.ok) throw new Error("OIDC token exchange failed");
  return response.json() as Promise<{ id_token: string; access_token?: string }>;
}

export async function validateIdToken(idToken: string, nonce?: string) {
  const config = await discovery();
  jwks ??= createRemoteJWKSet(new URL(config.jwks_uri));
  const result = await jwtVerify(idToken, jwks, {
    issuer: config.issuer,
    audience: ENV.oidcClientId,
  });
  if (nonce && result.payload.nonce !== nonce) throw new Error("OIDC nonce mismatch");
  return result.payload as JWTPayload & {
    sub: string;
    email?: string;
    name?: string;
    email_verified?: boolean;
  };
}
```

### 1.6 Login and callback routes

Create `server/auth/routes.ts` and register it from `server/_core/index.ts`:

```ts
import type { Express, Request, Response } from "express";
import { pkceChallenge, randomUrlSecret, safeReturnPath, sha256 } from "./crypto";
import { authorizationUrl, exchangeCode, validateIdToken } from "./oidc";
import { createSession, revokeSession } from "./session";
import * as db from "../db";

export function registerAuthRoutes(app: Express) {
  app.get("/auth/login", async (req, res, next) => {
    try {
      const state = randomUrlSecret(24);
      const verifier = randomUrlSecret(32);
      const nonce = randomUrlSecret(24);
      await db.insertOAuthState({
        hash: sha256(state),
        codeVerifierHash: sha256(verifier),
        redirectPath: safeReturnPath(req.query.returnTo),
        expiresAt: new Date(Date.now() + 10 * 60 * 1000),
      });
      res.cookie("__Host-oauth-state", JSON.stringify({ state, verifier, nonce }), {
        httpOnly: true,
        secure: true,
        sameSite: "lax",
        path: "/",
        maxAge: 600,
      });
      res.redirect(await authorizationUrl({ state, codeChallenge: pkceChallenge(verifier) }));
    } catch (error) {
      next(error);
    }
  });

  app.get("/api/auth/callback", async (req, res, next) => {
    try {
      const code = typeof req.query.code === "string" ? req.query.code : "";
      const state = typeof req.query.state === "string" ? req.query.state : "";
      const rawState = req.cookies?.["__Host-oauth-state"];
      if (!code || !state || !rawState) return res.status(400).send("Invalid sign-in response");
      const cookie = JSON.parse(rawState) as { state: string; verifier: string; nonce: string };
      if (cookie.state !== state) return res.status(400).send("Invalid sign-in state");

      const stored = await db.consumeOAuthState(sha256(state));
      if (!stored || stored.codeVerifierHash !== sha256(cookie.verifier)) {
        return res.status(400).send("Expired sign-in response");
      }
      const tokens = await exchangeCode(code, cookie.verifier);
      const claims = await validateIdToken(tokens.id_token, cookie.nonce);
      if (!claims.sub) return res.status(400).send("Identity missing from sign-in response");

      const user = await db.upsertOidcUser({
        issuer: claims.iss as string,
        subject: claims.sub,
        email: claims.email ?? null,
        name: claims.name ?? null,
      });
      await createSession(user.id, res);
      res.clearCookie("__Host-oauth-state", { httpOnly: true, secure: true, sameSite: "lax", path: "/" });
      res.redirect(stored.redirectPath);
    } catch (error) {
      next(error);
    }
  });

  app.post("/api/auth/logout", async (req: Request, res: Response) => {
    await revokeSession(req, res);
    res.status(204).end();
  });
}
```

The `oauthStates` row is consumed atomically. The production implementation should also bind the nonce to the stored state row rather than trusting a client-only value; add a `nonceHash` column if the selected provider requires nonce validation.

### 1.7 Replace legacy context and client login

In `server/_core/context.ts`, replace `legacy session resolver(req)` with `getSessionUser(req)`. Keep `protectedProcedure` unchanged by returning the same local `User` shape.

In `client/src/const.ts`, replace `startLogin` with:

```ts
export const startLogin = (returnTo = window.location.pathname) => {
  const target = encodeURIComponent(returnTo.startsWith("/") ? returnTo : "/dashboard");
  window.location.assign(`/auth/login?returnTo=${target}`);
};
```

Remove these legacy client behaviors from `client/src/_core/hooks/useAuth.ts`:

- `sessionStorage.removeItem("legacy-session-token")`
- `localStorage.setItem("legacy-runtime-user-info", ...)`
- any preview auto-login token handling

Keep `trpc.auth.me.useQuery()` and the existing logout mutation contract so the rest of the application does not need to change.

### 1.8 Authentication rollout

1. Add the three tables and database helpers.
2. Deploy the new auth routes with `AUTH_PROVIDER=oidc`, but keep the old callback available behind a temporary feature flag.
3. Test login, callback state mismatch, expired state, invalid issuer/audience/signature, logout, session expiry, and revoked sessions.
4. Link accounts by verified `(issuer, subject)`. Do not auto-merge users solely by an unverified email address.
5. Switch the client to `/auth/login`.
6. Monitor callback failures and protected tRPC errors.
7. Expire legacy sessions after the agreed migration window.
8. Remove `the retired OAuth route module`, legacy provider SDK auth branches, `old provider app identifier`, `old provider portal URL`, and `old provider server URL`.

---

## 2. Complete Google Maps replacement

### 2.1 Install the direct browser loader

```bash
npm install @googlemaps/js-api-loader
```

The repository already has `@types/google.maps`.

### 2.2 Replace `client/src/components/Map.tsx`

```tsx
/// <reference types="@types/google.maps" />

import { useEffect, useRef } from "react";
import { importLibrary, setOptions } from "@googlemaps/js-api-loader";
import { cn } from "@/lib/utils";

let configured = false;
let loading: Promise<typeof google.maps> | undefined;

async function loadGoogleMaps() {
  if (!configured) {
    const key = import.meta.env.VITE_GOOGLE_MAPS_BROWSER_API_KEY;
    if (!key) throw new Error("Google Maps is not configured");
    setOptions({
      key,
      v: "weekly",
      authReferrerPolicy: "origin",
    });
    configured = true;
  }

  loading ??= Promise.all([
    importLibrary("maps"),
    importLibrary("marker"),
  ]).then(() => google.maps);
  return loading;
}

type MapViewProps = {
  className?: string;
  initialCenter?: google.maps.LatLngLiteral;
  initialZoom?: number;
  onMapReady?: (map: google.maps.Map) => void;
};

export function MapView({
  className,
  initialCenter = { lat: -36.757, lng: 144.279 },
  initialZoom = 12,
  onMapReady,
}: MapViewProps) {
  const container = useRef<HTMLDivElement>(null);
  const map = useRef<google.maps.Map | null>(null);

  useEffect(() => {
    let cancelled = false;
    void loadGoogleMaps().then(() => {
      if (cancelled || !container.current) return;
      const instance = new google.maps.Map(container.current, {
        center: initialCenter,
        zoom: initialZoom,
        mapId: import.meta.env.VITE_GOOGLE_MAPS_MAP_ID || undefined,
        mapTypeControl: true,
        fullscreenControl: true,
        zoomControl: true,
        streetViewControl: true,
      });
      map.current = instance;
      onMapReady?.(instance);
    }).catch((error) => {
      console.error("[Maps] Google Maps failed to load", error);
    });

    return () => {
      cancelled = true;
      map.current = null;
    };
  }, [initialCenter.lat, initialCenter.lng, initialZoom, onMapReady]);

  return <div ref={container} className={cn("h-[500px] w-full", className)} />;
}
```

This removes the Forge URL, Forge key, hard-coded proxy path, and script self-removal. The Google loader only loads the map libraries when `MapView` mounts.

### 2.3 Replace `server/_core/map.ts` configuration

Keep the existing response types if callers use them, but replace the request implementation with direct Google Web Services calls:

```ts
import { ENV } from "./env";

type RequestOptions = {
  method?: "GET" | "POST";
  body?: Record<string, unknown>;
};

export async function makeRequest<T = unknown>(
  endpoint: string,
  params: Record<string, unknown> = {},
  options: RequestOptions = {},
): Promise<T> {
  if (!ENV.googleMapsServerApiKey) throw new Error("Google Maps is not configured");
  const url = new URL(`https://maps.googleapis.com${endpoint}`);
  url.searchParams.set("key", ENV.googleMapsServerApiKey);
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined && value !== null) url.searchParams.set(key, String(value));
  }

  const response = await fetch(url, {
    method: options.method ?? "GET",
    headers: { "content-type": "application/json" },
    body: options.body ? JSON.stringify(options.body) : undefined,
  });
  if (!response.ok) {
    console.error("[Maps] Google request failed", response.status, endpoint);
    throw new Error("Maps request failed");
  }
  return response.json() as Promise<T>;
}
```

Callers must pass real Google endpoint paths, for example `/maps/api/geocode/json` or `/maps/api/directions/json`. Do not expose `GOOGLE_MAPS_SERVER_API_KEY` to client code.

### 2.4 Update environment config and remove proxy registration

Add to `server/_core/env.ts`:

```ts
  googleMapsServerApiKey: process.env.GOOGLE_MAPS_SERVER_API_KEY ?? "",
  googleMapsMapId: process.env.VITE_GOOGLE_MAPS_MAP_ID ?? "",
```

Remove `registerStorageProxy` only when the storage migration is complete; Maps itself does not require a server proxy after this change. Remove the old `BUILT_IN_FORGE_API_*` use from `map.ts` and `Map.tsx`, but retain those variables until other Forge-backed features are migrated.

Configure Google Cloud API restrictions:

- Browser key: HTTP referrer restrictions for production and local origins.
- Server key: IP restrictions or workload identity where possible.
- APIs: enable only the APIs the code actually uses.
- Set billing alerts and quota limits.

### 2.5 Maps tests

Add tests that mock `fetch` and assert:

- The server URL is `https://maps.googleapis.com`, never a Forge URL.
- The server key is added only to server requests.
- HTTP errors become a generic application error and do not leak provider response bodies.
- `MapView` does not inject `/v1/maps/proxy` or `VITE_FRONTEND_FORGE_API_KEY`.

---

## 3. Complete AWS S3 upload and retrieval replacement

### 3.1 S3 client and environment

The repository already includes `@aws-sdk/client-s3` and `@aws-sdk/s3-request-presigner`. Replace `server/storage.ts` with:

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

const client = new S3Client({
  region: ENV.awsRegion,
  endpoint: ENV.awsS3Endpoint || undefined,
  forcePathStyle: Boolean(ENV.awsS3Endpoint),
  credentials: ENV.awsAccessKeyId && ENV.awsSecretAccessKey
    ? { accessKeyId: ENV.awsAccessKeyId, secretAccessKey: ENV.awsSecretAccessKey }
    : undefined,
});

function safeKey(value: string) {
  const key = value.replace(/^\/+/, "");
  if (!key || key.includes("..") || key.includes("\\") || key.startsWith("/")) {
    throw new Error("Invalid storage key");
  }
  return key;
}

function uniqueKey(value: string) {
  const key = safeKey(value);
  const dot = key.lastIndexOf(".");
  return dot === -1
    ? `${key}-${randomUUID()}`
    : `${key.slice(0, dot)}-${randomUUID()}${key.slice(dot)}`;
}

function publicUrl(key: string) {
  if (!ENV.awsS3PublicBaseUrl) return `/storage/${encodeURIComponent(key)}`;
  return `${ENV.awsS3PublicBaseUrl.replace(/\/+$/, "")}/${key.split("/").map(encodeURIComponent).join("/")}`;
}

export async function storagePut(
  relKey: string,
  data: Buffer | Uint8Array | string,
  contentType = "application/octet-stream",
) {
  if (!ENV.awsS3Bucket) throw new Error("AWS S3 storage is not configured");
  const key = uniqueKey(relKey);
  await client.send(new PutObjectCommand({
    Bucket: ENV.awsS3Bucket,
    Key: key,
    Body: data,
    ContentType: contentType,
    ServerSideEncryption: "AES256",
  }));
  return { key, url: publicUrl(key) };
}

export async function storageGet(relKey: string) {
  const key = safeKey(relKey);
  return { key, url: publicUrl(key) };
}

export async function storageGetSignedUrl(relKey: string) {
  if (!ENV.awsS3Bucket) throw new Error("AWS S3 storage is not configured");
  const key = safeKey(relKey);
  return getSignedUrl(client, new GetObjectCommand({
    Bucket: ENV.awsS3Bucket,
    Key: key,
  }), { expiresIn: ENV.awsSignedUrlTtl });
}

export async function storageDelete(relKey: string) {
  if (!ENV.awsS3Bucket) throw new Error("AWS S3 storage is not configured");
  await client.send(new DeleteObjectCommand({
    Bucket: ENV.awsS3Bucket,
    Key: safeKey(relKey),
  }));
  return true;
}
```

Add to `server/_core/env.ts`:

```ts
  awsRegion: process.env.AWS_REGION ?? "ap-southeast-2",
  awsS3Bucket: process.env.AWS_S3_BUCKET ?? "",
  awsS3Endpoint: process.env.AWS_S3_ENDPOINT ?? "",
  awsAccessKeyId: process.env.AWS_ACCESS_KEY_ID ?? "",
  awsSecretAccessKey: process.env.AWS_SECRET_ACCESS_KEY ?? "",
  awsS3PublicBaseUrl: process.env.AWS_S3_PUBLIC_BASE_URL ?? "",
  awsSignedUrlTtl: Number(process.env.AWS_S3_SIGNED_URL_TTL ?? 900),
```

### 3.2 Ownership-checked retrieval route

Do not turn `/storage/:key` into a generic S3 signer. Resolve the key through an ownership-aware database record first:

```ts
import { getSessionUser } from "../auth/session";
import { storageGetSignedUrl } from "../storage";

app.get("/storage/:key(*)", async (req, res) => {
  const user = await getSessionUser(req);
  const key = decodeURIComponent(req.params.key);
  const reference = await db.getOwnedStorageReference(user?.id ?? null, key);
  if (!reference) return res.status(404).send("Not found");

  const url = await storageGetSignedUrl(reference.storageKey);
  res.set("Cache-Control", "private, no-store");
  return res.redirect(302, url);
});
```

For public listing images, either use a separate public CDN prefix or resolve the listing's live/public status before signing. Never authorize a document by trusting a path supplied by the browser.

Remove `registerStorageProxy(app)` and `server/_core/storageProxy.ts` after all references are migrated. Update URLs written to new rows from `/manus-storage/${key}` to `/storage/${key}` or the configured CDN base URL.

### 3.3 Database compatibility and migration

Existing rows may contain `/manus-storage/...` URLs. Use a dual-read window:

```ts
export function storageReferenceFromRow(row: { storageKey?: string | null; url?: string | null }) {
  if (row.storageKey) return { provider: "s3" as const, key: row.storageKey };
  if (row.url?.startsWith("/manus-storage/")) {
    return { provider: "manus" as const, key: row.url.slice("/manus-storage/".length) };
  }
  return null;
}
```

Then:

1. Add nullable `storageKey` and `storageProvider` fields if current tables only store URLs.
2. New uploads write S3 keys and provider `s3`.
3. Copy legacy objects to S3 in an idempotent background job.
4. Verify object size and checksum before updating each row.
5. Rewrite rows to S3 references only after verification.
6. Keep legacy reads until all rows are migrated.
7. Remove Forge storage routes and variables after a zero-legacy-read observation period.

### 3.4 S3 security setup

- Keep S3 Block Public Access enabled for private documents.
- Use prefixes such as `users/{userId}/`, `listings/{listingId}/`, and `office/{userId}/`.
- Restrict the IAM role to the bucket and prefixes required by this application.
- Use short-lived signed URLs, typically 5–15 minutes.
- Validate content type, size, extension, and file content before upload; client-provided MIME type is not authoritative.
- Configure lifecycle cleanup for abandoned multipart uploads and temporary migration files.
- Do not log signed URLs or AWS credentials.

### 3.5 Storage tests

Mock the S3 client and test:

- Upload generates a unique normalized key.
- `..`, backslashes, empty keys, and absolute keys are rejected.
- Uploads use the configured bucket and content type.
- Retrieval signs only an ownership-approved key.
- Delete calls `DeleteObjectCommand`.
- Missing S3 configuration fails safely.
- Legacy Manus URLs are read only during the migration window and are never generated for new records.

---

## 4. Recommended implementation order

1. Add provider-specific environment variables without removing the old ones.
2. Add OAuth tables and session helpers; deploy login behind `AUTH_PROVIDER=oidc`.
3. Add Google Maps direct loading and mock-based tests; switch the client map component.
4. Add the S3 adapter and ownership-checked retrieval route; switch new uploads to S3.
5. Run dual-read/dual-write migration monitoring without modifying existing listing or user data.
6. Migrate legacy storage objects and verified database references.
7. Remove legacy authentication, Maps proxy, storage proxy, and related environment variables only after zero legacy traffic.
8. Run `npm run check`, `npm test`, `npm run build`, and a production `npm start` health check.

## References

- [Google Maps JavaScript API loader and dynamic `importLibrary()`](https://developers.google.com/maps/documentation/javascript/load-maps-js-api)
- [AWS S3 presigned upload/download URLs](https://docs.aws.amazon.com/AmazonS3/latest/userguide/using-presigned-url.html)
- [RFC 7636 PKCE](https://datatracker.ietf.org/doc/html/rfc7636)
- [OWASP Session Management Cheat Sheet](https://cheatsheetseries.owasp.org/cheatsheets/Session_Management_Cheat_Sheet.html)
