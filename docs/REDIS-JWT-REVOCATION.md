# Redis-backed JWT revocation and refresh-token rotation

This is a complete Node.js/TypeScript reference implementation using **Express**, **Redis**, **`jose`**, and **`cookie-parser`**.

The design uses:

- Short-lived RS256 access JWTs.
- Redis denylisting for exceptional access-token revocation.
- Redis session-version checks for immediate user-wide invalidation.
- Hashed, rotating refresh tokens.
- Refresh-token family revocation on reuse detection.
- Secure `HttpOnly` refresh cookies.
- Generic client-facing errors and redacted security logs.

JWTs are normally accepted until expiry. Redis revocation is for logout, compromised sessions, role changes, account suspension, and emergency response. Keep access-token TTL short so the denylist remains bounded.

---

## 1. Install packages

```bash
npm install express cookie-parser redis jose zod
npm install -D typescript tsx @types/express @types/cookie-parser
```

Required environment variables:

```dotenv
NODE_ENV=production
REDIS_URL=rediss://redis.example.com:6380
JWT_ISSUER=https://auth.fingerprintsau.com
JWT_AUDIENCE=fingerprints-api
JWT_KEY_ID=2026-01
JWT_PRIVATE_KEY_PEM_BASE64=
JWT_PUBLIC_KEY_PEM_BASE64=
ACCESS_TOKEN_TTL_SECONDS=600
REFRESH_TOKEN_TTL_SECONDS=2592000
REFRESH_COOKIE_NAME=__Host-refresh
TRUSTED_WEB_ORIGIN=https://fingerprintsau.com
```

Never commit Redis credentials or JWT private keys.

---

## 2. Redis key model

Use namespaced keys and apply a TTL to every temporary or revocation key.

```text
auth:jwt:revoked:{jti}                  -> "1", TTL until JWT expiry
auth:user:version:{userId}              -> integer version
auth:refresh:token:{sha256(token)}      -> JSON record, TTL until refresh expiry
auth:refresh:family:{familyId}          -> JSON family record, TTL until family expiry
auth:refresh:user-families:{userId}     -> Redis set of family IDs
auth:rate:refresh:{ip}                  -> counter, short TTL
```

The source of truth for refresh-token state should be Redis only if you have persistence, replication, monitoring, and a recovery plan. For high-value accounts, use a durable SQL table as the source of truth and Redis as a fast revocation/cache layer.

This guide uses Redis as the operational store for simplicity.

---

## 3. Configuration and crypto helpers

Create `src/auth/config.ts`:

```ts
import { z } from "zod";

const schema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  REDIS_URL: z.string().url(),
  JWT_ISSUER: z.string().url(),
  JWT_AUDIENCE: z.string().min(1),
  JWT_KEY_ID: z.string().min(1),
  JWT_PRIVATE_KEY_PEM_BASE64: z.string().min(1),
  JWT_PUBLIC_KEY_PEM_BASE64: z.string().min(1),
  ACCESS_TOKEN_TTL_SECONDS: z.coerce.number().int().min(60).max(900).default(600),
  REFRESH_TOKEN_TTL_SECONDS: z.coerce.number().int().min(3600).max(90 * 86400).default(30 * 86400),
  REFRESH_COOKIE_NAME: z.string().default("__Host-refresh"),
  TRUSTED_WEB_ORIGIN: z.string().url(),
});

const env = schema.parse(process.env);

export const config = {
  production: env.NODE_ENV === "production",
  redisUrl: env.REDIS_URL,
  issuer: env.JWT_ISSUER,
  audience: env.JWT_AUDIENCE,
  keyId: env.JWT_KEY_ID,
  privateKeyPem: Buffer.from(env.JWT_PRIVATE_KEY_PEM_BASE64, "base64").toString("utf8"),
  publicKeyPem: Buffer.from(env.JWT_PUBLIC_KEY_PEM_BASE64, "base64").toString("utf8"),
  accessTtl: env.ACCESS_TOKEN_TTL_SECONDS,
  refreshTtl: env.REFRESH_TOKEN_TTL_SECONDS,
  refreshCookieName: env.REFRESH_COOKIE_NAME,
  trustedOrigin: env.TRUSTED_WEB_ORIGIN,
} as const;
```

Create `src/auth/crypto.ts`:

```ts
import { createHash, randomBytes } from "node:crypto";

export function randomToken(bytes = 32) {
  return randomBytes(bytes).toString("base64url");
}

export function sha256(value: string) {
  return createHash("sha256").update(value, "utf8").digest("hex");
}
```

Raw refresh tokens must never be used as Redis keys. Always hash them first.

---

## 4. Redis client

Create `src/auth/redis.ts`:

```ts
import { createClient } from "redis";
import { config } from "./config";

export const redis = createClient({
  url: config.redisUrl,
  socket: {
    reconnectStrategy(retries) {
      return Math.min(retries * 100, 3_000);
    },
  },
});

redis.on("error", (error) => {
  // Log the error without Redis URLs or credentials.
  console.error("redis_auth_client_error", error instanceof Error ? error.message : "unknown");
});

export async function connectRedis() {
  if (!redis.isOpen) await redis.connect();
}
```

For production, use TLS, Redis ACLs, private networking, persistence, replication, and health monitoring.

---

## 5. JWT access-token service

Create `src/auth/jwt.ts`:

```ts
import { importPKCS8, importSPKI, jwtVerify, SignJWT, type JWTPayload } from "jose";
import { config } from "./config";
import { randomToken } from "./crypto";

const privateKey = importPKCS8(config.privateKeyPem, "RS256");
const publicKey = importSPKI(config.publicKeyPem, "RS256");

export type AccessClaims = JWTPayload & {
  sub: string;
  role: string;
  ver: number;
};

export async function issueAccessToken(input: {
  userId: number;
  role: string;
  sessionVersion: number;
}) {
  const now = Math.floor(Date.now() / 1000);
  return new SignJWT({
    role: input.role,
    ver: input.sessionVersion,
  })
    .setProtectedHeader({
      alg: "RS256",
      kid: config.keyId,
      typ: "JWT",
    })
    .setSubject(String(input.userId))
    .setIssuer(config.issuer)
    .setAudience(config.audience)
    .setIssuedAt(now)
    .setExpirationTime(now + config.accessTtl)
    .setJti(randomToken(24))
    .sign(await privateKey);
}

export async function verifyAccessToken(token: string): Promise<AccessClaims> {
  const result = await jwtVerify(token, await publicKey, {
    issuer: config.issuer,
    audience: config.audience,
    algorithms: ["RS256"],
    requiredClaims: ["sub", "iss", "aud", "iat", "exp", "jti"],
  });

  const payload = result.payload;
  if (typeof payload.sub !== "string" || !/^\d+$/.test(payload.sub)) {
    throw new Error("invalid_sub");
  }
  if (typeof payload.role !== "string") throw new Error("invalid_role");
  if (!Number.isInteger(payload.ver)) throw new Error("invalid_version");

  return payload as AccessClaims;
}
```

The verifier explicitly allows only RS256. Never accept an algorithm from the token header without an application allowlist.

---

## 6. Redis revocation service

Create `src/auth/revocation.ts`:

```ts
import { redis } from "./redis";
import { config } from "./config";

const key = {
  revokedJti: (jti: string) => `auth:jwt:revoked:${jti}`,
  userVersion: (userId: number) => `auth:user:version:${userId}`,
};

export async function revokeAccessToken(jti: string, exp: number) {
  const ttl = Math.max(1, exp - Math.floor(Date.now() / 1000));
  await redis.set(key.revokedJti(jti), "1", { EX: ttl });
}

export async function isAccessTokenRevoked(jti: string) {
  return (await redis.exists(key.revokedJti(jti))) === 1;
}

export async function getUserSessionVersion(userId: number) {
  const value = await redis.get(key.userVersion(userId));
  return value ? Number(value) : 0;
}

export async function incrementUserSessionVersion(userId: number) {
  return redis.incr(key.userVersion(userId));
}

export async function isSessionVersionCurrent(userId: number, tokenVersion: number) {
  return (await getUserSessionVersion(userId)) === tokenVersion;
}

export async function revokeUserAccessTokens(userId: number) {
  // Bumping the version immediately invalidates all access JWTs for this user.
  return incrementUserSessionVersion(userId);
}
```

### When to use each mechanism

