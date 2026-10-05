# Replacing the legacy login flow with standard OAuth/OIDC or JWT

This guide replaces the current the legacy OAuth provider/session path while preserving existing Fingerprints users, seller ownership, listings, credits, plans, and dashboard behavior.

## Recommended choice

Use **OIDC Authorization Code + PKCE with an application-owned session cookie**.

- The identity provider handles passwords, MFA, account recovery, and identity verification.
- Fingerprints stores the provider identity and its own authorization data locally.
- The browser receives only an opaque session cookie.
- Access tokens and refresh tokens stay server-side.

Use a pure JWT design only when another internal service must independently validate the token. For this monolithic Express/tRPC application, opaque database sessions are simpler to revoke and safer to operate.

---

## Phase 1: Inventory the current the legacy login flow path

Review these files before changing behavior:

- `the retired OAuth route module` — the legacy OAuth provider callback and login behavior.
- `server/_core/sdk.ts` — legacy request authentication and user lookup.
- `server/_core/context.ts` — builds `ctx.user` for tRPC.
- `server/_core/cookies.ts` — current cookie handling.
- `server/routers.ts` — `auth.me` and `auth.logout` procedures.
- `client/src/_core/hooks/useAuth.ts` — browser authentication state.
- `client/src/const.ts` — current login URL helper.
- `drizzle/schema.ts` — existing `users` identity fields.

Record the current user mapping before migration. Do not identify accounts only by display name. Preserve the existing local `users.id`, because listings, office files, credits, usage records, bonus grants, and seller settings reference it.

---

## Phase 2: Add provider configuration

Add these environment variables:

```dotenv
AUTH_PROVIDER=oidc
OIDC_ISSUER_URL=https://your-provider.example.com
OIDC_CLIENT_ID=
OIDC_CLIENT_SECRET=
OIDC_REDIRECT_URI=https://fingerprintsau.com/api/auth/callback
OIDC_POST_LOGOUT_REDIRECT_URI=https://fingerprintsau.com/
AUTH_SESSION_TTL_SECONDS=2592000
```

For local development, register the exact local callback URI with the provider. Never commit client secrets.

The provider application should allow:

- Authorization Code flow.
- PKCE with `S256`.
- Scopes `openid profile email`.
- The production callback URL.
- The production post-logout URL.

---

## Phase 3: Add identity-link and session tables

Add two durable tables and one short-lived state table to `drizzle/schema.ts`:

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
  nonceHash: varchar("nonceHash", { length: 64 }).notNull(),
  redirectPath: varchar("redirectPath", { length: 512 }).notNull(),
  expiresAt: timestamp("expiresAt").notNull(),
  consumedAt: timestamp("consumedAt"),
});
```

Generate and apply the migration using the repository's normal Drizzle process. This migration must only add tables and indexes; it must not rewrite existing listing or user rows.

---

## Phase 4: Implement secure state and session primitives

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
  if (!value.startsWith("/") || value.startsWith("//") || value.includes("\\")) {
    return "/dashboard";
  }
  return value;
}
```

Create `server/auth/session.ts`:

```ts
import { createHash, randomBytes } from "node:crypto";
import type { Request, Response } from "express";
import * as db from "../db";
import { ENV } from "../_core/env";

const SESSION_COOKIE = "__Host-session";

function hash(value: string) {
  return createHash("sha256").update(value).digest("hex");
}

export async function createSession(userId: number, res: Response) {
  const raw = randomBytes(32).toString("base64url");
  const expiresAt = new Date(Date.now() + ENV.authSessionTtlSeconds * 1000);
  await db.insertAuthSession({ idHash: hash(raw), userId, expiresAt });

  res.cookie(SESSION_COOKIE, raw, {
    httpOnly: true,
    secure: ENV.isProduction,
    sameSite: "lax",
    path: "/",
    maxAge: ENV.authSessionTtlSeconds * 1000,
  });
}

export async function getSessionUser(req: Request) {
  const raw = req.cookies?.[SESSION_COOKIE];
  if (!raw) return null;

  const session = await db.getAuthSession(hash(raw));
  if (!session || session.revokedAt || session.expiresAt <= new Date()) {
    return null;
  }

  await db.touchAuthSession(session.idHash);
  return db.getUserById(session.userId);
}

export async function revokeSession(req: Request, res: Response) {
  const raw = req.cookies?.[SESSION_COOKIE];
  if (raw) await db.revokeAuthSession(hash(raw));
  res.clearCookie(SESSION_COOKIE, {
    httpOnly: true,
    secure: ENV.isProduction,
    sameSite: "lax",
    path: "/",
  });
}
```

