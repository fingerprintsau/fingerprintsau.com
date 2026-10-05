# Secure JWT access tokens and rotating refresh tokens

This implementation targets **Node.js, TypeScript, Express, PostgreSQL/MySQL-compatible storage, and `jose`**. It uses:

- Short-lived asymmetric JWT access tokens.
- Server-side refresh-token rotation.
- SHA-256 hashes instead of raw refresh tokens in the database.
- Reuse detection that revokes the entire refresh-token family.
- `HttpOnly`, `Secure`, `SameSite=Lax`, `__Host-` cookies.
- Explicit issuer, audience, algorithm, expiry, and subject validation.

For a single-server web app, opaque sessions are usually simpler. Use this implementation when independent services need to verify access JWTs.

---

## 1. Install dependencies

```bash
npm install express cookie-parser jose zod
npm install -D @types/express @types/cookie-parser typescript tsx
```

Generate an RSA key pair outside source control:

```bash
openssl genpkey -algorithm RSA -pkeyopt rsa_keygen_bits:3072 -out jwt-private.pem
openssl rsa -pubout -in jwt-private.pem -out jwt-public.pem
```

Store the private key in a secrets manager or protected deployment secret. Do not commit either key.

Example environment configuration:

```dotenv
NODE_ENV=production
PORT=3000
JWT_ISSUER=https://auth.example.com
JWT_AUDIENCE=fingerprints-api
JWT_KEY_ID=2026-01
JWT_PRIVATE_KEY_PEM_BASE64=
JWT_PUBLIC_KEY_PEM_BASE64=
ACCESS_TOKEN_TTL_SECONDS=600
REFRESH_TOKEN_TTL_SECONDS=2592000
REFRESH_COOKIE_DOMAIN=
TRUSTED_WEB_ORIGIN=https://fingerprintsau.com
```

Base64-encode the PEM files for secret-manager storage:

```bash
base64 -w0 jwt-private.pem
base64 -w0 jwt-public.pem
```

---

## 2. Database schema

The database must support atomic updates and unique constraints.

```sql
CREATE TABLE refresh_token_families (
  family_id VARCHAR(64) PRIMARY KEY,
  user_id BIGINT NOT NULL,
  client_id VARCHAR(128) NOT NULL,
  created_at TIMESTAMP NOT NULL,
  revoked_at TIMESTAMP NULL,
  revoke_reason VARCHAR(80) NULL
);

CREATE TABLE refresh_tokens (
  token_id VARCHAR(64) PRIMARY KEY,
  token_hash CHAR(64) NOT NULL UNIQUE,
  family_id VARCHAR(64) NOT NULL,
  user_id BIGINT NOT NULL,
  client_id VARCHAR(128) NOT NULL,
  issued_at TIMESTAMP NOT NULL,
  expires_at TIMESTAMP NOT NULL,
  consumed_at TIMESTAMP NULL,
  revoked_at TIMESTAMP NULL,
  replaced_by_token_id VARCHAR(64) NULL,
  FOREIGN KEY (family_id) REFERENCES refresh_token_families(family_id)
);

CREATE INDEX refresh_tokens_family_idx ON refresh_tokens(family_id);
CREATE INDEX refresh_tokens_user_idx ON refresh_tokens(user_id);
CREATE INDEX refresh_tokens_expiry_idx ON refresh_tokens(expires_at);
```

The application must also have a local user table. JWT `sub` values should reference the internal user ID, not an email address.

---

## 3. Configuration and cryptographic helpers

Create `src/auth/config.ts`:

