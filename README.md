# Fingerprints

**The only hub a seller needs, and the place sellers collab.**
[fingerprintsau.com](https://fingerprintsau.com) · Bendigo, Victoria, Australia

Fingerprints is an Australian online marketplace and seller hub. Sellers list once and sell everywhere, with a free storefront, pay-as-you-go AI listing tools and a community for collabs.

> **Private and proprietary.** This code is confidential. Do not share, copy or publish it. See [LICENSE](LICENSE).

---

## What's in it

- **Marketplace:** search, filters and seller-balanced browsing of live listings
- **Seller dashboard:** inventory, bulk CSV import (eBay-friendly), up to 12 photos per listing
- **Free storefronts:** `fingerprintsau.com/your-shop`
- **AI tools (credits):** background removal, write-ups, condition reports, model images, short videos
- **Product feed:** `/feeds/products.xml` for Google Merchant Center and Meta catalogues
- **Docs & Sheets:** seller documents and spreadsheets (Univer)
- **Launch bonus:** Founding Seller credits and badge
- **Legal pages:** Terms, Privacy, Seller Agreement, Refunds and Credits, Prohibited Items, Community Guidelines, Cookies, Contact

## Tech stack

React 19 · TypeScript · Vite · Tailwind CSS · tRPC · Express · Drizzle ORM · MySQL · Stripe · Vitest

## Getting started

1. Install Node.js (LTS).
2. Copy `.env.example` to `.env` and fill in the values. **Never commit `.env`.**
3. Install and run:

```bash
npm install
npm run build
npm start
```

Health check: `GET /health` returns `ok`.

Tests:

```bash
npm test
```

## Environments

| Environment | Address | Notes |
|---|---|---|
| Staging | staging.fingerprintsau.com | Password protected, not indexed, Stripe **test** keys only |
| Production | fingerprintsau.com | Live keys set only in the host's settings screen |

## Rules for anyone working on this code

1. **No secrets in code or in Git.** Keys and passwords go in environment settings only.
2. **Never change existing listing or user data** without the owner's written OK.
3. **Stripe test keys** everywhere except production.
4. **Never show our costs, AI providers or margins to customers.**
5. **Only use licences that allow commercial use** (MIT, Apache-2.0, BSD). No AGPL or non-commercial models or libraries.
6. Read `docs/NOTES.md` before making changes.

## Contact

M A Swanson, Founder · shop@fingerprintsau.com · ABN 52 599 426 157

© 2026 Fingerprints. All rights reserved.
