# Architecture

## High-level

A single-page React application (no router library — hand-rolled History API routing)
with three top-level surfaces:

| Route | Surface | Loading |
|---|---|---|
| `/`, `/report/:id`, `/ward/:n`, `/mla/:n`, `/mp/:n` | `PublicApp` — feed, map, report wizard, profiles | eager |
| `/admin` | `AdminPanel` — moderation queue | lazy chunk |
| map view (inside PublicApp) | `MapView` — MapLibre GL | lazy chunk |

An `ErrorBoundary` at the root catches render/lazy-chunk failures and offers reload.

## Backend abstraction (`src/services/backend.ts`)

`Backend` is an interface (`src/types/domain.ts`) with two implementations behind a
singleton chosen at startup:

- **`SupabaseBackend`** (production) — PostgREST queries against a hardened,
  RLS-protected schema; Storage XHR uploads with progress; Supabase Realtime
  subscriptions with manual reconnect/backoff; admin operations proxied through
  an Edge Function.
- **`LocalBackend`** (demo) — static JSON seeds from `/public/*.json` overlaid with
  a localStorage report cache. Runs automatically when Supabase env vars are absent.

> ⚠️ Structural note: `SupabaseBackend extends LocalBackend`. Every interface method
> must be overridden or demo logic silently runs against production. All 16 are
> overridden today; composition is the recommended long-term refactor.

### Data flow

```
App (owns CivicData state)
 └─ backend.fetchCivicData()  → wards + representatives + boundary
 └─ backend.fetchReports()    → approved reports (paged, realtime-refreshed)
      ↑ realtime ping triggers refetch (sanitized signal tables)
```

## Database (Supabase)

Key tables: `garbage_reports`, `report_upvotes`, `wards`, `representatives`,
`ward_escalations`, plus two sanitized realtime signal tables.

Security invariants (enforced across migrations in `supabase/migrations/`):

1. **RLS everywhere**; anon can only INSERT reports/upvotes and read approved data.
2. **GPS masking**: public reads go through `public_garbage_reports`
   (`security_invoker`, `security_barrier`) which replaces exact coordinates with
   the ward centroid. Raw lat/lng is not granted to anon.
3. **Storage**: `garbage-photos` bucket allows anon INSERT under `reports/` and
   `cleanup/` prefixes only — no overwrite, no delete, no listing.
4. **Cleanup proofs**: anonymous RPC `submit_cleanup_proof` re-flags a report into
   the moderation queue after validation (bucket-scoped URLs, coordinate bounds,
   row locking, metadata merge).
5. **Admin path**: all moderation writes go through the `admin-moderation` edge
   function (service role), gated by an `ADMIN_KEY` header and CORS allow-list.

## Frontend services

| Module | Responsibility |
|---|---|
| `geo.ts` | point-in-polygon, haversine, bbox helpers |
| `i18n.ts` | EN/OR dictionaries, `t()` interpolation, language persistence |
| `escalation.ts` | days-open → escalation level (0–5) |
| `limits.ts` | client-side daily report limit, device fingerprint, upvote dedupe |
| `duplicate-check.ts` | distance-based near-duplicate detection |
| `share.ts` | Web Share API with clipboard fallback |
| `time.ts` | relative time formatting (i18n-aware) |
| `map-markers.ts` / `map-coverage.ts` | marker clustering/displacement, ward coverage stats |

## Deployment

GitHub Actions CI runs lint → typecheck → unit tests → build → Playwright e2e.
Vercel deploys `main`; `vercel.json` provides SPA rewrites, immutable asset
caching, and security headers (CSP pins the Supabase project host and CARTO tiles).