```ts
import { z } from "zod";

const envSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  JWT_ISSUER: z.string().url(),
  JWT_AUDIENCE: z.string().min(1),
  JWT_KEY_ID: z.string().min(1),
  JWT_PRIVATE_KEY_PEM_BASE64: z.string().min(1),
  JWT_PUBLIC_KEY_PEM_BASE64: z.string().min(1),
  ACCESS_TOKEN_TTL_SECONDS: z.coerce.number().int().min(60).max(900).default(600),
  REFRESH_TOKEN_TTL_SECONDS: z.coerce.number().int().min(3600).max(90 * 86400).default(30 * 86400),
  TRUSTED_WEB_ORIGIN: z.string().url(),
});

const env = envSchema.parse(process.env);

export const authConfig = {
  isProduction: env.NODE_ENV === "production",
  issuer: env.JWT_ISSUER,
  audience: env.JWT_AUDIENCE,
  keyId: env.JWT_KEY_ID,
  privateKeyPem: Buffer.from(env.JWT_PRIVATE_KEY_PEM_BASE64, "base64").toString("utf8"),
  publicKeyPem: Buffer.from(env.JWT_PUBLIC_KEY_PEM_BASE64, "base64").toString("utf8"),
  accessTokenTtlSeconds: env.ACCESS_TOKEN_TTL_SECONDS,
  refreshTokenTtlSeconds: env.REFRESH_TOKEN_TTL_SECONDS,
  trustedWebOrigin: env.TRUSTED_WEB_ORIGIN,
} as const;
```

Create `src/auth/crypto.ts`:

```ts
import { createHash, randomBytes } from "node:crypto";

export function randomToken(bytes = 32) {
  return randomBytes(bytes).toString("base64url");
}

export function hashToken(token: string) {
  return createHash("sha256").update(token, "utf8").digest("hex");
}
```

Refresh tokens must contain at least 256 bits of randomness. They are opaque values; do not encode user data into them.

---

## 4. Storage interface

The auth service should depend on a transaction-capable repository rather than embedding database-specific SQL in middleware.

Create `src/auth/auth-store.ts`:

```ts
export type User = {
  id: number;
  role: "user" | "admin";
};

export type RefreshFamily = {
  familyId: string;
  userId: number;
  clientId: string;
  revokedAt: Date | null;
};

export type RefreshRecord = {
  tokenId: string;
  tokenHash: string;
  familyId: string;
  userId: number;
  clientId: string;
  issuedAt: Date;
  expiresAt: Date;
  consumedAt: Date | null;
  revokedAt: Date | null;
};

export interface AuthStore {
  getUserById(userId: number): Promise<User | null>;

  createRefreshFamily(input: {
    familyId: string;
    userId: number;
    clientId: string;
    createdAt: Date;
  }): Promise<void>;

  createRefreshToken(input: {
    tokenId: string;
    tokenHash: string;
    familyId: string;
    userId: number;
    clientId: string;
    issuedAt: Date;
    expiresAt: Date;
  }): Promise<void>;

  getRefreshTokenForUpdate(tokenHash: string): Promise<RefreshRecord | null>;
  getRefreshFamilyForUpdate(familyId: string): Promise<RefreshFamily | null>;

  /** Must be atomic and run in the same transaction as the replacement insert. */
  consumeRefreshToken(input: {
    tokenId: string;
    consumedAt: Date;
    replacementTokenId: string;
  }): Promise<boolean>;

  revokeRefreshFamily(input: {
    familyId: string;
    revokedAt: Date;
    reason: string;
  }): Promise<void>;

  revokeUserRefreshFamilies(input: {
    userId: number;
    revokedAt: Date;
    reason: string;
  }): Promise<void>;

  deleteExpiredRefreshTokens(before: Date): Promise<number>;

  /** Runs callback in a real database transaction with row locks. */
  transaction<T>(callback: (store: AuthStore) => Promise<T>): Promise<T>;
}
```

The important database guarantees are:

- `getRefreshTokenForUpdate` locks the refresh row until commit.
- `consumeRefreshToken` succeeds only when `consumed_at IS NULL` and `revoked_at IS NULL`.
- Family revocation and replacement insertion occur in one transaction.

Example SQL for consuming a token:

```sql
UPDATE refresh_tokens
SET consumed_at = ?, replaced_by_token_id = ?
WHERE token_id = ?
  AND consumed_at IS NULL
  AND revoked_at IS NULL;
```

Check the affected-row count. Do not assume an update succeeded.

---

## 5. JWT service

Create `src/auth/jwt-service.ts`:

```ts
import { importPKCS8, importSPKI, SignJWT, jwtVerify, type JWTPayload } from "jose";
import { authConfig } from "./config";
import { randomToken } from "./crypto";

const privateKeyPromise = importPKCS8(authConfig.privateKeyPem, "RS256");
const publicKeyPromise = importSPKI(authConfig.publicKeyPem, "RS256");

export type AccessClaims = JWTPayload & {
  sub: string;
  role: string;
};

export async function issueAccessToken(user: { id: number; role: string }) {
  const now = Math.floor(Date.now() / 1000);
  const key = await privateKeyPromise;

  return new SignJWT({
    role: user.role,
  })
    .setProtectedHeader({
      alg: "RS256",
      kid: authConfig.keyId,
      typ: "JWT",
    })
    .setSubject(String(user.id))
    .setIssuer(authConfig.issuer)
    .setAudience(authConfig.audience)
    .setIssuedAt(now)
    .setExpirationTime(now + authConfig.accessTokenTtlSeconds)
    .setJti(randomToken(24))
    .sign(key);
}

export async function verifyAccessToken(token: string): Promise<AccessClaims> {
  const key = await publicKeyPromise;
  const { payload } = await jwtVerify(token, key, {
    issuer: authConfig.issuer,
    audience: authConfig.audience,
    algorithms: ["RS256"],
    requiredClaims: ["sub", "iss", "aud", "iat", "exp", "jti"],
  });

  if (typeof payload.sub !== "string" || !/^\d+$/.test(payload.sub)) {
    throw new Error("Invalid token subject");
  }
  if (typeof payload.role !== "string") {
    throw new Error("Invalid token role");
  }

  return payload as AccessClaims;
}
```

Do not accept an algorithm from configuration or a client request. The verifier must have an explicit algorithm allowlist.

---

## 6. Refresh-token service with rotation and reuse detection

Create `src/auth/refresh-service.ts`:

```ts
import { randomToken, hashToken } from "./crypto";
import { authConfig } from "./config";
import { issueAccessToken } from "./jwt-service";
import type { AuthStore, User } from "./auth-store";

export const REFRESH_COOKIE = "__Host-refresh";

type IssuedRefresh = {
  rawToken: string;
  tokenId: string;
  familyId: string;
  expiresAt: Date;
};

function issueRefreshRecord(input: {
  familyId: string;
  user: User;
  clientId: string;
  now: Date;
}): IssuedRefresh {
  const rawToken = randomToken(32);
  const tokenId = randomToken(24);
  const expiresAt = new Date(input.now.getTime() + authConfig.refreshTokenTtlSeconds * 1000);
  return { rawToken, tokenId, familyId: input.familyId, expiresAt };
}

export async function createLoginTokens(input: {
  store: AuthStore;
  user: User;
  clientId: string;
}) {
  const now = new Date();
  const familyId = randomToken(32);
  const refresh = issueRefreshRecord({
    familyId,
    user: input.user,
    clientId: input.clientId,
    now,
  });

  await input.store.transaction(async (tx) => {
    await tx.createRefreshFamily({
      familyId,
      userId: input.user.id,
      clientId: input.clientId,
      createdAt: now,
    });
    await tx.createRefreshToken({
      tokenId: refresh.tokenId,
      tokenHash: hashToken(refresh.rawToken),
      familyId,
      userId: input.user.id,
      clientId: input.clientId,
      issuedAt: now,
      expiresAt: refresh.expiresAt,
    });
  });

  return {
    accessToken: await issueAccessToken(input.user),
    refreshToken: refresh.rawToken,
    refreshExpiresAt: refresh.expiresAt,
  };
}

export async function rotateRefreshToken(input: {
  store: AuthStore;
  rawRefreshToken: string;
  clientId: string;
}) {
  const presentedHash = hashToken(input.rawRefreshToken);
  const now = new Date();

  return input.store.transaction(async (tx) => {
    const current = await tx.getRefreshTokenForUpdate(presentedHash);
    if (!current) throw new AuthError("INVALID_REFRESH", "Session expired");

    const family = await tx.getRefreshFamilyForUpdate(current.familyId);
    if (!family || family.revokedAt) {
      throw new AuthError("REVOKED_REFRESH", "Session expired");
    }

    if (current.clientId !== input.clientId || family.clientId !== input.clientId) {
      await tx.revokeRefreshFamily({
        familyId: current.familyId,
        revokedAt: now,
        reason: "client_mismatch",
      });
      throw new AuthError("REUSE_OR_MISMATCH", "Session expired");
    }

    if (current.expiresAt <= now || current.revokedAt) {
      throw new AuthError("EXPIRED_REFRESH", "Session expired");
    }

    // A consumed token is a replay/reuse signal. Revoke the full family.
    if (current.consumedAt) {
      await tx.revokeRefreshFamily({
        familyId: current.familyId,
        revokedAt: now,
        reason: "refresh_token_reuse",
      });
      throw new AuthError("REUSE_DETECTED", "Session expired");
    }

    const user = await tx.getUserById(current.userId);
    if (!user) {
      await tx.revokeRefreshFamily({
        familyId: current.familyId,
        revokedAt: now,
        reason: "user_missing",
      });
      throw new AuthError("USER_MISSING", "Session expired");
    }

    const replacement = issueRefreshRecord({
      familyId: current.familyId,
      user,
      clientId: input.clientId,
      now,
    });

    const consumed = await tx.consumeRefreshToken({
      tokenId: current.tokenId,
      consumedAt: now,
      replacementTokenId: replacement.tokenId,
    });
    if (!consumed) {
      // Another request won the race after the row lock was released or a
      // database constraint rejected the update. Treat this as reuse.
      await tx.revokeRefreshFamily({
        familyId: current.familyId,
        revokedAt: now,
        reason: "refresh_race",
      });
      throw new AuthError("REUSE_DETECTED", "Session expired");
    }

    await tx.createRefreshToken({
      tokenId: replacement.tokenId,
      tokenHash: hashToken(replacement.rawToken),
      familyId: replacement.familyId,
      userId: user.id,
      clientId: input.clientId,
      issuedAt: now,
      expiresAt: replacement.expiresAt,
    });

    return {
      accessToken: await issueAccessToken(user),
      refreshToken: replacement.rawToken,
      refreshExpiresAt: replacement.expiresAt,
      user,
    };
  });
}

export async function revokeCurrentFamily(input: {
  store: AuthStore;
  rawRefreshToken: string;
  reason: string;
}) {
  const current = await input.store.getRefreshTokenForUpdate(hashToken(input.rawRefreshToken));
  if (!current) return;
  await input.store.revokeRefreshFamily({
    familyId: current.familyId,
    revokedAt: new Date(),
    reason: input.reason,
  });
}

export class AuthError extends Error {
  constructor(public readonly code: string, message: string) {
    super(message);
  }
}
```

