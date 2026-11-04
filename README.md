# Amma Odisha — Crowdsourced Garbage Map for Bhubaneswar

Citizens report garbage dumps with GPS + photo evidence; every report is mapped to one of
BMC's 67 wards and linked to the responsible **MLA and MP**. Upvotes keep pressure on the
spot until it is cleaned. An admin moderation queue keeps misleading reports off the public
map.

**Production:** https://ammaodisha.me · **Admin:** https://ammaodisha.me/admin

---

## What it does

- **Map-first reporting** — tap the map, auto-detect your ward (or search it), add a photo + landmark, submit. Ward, MLA and MP are attached automatically.
- **Public accountability** — every dump shows severity, age, upvotes, ward, MLA/MP with contact links, and a one-tap WhatsApp complaint to BMC.
- **Cleanup verification** — anyone within 500 m can submit a cleanup photo; an admin approves it and the report flips to Resolved with before/after comparison.
- **Moderation queue** — `/admin` reviews flagged reports (NSFW, not-civic, abusive text, duplicates, cleanup proofs) before they go public.
- **Worst-wards leaderboard** — insights sheet ranks wards by active reports; CSV export for RTI filings and press use.
- **Works on flaky connections** — offline detection, compressed uploads, report-draft auto-save, last-loaded data stays visible.

## Architecture

```
┌────────────────────────────┐       ┌────────────────────────────────┐
│  React SPA (Vite, TS)      │       │  Supabase (hosted)             │
│                            │ rpc   │  ├─ Postgres + PostGIS          │
│  src/                      │──────▶│  ├─ public_garbage_reports view │
│   components/  PublicApp   │ REST  │  │   (approved only, masked GPS) │
│   MapView / AdminPanel     │──────▶│  ├─ garbage_reports / upvotes   │
│   services/                │       │  ├─ Storage: garbage-photos      │
│    backend.ts  (data)      │ WS    │  ├─ Realtime signal tables       │
│    geo, limits, share ...  │◀─────▶│  ├─ RPC: submit_cleanup_proof    │
│   supabase/migrations      │ anon  │  └─ Edge fn: admin-moderation    │
└────────────────────────────┘       └────────────────────────────────┘
```

**Data flow:** `App.tsx` → `backend.fetchCivicData()` → `CivicData` (wards, boundaries,
representatives, approved reports) → `PublicApp` → map/list/detail sheets.

**Backend selection** (`src/services/backend.ts`): when `VITE_SUPABASE_URL` and a
publishable key are set, `SupabaseBackend` is used. Otherwise the app falls back to
`LocalBackend`, which reads the seed JSON in `public/` — useful for offline development.
The Supabase backend also falls back to the seed on hard failures (with a console
warning), so the map never white-screens.

**Moderation pipeline:** every submission starts `flagged` → admin reviews in `/admin` →
`approved` (public) or `rejected`. Cleanup proofs go through the same queue with
`cleanup_pending` metadata; approving one also marks the report `resolved`.

## Tech stack

Vite 6 · React 18 · TypeScript (strict) · MapLibre GL · Supabase JS 2 · Tailwind 3 ·
Vitest + Testing Library · Playwright · ESLint 9 (zero warnings allowed)

## Getting started

Prerequisites: **Node.js 22+**, npm 10+.

```bash
npm ci
cp .env.example .env.local   # fill in your keys (see below)
npm run dev                  # http://localhost:5173
```

Without any keys, the app runs in **local mode** off the bundled seed data (789 sample
reports) — handy for UI work; the admin panel stays disabled unless `VITE_LOCAL_ADMIN_KEY`
is set.

### Verification

```bash
npm run lint     # eslint, --max-warnings=0
npm test         # vitest unit/component tests (jsdom)
npm run build    # tsc -b && vite build
npm run e2e      # playwright (starts dev server on :4173)
```

## Environment variables

See `.env.example` for the annotated template. Essentials:

