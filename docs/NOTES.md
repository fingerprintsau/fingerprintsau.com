# Fingerprints Project Notes

## Tech stack

React 19, TypeScript, Vite, Tailwind CSS 4, Manrope, tRPC 11, Express, Drizzle ORM, MySQL/TiDB, the legacy OAuth provider, Stripe, S3-compatible object storage, Vitest, and Univer for Docs & Sheets.

## Main folders

- `client/` — React application, pages, components, styles, and client tRPC bindings.
- `client/src/pages/` — Page-level views, including the seller dashboard and Docs & Sheets workspace.
- `client/src/components/` — Shared layouts, UI components, dialogs, and reusable dashboard pieces.
- `server/` — tRPC procedures, database helpers, storage helpers, policies, jobs, and tests.
- `server/_core/` — Framework integrations, authentication, environment, OAuth, and server setup.
- `drizzle/` — Database schema, migrations, and migration metadata.
- `shared/` — Shared constants, types, and error definitions.
- `docs/` — Project documentation and working notes.

## Key files

- Listings: `drizzle/schema.ts`, `server/db.ts`, `server/routers.ts`, `client/src/pages/Home.tsx`.
- Storefront: `client/src/App.tsx`, `client/src/pages/Home.tsx`, `server/db.ts`, `server/routers.ts`.
- Credits/AI: `server/billing.ts`, `server/routers.ts`, `server/aiJobs.ts`, `server/providerAdapters.ts`, `server/aiPolicies.ts`.
- CSV import: `server/csvImport.ts`, `server/routers.ts`, `client/src/pages/Home.tsx`, `drizzle/schema.ts`.
- Docs & Sheets: `client/src/pages/OfficeWorkspace.tsx`, `server/officePolicies.ts`, `server/db.ts`, `server/routers.ts`, `server/storage.ts`, `drizzle/schema.ts`.
- Public buyer pages: `client/src/pages/PublicHome.tsx` (marketplace /), `PublicStorefront.tsx` (/:slug), `PublicListing.tsx` (/listing/:id).

## Rules

- Only change what the task lists.
- Never change existing data without the owner's OK.
- Use Stripe test keys only.
- Never show our costs, providers, or margins to customers.

## Remaining legacy provider dependencies

- Login and session identity: `the retired OAuth route module`, `server/_core/sdk.ts`, `server/_core/env.ts`, `client/src/const.ts`, and `client/src/_core/hooks/useAuth.ts` depend on the legacy OAuth provider endpoints and session behavior.
- File storage: `server/storage.ts`, `server/_core/storageProxy.ts`, `server/_core/env.ts`, and `server/_core/index.ts` use configured provider presigning and `/manus-storage/` redirects instead of the portable S3 settings.
- AI image, speech, and notifications: `server/_core/imageGeneration.ts`, `server/_core/voiceTranscription.ts`, `server/_core/notification.ts`, `server/_core/llm.ts`, `server/providerAdapters.ts`, and `server/_core/env.ts` use configured provider APIs; external Gemini, Higgsfield, and Clipdrop calls are also configured there.
- Maps: `server/_core/map.ts`, `client/src/components/Map.tsx`, and `server/_core/env.ts` use the Manus maps proxy and Forge key.
- legacy development tooling: `vite.config.ts` contains the local browser debug collector and writes the local debug-log directory; the removed browser debug collector is a Manus preview helper.
- Project/runtime scaffolding: `server/_core/context.ts`, `server/_core/systemRouter.ts`, `server/_core/heartbeat.ts`, `the retired OAuth route module`, and `server/_core/sdk.ts` use legacy managed-runtime conventions.
