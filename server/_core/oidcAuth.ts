import { createHash, randomBytes } from "node:crypto";
import { parse as parseCookies } from "cookie";
import type { Request, Response } from "express";
import { SignJWT, createRemoteJWKSet, jwtVerify } from "jose";
import * as db from "../db";
import { OIDC_ENV, assertOidcConfig } from "./oidcEnv";

const SESSION_COOKIE = "fingerprints_session";
const STATE_COOKIE = "fingerprints_oidc_state";

type Discovery = {
  authorization_endpoint: string;
  token_endpoint: string;
  userinfo_endpoint?: string;
  jwks_uri: string;
  issuer: string;
};

type IdClaims = {
  iss: string;
  sub: string;
  aud: string | string[];
  nonce?: string;
  name?: string;
  email?: string;
  preferred_username?: string;
};

type StatePayload = {
  state: string;
  nonce: string;
  verifier: string;
  redirectUri: string;
};

let discoveryPromise: Promise<Discovery> | undefined;
function discovery(): Promise<Discovery> {
  assertOidcConfig();
  discoveryPromise ??= fetch(`${OIDC_ENV.issuerUrl.replace(/\/+$/, "")}/.well-known/openid-configuration`)
    .then(async response => {
      if (!response.ok) throw new Error("OIDC discovery failed");
      return response.json() as Promise<Discovery>;
    });
  return discoveryPromise;
}

function base64Url(value: Buffer): string {
  return value.toString("base64url");
}

function randomToken(): string {
  return base64Url(randomBytes(32));
}

function sha256(value: string): string {
  return createHash("sha256").update(value).digest("base64url");
}

function cookieOptions(req: Request) {
  const forwarded = String(req.headers["x-forwarded-proto"] ?? "").split(",")[0].trim();
  return {
    httpOnly: true,
    secure: req.protocol === "https" || forwarded === "https",
    sameSite: "lax" as const,
    path: "/",
  };
}

function readState(req: Request): StatePayload | null {
  const raw = parseCookies(req.headers.cookie ?? "")[STATE_COOKIE];
  if (!raw) return null;
  try {
    const value = JSON.parse(Buffer.from(raw, "base64url").toString("utf8")) as StatePayload;
    if (!value.state || !value.nonce || !value.verifier || !value.redirectUri) return null;
    return value;
  } catch {
    return null;
  }
}

function encodeState(value: StatePayload): string {
  return Buffer.from(JSON.stringify(value), "utf8").toString("base64url");
}

async function exchangeCode(code: string, verifier: string, config: Discovery) {
  const body = new URLSearchParams({
    grant_type: "authorization_code",
    code,
    redirect_uri: OIDC_ENV.redirectUri,
    client_id: OIDC_ENV.clientId,
    client_secret: OIDC_ENV.clientSecret,
    code_verifier: verifier,
  });
  const response = await fetch(config.token_endpoint, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body,
  });
  if (!response.ok) throw new Error("OIDC token exchange failed");
  return response.json() as Promise<{ id_token?: string; access_token?: string }>;
}

async function validateIdToken(idToken: string, config: Discovery, nonce: string): Promise<IdClaims> {
  const keys = createRemoteJWKSet(new URL(config.jwks_uri));
  const { payload } = await jwtVerify(idToken, keys, {
    issuer: config.issuer,
    audience: OIDC_ENV.clientId,
    requiredClaims: ["iss", "sub", "aud", "exp", "iat"],
  });
  if (payload.nonce !== nonce) throw new Error("OIDC nonce validation failed");
  return payload as IdClaims;
}

export function registerOidcRoutes(app: { get: Function; post: Function }) {
  app.get("/auth/login", async (req: Request, res: Response) => {
    try {
      const config = await discovery();
      const state: StatePayload = {
        state: randomToken(),
        nonce: randomToken(),
        verifier: randomToken(),
        redirectUri: OIDC_ENV.redirectUri,
      };
      const challenge = sha256(state.verifier);
      res.cookie(STATE_COOKIE, encodeState(state), {
        ...cookieOptions(req),
        maxAge: 600_000,
      });
      const url = new URL(config.authorization_endpoint);
      url.searchParams.set("client_id", OIDC_ENV.clientId);
      url.searchParams.set("response_type", "code");
      url.searchParams.set("redirect_uri", OIDC_ENV.redirectUri);
      url.searchParams.set("scope", OIDC_ENV.scopes);
      url.searchParams.set("state", state.state);
      url.searchParams.set("nonce", state.nonce);
      url.searchParams.set("code_challenge", challenge);
      url.searchParams.set("code_challenge_method", "S256");
      res.redirect(url.toString());
    } catch (error) {
      console.error("[OIDC] Login failed", error);
      res.status(503).send("Login is temporarily unavailable");
    }
  });

  app.get("/auth/callback", async (req: Request, res: Response) => {
    const code = typeof req.query.code === "string" ? req.query.code : "";
    const returnedState = typeof req.query.state === "string" ? req.query.state : "";
    const state = readState(req);
    res.clearCookie(STATE_COOKIE, cookieOptions(req));
    if (!code || !returnedState || !state || returnedState !== state.state) {
      res.status(400).send("Invalid sign-in response");
      return;
    }

    try {
      const config = await discovery();
      const tokens = await exchangeCode(code, state.verifier, config);
      if (!tokens.id_token) throw new Error("OIDC response did not include an ID token");
      const claims = await validateIdToken(tokens.id_token, config, state.nonce);
      const openId = `${claims.iss}|${claims.sub}`;
      await db.upsertUser({
        openId,
        name: claims.name ?? claims.preferred_username ?? null,
        email: claims.email ?? null,
        loginMethod: "oidc",
        lastSignedIn: new Date(),
      });
      const user = await db.getUserByOpenId(openId);
      if (!user) throw new Error("Local user provisioning failed");
      const session = await signSession(user.id, openId);
      res.cookie(SESSION_COOKIE, session, {
        ...cookieOptions(req),
        maxAge: OIDC_ENV.sessionMaxAgeSeconds * 1000,
      });
      res.redirect("/");
    } catch (error) {
      console.error("[OIDC] Callback failed", error);
      res.status(500).send("Sign-in could not be completed");
    }
  });

  app.post("/auth/logout", (_req: Request, res: Response) => {
    res.clearCookie(SESSION_COOKIE, { httpOnly: true, sameSite: "lax", path: "/" });
    res.status(204).end();
  });
}

export async function signSession(userId: number, openId: string): Promise<string> {
  assertOidcConfig();
  return new SignJWT({ userId, openId })
    .setProtectedHeader({ alg: "HS256", typ: "JWT" })
    .setIssuedAt()
    .setExpirationTime(`${OIDC_ENV.sessionMaxAgeSeconds}s`)
    .sign(new TextEncoder().encode(OIDC_ENV.sessionSecret));
}

export async function getSessionUser(req: Request) {
  const raw = parseCookies(req.headers.cookie ?? "")[SESSION_COOKIE];
  if (!raw) return null;
  try {
    const { payload } = await jwtVerify(raw, new TextEncoder().encode(OIDC_ENV.sessionSecret), { algorithms: ["HS256"] });
    const openId = typeof payload.openId === "string" ? payload.openId : "";
    if (!openId) return null;
    return db.getUserByOpenId(openId);
  } catch {
    return null;
  }
}

export { SESSION_COOKIE };