| Variable | Where | Purpose |
|---|---|---|
| `VITE_SUPABASE_URL` | browser | Supabase project URL |
| `VITE_SUPABASE_PUBLISHABLE_KEY` (or legacy `VITE_SUPABASE_ANON_KEY`) | browser | Public anon/publishable key |
| `VITE_ADMIN_FUNCTION_URL` | browser | Edge function endpoint for `/admin` |
| `VITE_LOCAL_ADMIN_KEY` | **dev only** | Enables the admin panel in local (seed) mode. Never set in production. |
| `SUPABASE_URL` / `SUPABASE_SECRET_KEY` | scripts only | Seed/check scripts (`scripts/seed-supabase.mjs`, `check-supabase.mjs`) |
| `ADMIN_KEY` | edge function | Shared secret for `/admin` moderation calls |
| `ADMIN_ALLOWED_ORIGINS` | edge function | Comma-separated CORS allowlist |

## Database & edge function

Migrations live in `supabase/migrations/` and are applied in filename order:

```bash
supabase db push                              # apply migrations
supabase functions deploy admin-moderation    # redeploy the admin edge function
```

> **2026-11-03 migration `20261103000000_cleanup_proof_merge_metadata.sql`** changes
> `submit_cleanup_proof` to merge `moderation_metadata` instead of replacing it (the
> cleanup submission no longer wipes the audit trail). The frontend is compatible with
> either version; the merge is strictly better. Deploy when convenient — no downtime,
> no data backfill needed.

## Project structure

```
src/
  main.tsx                 # entry + ErrorBoundary
  App.tsx                  # routing (/, /report/:id, /ward/:id, /mla/:id, /mp/:id, /admin)
  components/
    PublicApp.tsx          # public shell: map/list, sheets, report wizard
    MapView.tsx            # MapLibre map, clusters, ward fills, focus logic
    AdminPanel.tsx         # /admin moderation queue
    MyReportsSheet.tsx     # "My Reports" — track your submissions
    DialogSurface.tsx      # shared accessible dialog/bottom-sheet primitive
    ErrorBoundary.tsx      # crash recovery screen
  services/
    backend.ts             # SupabaseBackend (+ LocalBackend fallback)
    geo.ts                 # haversine distance, point-in-polygon ward lookup
    limits.ts              # fingerprint + 5 reports/day client throttle
    share.ts               # BMC complaint builder, share/copy helpers
    prefs.ts               # persisted view prefs + shareable ?ward&… URLs
    export.ts              # CSV export (RTI-friendly)
    my-reports.ts          # local record of your submissions
    map-markers.ts         # marker decluttering/placement
    map-coverage.ts        # city mask/border geojson
    report-images.ts       # image validation + licensed fallback images
  types/domain.ts          # all shared types (CivicData, GarbageReport, Backend…)
supabase/
  migrations/              # schema, RLS, view, RPCs (apply in order)
  functions/admin-moderation/  # Deno edge function: stats/queue/moderate/bulk/swap/reject
public/
  reports.json             # seed reports (local/demo mode)
  wards.json, ward-boundaries.json, bmc-boundary.json   # BMC geo data
  bbsr-political-mapping.json, representatives.json      # MLA/MP mapping
  robots.txt, sitemap.xml, manifest.json, OG.jpg
tests/
  unit/                    # vitest
  e2e/                     # playwright
docs/                      # design/audit notes
```

## Testing

- Unit/component: `npm test` — geometry, limits, share text, export CSV, image pool, map coverage, admin panel, public surface.
- E2E: `npm run e2e` — Playwright smoke tests (desktop + Pixel 7). Requires `npx playwright install chromium` on first run.
- CI deploys from `main` via Vercel; `vercel.json` holds SPA rewrites, security headers (CSP, X-Frame-Options, …) and cache policy.

## Moderation & data integrity notes

- Seed/demo reports whose photos are missing are shown with **licensed representative
  images**; the detail view and admin card label them as such. User-uploaded photos
  never carry this label.
- All investigative/offensive photos in the admin queue can be NSFW-covered; reveal
  requires an explicit tap.
- The public view masks GPS coordinates to ward level (privacy); exact lat/lng are
  stored but never exposed anonymously.

## License

No license file is present — treat the source as proprietary/all-rights-reserved
unless the owner adds one.