### Concurrent refresh requests

A strict rotation policy invalidates the original token as soon as the first request consumes it. Two simultaneous browser requests can therefore cause the second request to look like reuse. Handle this in the client with a single-flight refresh lock, or use a narrowly scoped server grace mechanism that does not permit arbitrary replay.

Do not silently accept a consumed token indefinitely.

---

## 7. Express cookie and middleware integration

Create `src/auth/http.ts`:

```ts
import type { NextFunction, Request, Response } from "express";
import { authConfig } from "./config";
import { verifyAccessToken } from "./jwt-service";
import {
  AuthError,
  REFRESH_COOKIE,
  createLoginTokens,
  revokeCurrentFamily,
  rotateRefreshToken,
} from "./refresh-service";
import type { AuthStore, User } from "./auth-store";

export type AuthenticatedRequest = Request & { user?: User };

export function setRefreshCookie(res: Response, token: string, expiresAt: Date) {
  res.cookie(REFRESH_COOKIE, token, {
    httpOnly: true,
    secure: true,
    sameSite: "lax",
    path: "/",
    expires: expiresAt,
  });
}

export function clearRefreshCookie(res: Response) {
  res.clearCookie(REFRESH_COOKIE, {
    httpOnly: true,
    secure: true,
    sameSite: "lax",
    path: "/",
  });
}

export function requireAccessToken(store: AuthStore) {
  return async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
    try {
      const header = req.header("authorization");
      const token = header?.startsWith("Bearer ") ? header.slice(7).trim() : "";
      if (!token) return res.status(401).json({ error: "Authentication required" });

      const claims = await verifyAccessToken(token);
      const user = await store.getUserById(Number(claims.sub));
      if (!user) return res.status(401).json({ error: "Authentication required" });

      // The current role is read from the database, not trusted from an old JWT.
      req.user = user;
      next();
    } catch {
      return res.status(401).json({ error: "Authentication required" });
    }
  };
}

export function registerAuthRoutes(input: {
  app: import("express").Express;
  store: AuthStore;
}) {
  const { app, store } = input;

  app.post("/api/auth/refresh", async (req, res) => {
    const origin = req.header("origin");
    if (origin && origin !== authConfig.trustedWebOrigin) {
      return res.status(403).json({ error: "Origin not allowed" });
    }

    const raw = req.cookies?.[REFRESH_COOKIE];
    if (!raw) return res.status(401).json({ error: "Session expired" });

    try {
      const result = await rotateRefreshToken({
        store,
        rawRefreshToken: raw,
        clientId: "web",
      });
      setRefreshCookie(res, result.refreshToken, result.refreshExpiresAt);
      return res.json({ accessToken: result.accessToken });
    } catch (error) {
      clearRefreshCookie(res);
      if (error instanceof AuthError && error.code === "REUSE_DETECTED") {
        // Send an internal security event without token values.
        console.warn("refresh_token_reuse_detected");
      }
      return res.status(401).json({ error: "Session expired" });
    }
  });

  app.post("/api/auth/logout", async (req, res) => {
    const raw = req.cookies?.[REFRESH_COOKIE];
    if (raw) await revokeCurrentFamily({ store, rawRefreshToken: raw, reason: "logout" });
    clearRefreshCookie(res);
    return res.status(204).end();
  });

  app.post("/api/auth/logout-all", requireAccessToken(store), async (req: AuthenticatedRequest, res) => {
    await store.revokeUserRefreshFamilies({
      userId: req.user!.id,
      revokedAt: new Date(),
      reason: "logout_all",
    });
    clearRefreshCookie(res);
    return res.status(204).end();
  });
}
```