Use a random session value in the cookie and store only its SHA-256 hash in the database. This limits damage if the database is exposed.

---

## Phase 5: Add OIDC discovery and token validation

Create `server/auth/oidc.ts`. The implementation should:

1. Fetch the provider's `.well-known/openid-configuration` document.
2. Cache the discovery document in memory with a bounded refresh period.
3. Send `state`, `nonce`, `code_challenge`, and `code_challenge_method=S256`.
4. Exchange the callback code on the server.
5. Validate the ID token signature using the provider's JWKS.
6. Validate `iss`, `aud`, `exp`, `iat`, and `nonce`.

Example core implementation using `jose`:

```ts
import { createRemoteJWKSet, jwtVerify } from "jose";
import { ENV } from "../_core/env";

type Discovery = {
  issuer: string;
  authorization_endpoint: string;
  token_endpoint: string;
  jwks_uri: string;
};

let discoveryPromise: Promise<Discovery> | undefined;
let jwks: ReturnType<typeof createRemoteJWKSet> | undefined;

async function getDiscovery() {
  discoveryPromise ??= fetch(`${ENV.oidcIssuerUrl}/.well-known/openid-configuration`)
    .then(async (response) => {
      if (!response.ok) throw new Error("OIDC discovery failed");
      const value = await response.json() as Discovery;
      if (value.issuer !== ENV.oidcIssuerUrl) throw new Error("OIDC issuer mismatch");
      return value;
    });
  return discoveryPromise;
}

export async function buildAuthorizationUrl(input: {
  state: string;
  nonce: string;
  codeChallenge: string;
}) {
  const config = await getDiscovery();
  const url = new URL(config.authorization_endpoint);
  url.searchParams.set("client_id", ENV.oidcClientId);
  url.searchParams.set("redirect_uri", ENV.oidcRedirectUri);
  url.searchParams.set("response_type", "code");
  url.searchParams.set("scope", "openid profile email");
  url.searchParams.set("state", input.state);
  url.searchParams.set("nonce", input.nonce);
  url.searchParams.set("code_challenge", input.codeChallenge);
  url.searchParams.set("code_challenge_method", "S256");
  return url.toString();
}

export async function exchangeCode(code: string, verifier: string) {
  const config = await getDiscovery();
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
  return response.json() as Promise<{ id_token: string }>;
}

export async function validateIdToken(idToken: string, nonce: string) {
  const config = await getDiscovery();
  jwks ??= createRemoteJWKSet(new URL(config.jwks_uri));
  const result = await jwtVerify(idToken, jwks, {
    issuer: config.issuer,
    audience: ENV.oidcClientId,
  });
  if (result.payload.nonce !== nonce) throw new Error("OIDC nonce mismatch");
  return result.payload as {
    iss: string;
    sub: string;
    email?: string;
    email_verified?: boolean;
    name?: string;
  };
}
```

Do not trust unverified profile data from the browser. Only use claims from the validated ID token.

---

## Phase 6: Add login and callback routes

Create `server/auth/routes.ts`:

```ts
import type { Express } from "express";
import { pkceChallenge, randomUrlSecret, safeReturnPath, sha256 } from "./crypto";
import { buildAuthorizationUrl, exchangeCode, validateIdToken } from "./oidc";
import { createSession, revokeSession } from "./session";
import * as db from "../db";

export function registerStandardAuthRoutes(app: Express) {
  app.get("/auth/login", async (req, res, next) => {
    try {
      const state = randomUrlSecret(24);
      const verifier = randomUrlSecret(32);
      const nonce = randomUrlSecret(24);

      await db.insertOAuthState({
        hash: sha256(state),
        codeVerifierHash: sha256(verifier),
        nonceHash: sha256(nonce),
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

      res.redirect(await buildAuthorizationUrl({
        state,
        nonce,
        codeChallenge: pkceChallenge(verifier),
      }));
    } catch (error) {
      next(error);
    }
  });

  app.get("/api/auth/callback", async (req, res, next) => {
    try {
      const code = typeof req.query.code === "string" ? req.query.code : "";
      const state = typeof req.query.state === "string" ? req.query.state : "";
      const raw = req.cookies?.["__Host-oauth-state"];
      if (!code || !state || !raw) return res.status(400).send("Invalid sign-in response");

      const cookie = JSON.parse(raw) as {
        state: string;
        verifier: string;
        nonce: string;
      };
      if (cookie.state !== state) return res.status(400).send("Invalid sign-in state");

      const stored = await db.consumeOAuthState(sha256(state));
      if (!stored || stored.codeVerifierHash !== sha256(cookie.verifier)) {
        return res.status(400).send("Expired sign-in response");
      }
      if (stored.nonceHash !== sha256(cookie.nonce)) {
        return res.status(400).send("Invalid sign-in state");
      }

      const tokens = await exchangeCode(code, cookie.verifier);
      const claims = await validateIdToken(tokens.id_token, cookie.nonce);
      if (!claims.sub) return res.status(400).send("Identity missing from sign-in response");

      const user = await db.upsertOidcUser({
        issuer: claims.iss,
        subject: claims.sub,
        email: claims.email ?? null,
        name: claims.name ?? null,
      });
      await createSession(user.id, res);
      res.clearCookie("__Host-oauth-state", { path: "/" });
      res.redirect(stored.redirectPath);
    } catch (error) {
      next(error);
    }
  });

  app.post("/api/auth/logout", async (req, res) => {
    await revokeSession(req, res);
    res.status(204).end();
  });
}
```

Register the routes before the tRPC middleware in `server/_core/index.ts`:

```ts
registerStandardAuthRoutes(app);
```

Keep the callback error response generic. Log the provider-specific error server-side without returning it to customers.

---

## Phase 7: Connect the app to the new session

### Server context

In `server/_core/context.ts`, replace legacy request authentication with:

```ts
import { getSessionUser } from "../auth/session";

export async function createContext({ req, res }: CreateExpressContextOptions) {
  return {
    req,
    res,
    user: await getSessionUser(req),
  };
}
```

Keep the existing `protectedProcedure` and `adminProcedure` checks. They should continue using the local `ctx.user.role`, not provider claims.

### Client login

Replace the Manus portal URL helper in `client/src/const.ts`:

```ts
export function startLogin(returnTo = window.location.pathname) {
  const path = returnTo.startsWith("/") && !returnTo.startsWith("//")
    ? returnTo
    : "/dashboard";
  window.location.assign(`/auth/login?returnTo=${encodeURIComponent(path)}`);
}
```

Remove client code that stores or deletes legacy provider-specific values such as:

- `legacy-session-token`
- `legacy-runtime-user-info`
- `old provider portal URL`
- preview auto-login tokens

Keep `trpc.auth.me.useQuery()` because the browser can still obtain the current local user through the authenticated session cookie.

---

## Phase 8: Migrate existing accounts safely

