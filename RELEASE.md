# Fingerprints release notes

Fingerprints is now structured as a seller-facing marketplace workspace with provider adapters, metered creative jobs, Stripe Checkout, and per-storefront block customization.

## Billing policy

The application exposes one catalog from `server/routers.ts`, so the UI and server use the same prices.

| Capability | Included allowance | Default metered price |
| --- | --- | ---: |
| AI model image | First 2 uses | 89¢ AUD / image |
| AI listing write-up | First 2 uses | 19¢ AUD / write-up |
| Condition report | First 2 reports | 39¢ AUD / report |
| Video generation | First 2 jobs | 1.49 AUD / job |
| Single background removal | Always free when processing one image | Free |
| Batch background removal | No free batch allowance | 12¢ AUD / image |

Credit packs are available through Stripe Checkout: 10 credits for 12 AUD, 30 credits for 29 AUD, and 80 credits for 69 AUD. Stripe webhooks fulfil the credit grant after `checkout.session.completed`; the app stores Stripe identifiers and business-specific usage events, not card or redundant payment fields.

## Provider configuration

All provider keys are server-side secrets. Add them in the project payment/secrets settings before enabling the corresponding provider.

| Secret | Purpose |
| --- | --- |
| `STRIPE_SECRET_KEY` | Create Checkout Sessions for credit packs |
| `STRIPE_WEBHOOK_SECRET` | Verify `/api/stripe/webhook` signatures |
| `GEMINI_API_KEY` | Nano Banana 2 through the Gemini Interactions API |
| `HIGGSFIELD_API_KEY_ID` / `HIGGSFIELD_API_KEY_SECRET` | Async Higgsfield image/video jobs |
| `CLIPDROP_API_KEY` | Single and batch background removal |

The built-in Manus provider remains available without an additional provider key. It uses the server-only image helper and LLM helper, so API credentials are never exposed to the browser.

## Self-running shape

The current app is request-driven and safe for managed autoscale hosting. A user action creates a metered usage event; Stripe calls the verified webhook after payment; and provider calls either complete inline (Manus / Nano Banana / Clipdrop) or return a status link (Higgsfield). Nothing depends on a browser tab remaining open.

For a later background-job upgrade, persist Higgsfield `request_id` and `status_url` in a media-jobs table, then add a low-frequency retry/heartbeat worker that downloads completed media to Fingerprints storage. Do not poll a provider from the browser or from a per-request loop.

## Custom storefront blocks

Each seller gets default `hero`, `drop`, `story`, and `social` blocks. The `storefrontBlocks` table stores visibility, copy, configuration JSON, and sort order per user. The editor can reorder and hide blocks immediately; adding new block templates does not require a schema migration.

## Release checklist

1. Add Stripe keys and register the exact webhook URL `/api/stripe/webhook` for `checkout.session.completed` and asynchronous payment events.
2. Add provider secrets for the providers being sold. Leave a provider disabled until its key is present.
3. Test a credit-pack Checkout Session with Stripe's test card `4242 4242 4242 4242` in a Stripe sandbox.
4. Confirm one free AI call, the next free call, and the first metered call for each capability.
5. Confirm single background removal remains free and batch removal requires available credits.
6. Confirm a successful Checkout Session creates a credits ledger event only once per webhook delivery in production.
7. Add a production privacy policy, terms, refund/cancellation rules, and clear provider-charge disclosure before opening paid access.

Official provider references: [Nano Banana / Gemini image generation](https://ai.google.dev/gemini-api/docs/image-generation), [Higgsfield API](https://docs.higgsfield.ai/docs), and [Clipdrop background removal](https://clipdrop.co/apis/docs/remove-background).