- **Single logout**: revoke the current refresh family; optionally denylist the current access JWT by `jti`.
- **Logout everywhere**: increment the user session version and revoke all refresh families.
- **Account suspension or role removal**: increment the session version and revoke all refresh families.
- **Emergency token compromise**: denylist the specific `jti` until its expiry.

The user-version check adds one Redis read per protected request. If that latency is unacceptable, rely on short access-token TTLs for normal logout and reserve version checks for high-risk routes.

---

## 7. Refresh-token records and rotation

Create `src/auth/refresh.ts`:

```ts
import { redis } from "./redis";
import { config } from "./config";
import { randomToken, sha256 } from "./crypto";
import { issueAccessToken } from "./jwt";

const key = {
  token: (hash: string) => `auth:refresh:token:${hash}`,
  family: (familyId: string) => `auth:refresh:family:${familyId}`,
  userFamilies: (userId: number) => `auth:refresh:user-families:${userId}`,
};

type User = { id: number; role: string };

type RefreshRecord = {
  tokenId: string;
  familyId: string;
  userId: number;
  clientId: string;
  issuedAt: number;
  expiresAt: number;
  consumedAt: number | null;
  revokedAt: number | null;
  replacementTokenId: string | null;
};

type FamilyRecord = {
  familyId: string;
  userId: number;
  clientId: string;
  createdAt: number;
  expiresAt: number;
  revokedAt: number | null;
  reason: string | null;
};

export class RefreshAuthError extends Error {
  constructor(public readonly code: string, message = "Session expired") {
    super(message);
  }
}

function ttlFrom(now: number, expiresAt: number) {
  return Math.max(1, Math.ceil((expiresAt - now) / 1000));
}

async function saveRefreshRecord(record: RefreshRecord) {
  const ttl = ttlFrom(Date.now(), record.expiresAt);
  await redis.set(key.token(record.tokenId), JSON.stringify(record), { EX: ttl });
}

async function saveFamily(record: FamilyRecord) {
  const ttl = ttlFrom(Date.now(), record.expiresAt);
  await redis.set(key.family(record.familyId), JSON.stringify(record), { EX: ttl });
  await redis.sAdd(key.userFamilies(record.userId), record.familyId);
  await redis.expire(key.userFamilies(record.userId), ttl);
}

async function readJson<T>(redisKey: string): Promise<T | null> {
  const raw = await redis.get(redisKey);
  return raw ? JSON.parse(raw) as T : null;
}

export async function createLoginTokens(input: {
  user: User;
  clientId: string;
  sessionVersion: number;
}) {
  const now = Date.now();
  const familyId = randomToken(32);
  const rawRefreshToken = randomToken(32);
  const tokenId = randomToken(24);
  const expiresAt = now + config.refreshTtl * 1000;

  await saveFamily({
    familyId,
    userId: input.user.id,
    clientId: input.clientId,
    createdAt: now,
    expiresAt,
    revokedAt: null,
    reason: null,
  });

  await saveRefreshRecord({
    tokenId,
    familyId,
    userId: input.user.id,
    clientId: input.clientId,
    issuedAt: now,
    expiresAt,
    consumedAt: null,
    revokedAt: null,
    replacementTokenId: null,
  });

  await redis.set(key.token(sha256(rawRefreshToken)), tokenId, { EX: ttlFrom(now, expiresAt) });

  return {
    accessToken: await issueAccessToken({
      userId: input.user.id,
      role: input.user.role,
      sessionVersion: input.sessionVersion,
    }),
    refreshToken: rawRefreshToken,
    refreshExpiresAt: new Date(expiresAt),
    familyId,
  };
}
```

The example uses a hash-to-token-ID lookup plus a token record. A production implementation should use an atomic Redis transaction or Lua script for the consume-and-replace operation.

### Atomic rotation Lua script

Create `src/auth/rotate-script.ts`:

```ts
import { redis } from "./redis";

export const rotateRefreshLua = `
local current = redis.call('GET', KEYS[1])
if not current then return 'MISSING' end

local record = cjson.decode(current)
if record.revokedAt ~= cjson.null then return 'REVOKED' end
if record.consumedAt ~= cjson.null then return 'REUSED' end
if tonumber(record.expiresAt) <= tonumber(ARGV[1]) then return 'EXPIRED' end

