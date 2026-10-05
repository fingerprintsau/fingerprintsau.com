# Provider-neutral OIDC local setup

These files are the replacement path for the current authentication implementation. The active legacy login path is intentionally still wired in `server/_core/index.ts` until the migration checklist is complete.

## Replacement files

- `server/_core/oidcEnv.ts` — provider-neutral OIDC configuration.
- `server/_core/oidcAuth.ts` — discovery, authorization-code + PKCE login, ID-token validation, local user provisioning, signed session cookie, and logout.
- `server/_core/oidcContext.ts` — tRPC context using the replacement session.
- `client/src/oidcAuth.ts` — browser redirects to local `/auth/login` and `/auth/logout` routes; no browser token storage.
- `client/src/_core/hooks/useOidcAuth.ts` — replacement React auth hook.

## Local variables

Set these in a local `.env` file. Do not commit it.

```dotenv
OIDC_ISSUER_URL=https://your-provider.example.com
OIDC_CLIENT_ID=your-local-client-id
OIDC_CLIENT_SECRET=your-local-client-secret
OIDC_REDIRECT_URI=http://localhost:3000/auth/callback
OIDC_SCOPES=openid profile email
OIDC_SESSION_SECRET=generate-a-long-random-secret
OIDC_SESSION_MAX_AGE_SECONDS=2592000
JWT_SECRET=another-long-random-secret-for-existing-code
DATABASE_URL=mysql://user:password@localhost:3306/fingerprints
```

Register the exact redirect URI with the selected provider. Use HTTPS and a secure secret outside local development.

## Activation sequence

1. Add `registerOidcRoutes(app)` to the server startup.
2. Change the tRPC middleware to use `createOidcContext`.
3. Change the client bootstrap to use `startOidcLogin` and remove the browser-token header fallback.
4. Replace dashboard imports of `useAuth` with `useOidcAuth`.
5. Add callback, logout, session, account-provisioning, and protected-route tests.
6. Verify existing sellers resolve to the same local records and listings.
7. Run the final removal checklist in `docs/AUTH-MIGRATION-GUIDE.md`.
8. Only then delete the files marked `TO DELETE`.

The replacement files are not active yet, so this change does not alter current login behavior or existing seller data.
