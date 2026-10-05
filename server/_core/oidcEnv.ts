export const OIDC_ENV = {
  issuerUrl: process.env.OIDC_ISSUER_URL ?? "",
  clientId: process.env.OIDC_CLIENT_ID ?? "",
  clientSecret: process.env.OIDC_CLIENT_SECRET ?? "",
  redirectUri: process.env.OIDC_REDIRECT_URI ?? "http://localhost:3000/auth/callback",
  scopes: process.env.OIDC_SCOPES ?? "openid profile email",
  sessionSecret: process.env.OIDC_SESSION_SECRET ?? process.env.JWT_SECRET ?? "",
  sessionMaxAgeSeconds: Number(process.env.OIDC_SESSION_MAX_AGE_SECONDS ?? 60 * 60 * 24 * 30),
};

export function assertOidcConfig() {
  const missing = [
    ["OIDC_ISSUER_URL", OIDC_ENV.issuerUrl],
    ["OIDC_CLIENT_ID", OIDC_ENV.clientId],
    ["OIDC_CLIENT_SECRET", OIDC_ENV.clientSecret],
    ["OIDC_REDIRECT_URI", OIDC_ENV.redirectUri],
    ["OIDC_SESSION_SECRET or JWT_SECRET", OIDC_ENV.sessionSecret],
  ].filter(([, value]) => !value).map(([name]) => name);

  if (missing.length > 0) {
    throw new Error(`OIDC configuration is incomplete: ${missing.join(", ")}`);
  }
}