record.consumedAt = tonumber(ARGV[1])
record.replacementTokenId = ARGV[2]
redis.call('SET', KEYS[1], cjson.encode(record), 'EX', ARGV[3])
return 'OK'
`;

export async function consumeRefreshAtomically(input: {
  recordKey: string;
  nowMs: number;
  replacementTokenId: string;
  ttlSeconds: number;
}) {
  return redis.eval(rotateRefreshLua, {
    keys: [input.recordKey],
    arguments: [
      String(input.nowMs),
      input.replacementTokenId,
      String(input.ttlSeconds),
    ],
  }) as Promise<string>;
}
```

### Rotation service

Append to `src/auth/refresh.ts`:

```ts
export async function rotateRefreshToken(input: {
  rawRefreshToken: string;
  clientId: string;
  getUser(userId: number): Promise<User | null>;
  getSessionVersion(userId: number): Promise<number>;
}) {
  const now = Date.now();
  const rawHash = sha256(input.rawRefreshToken);
  const tokenId = await redis.get(key.token(rawHash));
  if (!tokenId) throw new RefreshAuthError("MISSING");

  const current = await readJson<RefreshRecord>(key.token(tokenId));
  if (!current) throw new RefreshAuthError("MISSING");

  const family = await readJson<FamilyRecord>(key.family(current.familyId));
  if (!family || family.revokedAt) throw new RefreshAuthError("REVOKED");

  if (current.clientId !== input.clientId || family.clientId !== input.clientId) {
    await revokeFamily(current.familyId, "client_mismatch");
    throw new RefreshAuthError("CLIENT_MISMATCH");
  }

  if (current.consumedAt !== null) {
    await revokeFamily(current.familyId, "refresh_token_reuse");
    throw new RefreshAuthError("REUSE_DETECTED");
  }
  if (current.revokedAt !== null || current.expiresAt <= now) {
    throw new RefreshAuthError("EXPIRED");
  }

  const user = await input.getUser(current.userId);
  if (!user) {
    await revokeFamily(current.familyId, "user_missing");
    throw new RefreshAuthError("USER_MISSING");
  }

  const replacementRaw = randomToken(32);
  const replacementId = randomToken(24);
  const replacementExpiresAt = now + config.refreshTtl * 1000;
  const consumeResult = await consumeRefreshAtomically({
    recordKey: key.token(tokenId),
    nowMs: now,
    replacementTokenId: replacementId,
    ttlSeconds: ttlFrom(now, current.expiresAt),
  });

  if (consumeResult !== "OK") {
    if (consumeResult === "REUSED") await revokeFamily(current.familyId, "refresh_race_or_reuse");
    throw new RefreshAuthError(consumeResult);
  }

  const replacement: RefreshRecord = {
    tokenId: replacementId,
    familyId: current.familyId,
    userId: current.userId,
    clientId: current.clientId,
    issuedAt: now,
    expiresAt: replacementExpiresAt,
    consumedAt: null,
    revokedAt: null,
    replacementTokenId: null,
  };

  await saveRefreshRecord(replacement);
  await redis.set(key.token(sha256(replacementRaw)), replacementId, {
    EX: ttlFrom(now, replacementExpiresAt),
  });

  const sessionVersion = await input.getSessionVersion(user.id);
  return {
    accessToken: await issueAccessToken({
      userId: user.id,
      role: user.role,
      sessionVersion,
    }),
    refreshToken: replacementRaw,
    refreshExpiresAt: new Date(replacementExpiresAt),
    user,
  };
}

export async function revokeFamily(familyId: string, reason: string) {
  const family = await readJson<FamilyRecord>(key.family(familyId));
  if (!family || family.revokedAt) return;

  family.revokedAt = Date.now();
  family.reason = reason;
  await redis.set(key.family(familyId), JSON.stringify(family), {
    EX: ttlFrom(Date.now(), family.expiresAt),
  });

  const familyTokenIds = await redis.scanIterator({
    MATCH: "auth:refresh:token:*",
    COUNT: 100,
  });
  for await (const recordKey of familyTokenIds) {
    const record = await readJson<RefreshRecord>(recordKey);
    if (record?.familyId === familyId) {
      record.revokedAt = Date.now();
      await redis.set(recordKey, JSON.stringify(record), {
        EX: ttlFrom(Date.now(), record.expiresAt),
      });
    }
  }
}

export async function revokeAllUserFamilies(userId: number, reason: string) {
  const familyIds = await redis.sMembers(key.userFamilies(userId));
  await Promise.all(familyIds.map((familyId) => revokeFamily(familyId, reason)));
  await redis.del(key.userFamilies(userId));
}
```