Register `cookie-parser` before the auth routes:

```ts
import express from "express";
import cookieParser from "cookie-parser";
import { registerAuthRoutes } from "./auth/http";

const app = express();
app.set("trust proxy", 1);
app.use(express.json({ limit: "1mb" }));
app.use(cookieParser());
registerAuthRoutes({ app, store: authStore });
```

For a production deployment behind a reverse proxy, `trust proxy` must be configured to the actual proxy topology. Do not enable broad proxy trust on an untrusted network.

---

## 8. Login endpoint

After authenticating the user through OIDC or another trusted login mechanism:

```ts
app.post("/api/auth/login-complete", async (req, res) => {
  // This route must only be reachable after server-side identity validation.
  const user = await findOrCreateLocalUserFromValidatedIdentity(req);
  const tokens = await createLoginTokens({
    store: authStore,
    user,
    clientId: "web",
  });

  setRefreshCookie(res, tokens.refreshToken, tokens.refreshExpiresAt);
  res.json({ accessToken: tokens.accessToken });
});
```

Never accept a user ID, role, email, or identity assertion directly from the browser.

---

## 9. SPA access-token handling

The browser keeps the short-lived access token in memory only:

```ts
let accessToken: string | null = null;
let refreshPromise: Promise<string> | null = null;

export function setAccessToken(token: string | null) {
  accessToken = token;
}

async function refreshAccessToken() {
  const response = await fetch("/api/auth/refresh", {
    method: "POST",
    credentials: "include",
    headers: { "Content-Type": "application/json" },
  });
  if (!response.ok) throw new Error("Session expired");
  const body = await response.json() as { accessToken: string };
  accessToken = body.accessToken;
  return body.accessToken;
}

export async function apiFetch(input: RequestInfo, init: RequestInit = {}) {
  const headers = new Headers(init.headers);
  if (accessToken) headers.set("Authorization", `Bearer ${accessToken}`);

  let response = await fetch(input, { ...init, headers, credentials: "include" });
  if (response.status !== 401) return response;

  refreshPromise ??= refreshAccessToken().finally(() => {
    refreshPromise = null;
  });
  const replacement = await refreshPromise;

  const retryHeaders = new Headers(init.headers);
  retryHeaders.set("Authorization", `Bearer ${replacement}`);
  return fetch(input, { ...init, headers: retryHeaders, credentials: "include" });
}
```

The single-flight promise prevents multiple simultaneous API requests from rotating the same refresh token at once.

---

## 10. Rate limiting and operational controls

Apply limits to `/api/auth/refresh`, login, callback, and passwordless endpoints:

- Per IP address.
- Per account or user ID after identification.
- Per refresh-token family.
- Separate stricter limits for repeated failures.

Do not log raw JWTs, cookies, authorization headers, refresh tokens, or full request URLs containing tokens. Redact these fields in application, proxy, error-tracking, and analytics logs.

Run a scheduled cleanup:

```ts
await authStore.deleteExpiredRefreshTokens(new Date());
```

Keep revoked records long enough for security investigation and reuse detection, subject to the application retention policy.

---

## 11. JWT and refresh-token tests

At minimum, test:

```ts
it("rejects a token with the wrong audience", async () => {
  await expect(verifyAccessToken(tokenWithWrongAudience)).rejects.toThrow();
});

it("rotates a refresh token exactly once", async () => {
  const first = await rotateRefreshToken(input);
  await expect(rotateRefreshToken(input)).rejects.toMatchObject({
    code: "REUSE_DETECTED",
  });
  expect(await store.isFamilyRevoked(first.user.id)).toBe(true);
});

it("rejects refresh tokens from another client", async () => {
  await expect(rotateRefreshToken({ ...input, clientId: "mobile" }))
    .rejects.toMatchObject({ code: "REUSE_OR_MISMATCH" });
});
```

Also cover expired tokens, revoked families, missing claims, wrong algorithms, invalid signatures, concurrent refresh requests, logout-all, CORS origins, CSRF, and cross-user authorization.

---

# HttpOnly cookies vs local storage in SPAs

## HttpOnly cookies

### Advantages

- JavaScript cannot read the refresh token, reducing direct token theft from many XSS payloads.
- Browser automatically sends the cookie to the same origin.
- Works well with server-side refresh-token rotation.
- `Secure`, `SameSite`, and `__Host-` attributes provide strong browser controls.
- Tokens are less likely to be copied into client logs or accidentally rendered in the DOM.

### Risks

- Cookies are automatically attached to requests, so CSRF must be addressed.
- Cross-origin deployments require careful CORS and credential configuration.
- Logout and refresh behavior can be less obvious to frontend code.
- A successful XSS attack can still make authenticated requests from the victim browser, even if it cannot read the cookie.

### Recommended use

Use an **HttpOnly cookie for the refresh token** and keep the short-lived access token in memory. Apply SameSite policy, Origin checks, CSRF protection where needed, and strict CORS.

## Local storage

### Advantages

- Simple `Authorization: Bearer` request flow.
- The browser does not attach the token automatically, reducing classic CSRF exposure.
- Easy to use with APIs on different domains.

### Risks

- Any JavaScript running in the origin can read the token.
- XSS, compromised dependencies, malicious browser extensions, or injected third-party scripts can exfiltrate it.
- Developers frequently store long-lived refresh tokens there, creating a high-impact persistent credential theft path.
- Tokens can be copied into debugging tools, error reports, analytics payloads, or screenshots.
- Clearing storage does not revoke already-issued tokens on the server.

### Recommended use

Avoid storing refresh tokens in local storage. If an access token must be stored there for a legacy integration, keep it short-lived, minimize its scope, use a strict Content Security Policy, remove third-party scripts where possible, and provide server-side revocation.

## Decision table

| Storage design | XSS token theft | CSRF exposure | Revocation | Recommended use |
|---|---:|---:|---:|---|
| Refresh token in HttpOnly cookie | Lower direct-read risk | Must defend against CSRF | Strong with rotation | Preferred for browser refresh tokens |
| Access token in memory | Lost on reload, low persistence | Sent explicitly | Short lifetime | Preferred SPA access-token location |
| Access token in local storage | High | Lower classic CSRF risk | Depends on server | Avoid where possible |
| Refresh token in local storage | Very high and persistent | Lower classic CSRF risk | Depends on server | Do not use |

## Final recommendation

For a browser SPA:

1. Store the **refresh token only in a secure HttpOnly cookie**.
2. Store the **access token in memory only**.
3. Rotate refresh tokens on every use.
4. Revoke the complete token family on reuse detection.
5. Validate JWT issuer, audience, signature, algorithm, subject, and expiry.
6. Keep authorization decisions in the database for sensitive operations.
7. Use strict CSP, dependency controls, Origin validation, rate limiting, and redacted logs.