1. Deploy the new tables without changing existing users.
2. Let users sign in through the new provider.
3. Create an `oauthAccounts` row using `(issuer, subject)` as the unique identity.
4. Link only to the local account after a trusted account-linking flow or verified provider email.
5. Never merge two seller accounts automatically based only on matching display names.
6. Keep the existing local `users.id` so all listing, credit, AI, storage, and seller records remain attached.
7. If a user cannot be matched safely, send them through an explicit account-recovery/linking flow.
8. Leave the legacy callback available during a short migration window if necessary.
9. After migration metrics reach the agreed threshold, revoke legacy sessions and delete the old auth code.

---

## Phase 9: JWT alternative

Choose JWT only if other services need to validate access tokens without calling Fingerprints.

Use:

- Short-lived access JWT: 5–15 minutes.
- Rotating refresh tokens stored server-side and hashed in a database table.
- `jose` for signing and verification.
- RS256 or ES256 with a managed key pair; do not use a shared static HMAC secret across services.
- `iss`, `aud`, `sub`, `iat`, `exp`, and `jti` claims.
- Refresh-token rotation and reuse detection.
- A secure, `HttpOnly`, `SameSite=Lax` refresh cookie.

Example access-token signer:

```ts
import { SignJWT, importPKCS8 } from "jose";
import { randomUUID } from "node:crypto";
import { ENV } from "../_core/env";

const privateKeyPromise = importPKCS8(ENV.jwtPrivateKey, "RS256");

export async function issueAccessToken(user: { id: number; role: string }) {
  const key = await privateKeyPromise;
  return new SignJWT({ role: user.role })
    .setProtectedHeader({ alg: "RS256", kid: ENV.jwtKeyId, typ: "JWT" })
    .setSubject(String(user.id))
    .setIssuer(ENV.jwtIssuer)
    .setAudience(ENV.jwtAudience)
    .setIssuedAt()
    .setExpirationTime("10m")
    .setJti(randomUUID())
    .sign(key);
}
```

Example verifier:

```ts
import { createRemoteJWKSet, jwtVerify } from "jose";

const keys = createRemoteJWKSet(new URL(ENV.jwtJwksUrl));

export async function verifyAccessToken(token: string) {
  const { payload } = await jwtVerify(token, keys, {
    issuer: ENV.jwtIssuer,
    audience: ENV.jwtAudience,
    algorithms: ["RS256"],
  });
  if (!payload.sub) throw new Error("JWT subject missing");
  return payload;
}
```

Do not store access JWTs in `localStorage`. If the browser is the only client, the opaque-session design is preferred because logout and revocation are immediate and straightforward.

---

## Phase 10: Security and acceptance tests

Add tests for:

- Login generates unique state, nonce, and PKCE verifier.
- Callback rejects missing, mismatched, expired, or reused state.
- Callback rejects invalid issuer, audience, signature, nonce, or expiry.
- Callback cannot redirect to an external URL.
- A valid provider identity creates exactly one local account link.
- Existing local user IDs remain unchanged.
- Session cookies are `HttpOnly`, `Secure` in production, `SameSite=Lax`, `Path=/`, and use the `__Host-` prefix.
- Expired and revoked sessions return no user.
- Logout revokes the server session and clears the cookie.
- Protected tRPC routes reject an unauthenticated request.
- Admin procedures still rely on the local role.
- JWT access tokens reject wrong issuer, audience, algorithm, signature, and expiry.
- Refresh-token reuse revokes the token family if JWT mode is selected.

Run:

```bash
npm run check
npm test
npm run build
NODE_ENV=production PORT=3100 npm start
curl -fsS http://127.0.0.1:3100/health
```

## Final removal checklist

Only remove the legacy login flow after all of these are true:

- New login and logout work in production.
- Existing sellers can reach their original dashboard and listings.
- No customer-facing code references the legacy login flow URLs or browser tokens.
- No server request uses `legacy session resolver` for normal user sessions.
- OAuth callback and session tests pass.
- The old legacy sessions have expired or been explicitly revoked.
- `old provider server URL`, `old provider app identifier`, and `old provider portal URL` are no longer referenced by authentication code.