For large deployments, do not scan all refresh records during a request. Maintain a per-family token set, or store family state and check it on every rotation. The family check is the authoritative revocation decision; individual-token marking is mainly for cleanup and investigation.

---

## 8. Express middleware and routes

Create `src/auth/http.ts`:

```ts
import type { Express, NextFunction, Request, Response } from "express";
import { config } from "./config";
import { verifyAccessToken } from "./jwt";
import { isAccessTokenRevoked, isSessionVersionCurrent, incrementUserSessionVersion } from "./revocation";
import {
  RefreshAuthError,
  createLoginTokens,
  revokeAllUserFamilies,
  revokeFamily,
  rotateRefreshToken,
} from "./refresh";
import { redis } from "./redis";

export type User = { id: number; role: string };
export type RequestWithUser = Request & { user?: User };

export function setRefreshCookie(res: Response, token: string, expiresAt: Date) {
  res.cookie(config.refreshCookieName, token, {
    httpOnly: true,
    secure: true,
    sameSite: "lax",
    path: "/",
    expires: expiresAt,
  });
}

export function clearRefreshCookie(res: Response) {
  res.clearCookie(config.refreshCookieName, {
    httpOnly: true,
    secure: true,
    sameSite: "lax",
    path: "/",
  });
}

export function requireAccessToken(input: {
  getUser(userId: number): Promise<User | null>;
}) {
  return async (req: RequestWithUser, res: Response, next: NextFunction) => {
    try {
      const header = req.get("authorization");
      const token = header?.startsWith("Bearer ") ? header.slice(7).trim() : "";
      if (!token) return res.status(401).json({ error: "Authentication required" });

      const claims = await verifyAccessToken(token);
      const userId = Number(claims.sub);
      if (await isAccessTokenRevoked(claims.jti!)) {
        return res.status(401).json({ error: "Authentication required" });
      }
      if (!(await isSessionVersionCurrent(userId, claims.ver))) {
        return res.status(401).json({ error: "Authentication required" });
      }

      const user = await input.getUser(userId);
      if (!user) return res.status(401).json({ error: "Authentication required" });
      req.user = user;
      return next();
    } catch {
      return res.status(401).json({ error: "Authentication required" });
    }
  };
}

export function registerAuthRoutes(input: {
  app: Express;
  getUser(userId: number): Promise<User | null>;
  getSessionVersion(userId: number): Promise<number>;
}) {
  const { app, getUser, getSessionVersion } = input;

  app.post("/api/auth/refresh", async (req, res) => {
    const origin = req.get("origin");
    if (origin && origin !== config.trustedOrigin) {
      return res.status(403).json({ error: "Origin not allowed" });
    }

    const raw = req.cookies?.[config.refreshCookieName];
    if (!raw) return res.status(401).json({ error: "Session expired" });

    try {
      const result = await rotateRefreshToken({
        rawRefreshToken: raw,
        clientId: "web",
        getUser,
        getSessionVersion,
      });
      setRefreshCookie(res, result.refreshToken, result.refreshExpiresAt);
      return res.json({ accessToken: result.accessToken });
    } catch (error) {
      clearRefreshCookie(res);
      if (error instanceof RefreshAuthError && error.code.includes("REUSE")) {
        console.warn("refresh_token_reuse_detected");
      }
      return res.status(401).json({ error: "Session expired" });
    }
  });

  app.post("/api/auth/logout", async (req, res) => {
    const raw = req.cookies?.[config.refreshCookieName];
    if (raw) {
      // A production implementation should look up the family by token hash,
      // then revoke it. Never log the raw token.
      await revokeFamilyForRawToken(raw);
    }
    clearRefreshCookie(res);
    return res.status(204).end();
  });

  app.post("/api/auth/logout-all", requireAccessToken({ getUser }), async (req: RequestWithUser, res) => {
    const userId = req.user!.id;
    await Promise.all([
      revokeAllUserFamilies(userId, "logout_all"),
      incrementUserSessionVersion(userId),
    ]);
    clearRefreshCookie(res);
    return res.status(204).end();
  });
}

async function revokeFamilyForRawToken(raw: string) {
  // The raw-token hash is used only to retrieve the token ID. It is never logged.
  const { sha256 } = await import("./crypto");
  const { redis } = await import("./redis");
  const tokenId = await redis.get(`auth:refresh:token:${sha256(raw)}`);
  if (!tokenId) return;
  const record = await redis.get(`auth:refresh:token:${tokenId}`);
  if (!record) return;
  const parsed = JSON.parse(record) as { familyId: string };
  await revokeFamily(parsed.familyId, "logout");
}
```

The `/api/auth/logout-all` route invalidates both refresh families and access tokens through the session-version counter.

---

## 9. Login completion

After a trusted OIDC callback or other verified login:

```ts
app.post("/api/auth/login-complete", async (req, res) => {
  const user = await findLocalUserFromValidatedIdentity(req);
  if (!user) return res.status(401).json({ error: "Authentication failed" });

  const sessionVersion = await getSessionVersion(user.id);
  const tokens = await createLoginTokens({
    user,
    clientId: "web",
    sessionVersion,
  });
  setRefreshCookie(res, tokens.refreshToken, tokens.refreshExpiresAt);
  return res.json({ accessToken: tokens.accessToken });
});
```

Never accept a browser-supplied user ID or role. The login-complete route must only run after server-side validation of the identity provider response.

---

## 10. Redis failure policy

Choose and document a fail-closed policy for security-sensitive routes:

- If Redis is unavailable, reject refresh requests rather than minting tokens without rotation state.
- For protected API routes, either reject requests when revocation checks cannot run or accept only for a tightly bounded outage window with documented risk.
- Never silently bypass revocation because Redis is unavailable.
- Monitor Redis latency, reconnects, memory, evictions, replication lag, and failed commands.
- Configure `maxmemory-policy noeviction` for security state, or isolate auth keys in a dedicated Redis instance.

Redis eviction of a refresh record must behave like session expiry, not like permission to refresh.

---

## 11. Rate limiting

Rate-limit refresh attempts by IP, user when known, and token family:

```ts
export async function allowRefreshAttempt(ip: string) {
  const rateKey = `auth:rate:refresh:${ip}`;
  const count = await redis.incr(rateKey);
  if (count === 1) await redis.expire(rateKey, 60);
  return count <= 30;
}
```

Use a proper sliding-window or token-bucket limiter for production. Do not reveal whether a token, user, or family exists.

---

## 12. Testing checklist

Test all of the following:

- JWT with invalid signature is rejected.
- Wrong issuer or audience is rejected.
- Unsupported algorithm is rejected.
- Missing `sub`, `jti`, `exp`, or session version is rejected.
- Expired JWT is rejected.
- Revoked `jti` is rejected.
- User session-version increment invalidates old JWTs.
- A refresh token rotates once.
- A consumed refresh token causes family revocation.
- Concurrent refresh requests cannot both succeed.
- A refresh token from another client revokes the family.
- Expired refresh records cannot mint access tokens.
- Logout revokes the current refresh family.
- Logout-all revokes families and increments the user version.
- Redis outage fails closed for refresh.
- Cookies have `HttpOnly`, `Secure`, `SameSite=Lax`, `Path=/`, and the `__Host-` prefix.
- Raw JWTs and refresh tokens never appear in logs.
- CORS and Origin checks reject untrusted sites.
- Cross-user authorization checks remain database-backed.

Example Jest/Vitest assertion:

```ts
it("revokes a refresh family when a consumed token is replayed", async () => {
  const first = await rotateRefreshToken(input);
  expect(first.refreshToken).toBeTruthy();

  await expect(rotateRefreshToken(input)).rejects.toMatchObject({
    code: "REUSE_DETECTED",
  });

  const family = await getFamily(first.familyId);
  expect(family?.revokedAt).toBeTruthy();
});
```

## Recommended browser storage model

- Refresh token: **secure HttpOnly cookie**.
- Access token: **memory only**.
- Never store refresh tokens in `localStorage`.
- Keep access JWTs short-lived and use a single-flight refresh promise in the SPA.
- Use CSRF protection and strict Origin/CORS checks because cookies are sent automatically.
