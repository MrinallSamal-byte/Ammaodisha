<div align="center">

# 🗑️ Amma Odisha

**Crowdsourced garbage reporting & civic accountability for Bhubaneswar, India**

Report garbage dumps with photo + GPS · Auto-detect your ward, MLA & MP · Track resolution over time

[![CI](https://github.com/MrinallSamal-byte/Garbage_BBSR/actions/workflows/ci.yml/badge.svg)](https://github.com/MrinallSamal-byte/Garbage_BBSR/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)
![Tests](https://img.shields.io/badge/tests-87%20passing-brightgreen)
[![Live site](https://img.shields.io/badge/live-ammaodisha.me-e31b23)](https://www.ammaodisha.me)

</div>

---

Amma Odisha ("Our Odisha") is a bilingual (English / ଓଡ଼ିଆ) progressive web app that lets citizens
report uncollected garbage across Bhubaneswar's **67 wards** — and see exactly which
public representative is accountable for it. Reports age publicly through an escalation
ladder, so neglect becomes visible and measurable.

## ✨ Features

- 📸 **Photo reports with GPS** — camera capture, client-side compression, automatic thumbnail generation
- 🗺️ **Interactive ward map** — MapLibre GL with clustered markers, ward boundaries, and coverage overlay
- 🏛️ **Accountability mapping** — every report resolves to its ward councillor, MLA, and MP with contact channels
- ⏳ **Escalation ladder** — reports visually escalate from *New → Active → Aging → Stale → Critical → Emergency* based on how long they've been unresolved
- 🔁 **Duplicate detection** — nearby open reports are surfaced while filing to reduce noise
- ✅ **Cleanup proofs** — anyone can submit a "cleaned" photo; submissions are re-flagged into the moderation queue for verification
- 👍 **Community upvotes** — one vote per device fingerprint, atomic server-side counters
- 🛡️ **Moderation queue** — admin panel for approve/reject/restore, bulk actions, undo, and keyboard shortcuts
- 🌐 **Bilingual UI** — full English and Odia parity with a translation test guarding drift
- 📱 **Installable PWA** — offline shell via service worker, add-to-homescreen ready
- ⚡ **Realtime updates** — sanitized Supabase Realtime signals keep the public feed live
- 🔒 **Privacy-first design** — no accounts required; exact GPS coordinates are masked to ward centroids in all public surfaces

## 🧱 Tech stack

| Layer | Tools |
|---|---|
| Frontend | React 18, TypeScript, Vite 6, Tailwind CSS 3 |
| Map | MapLibre GL JS 4 + CARTO basemaps |
| Backend | Supabase (Postgres + PostGIS, RLS, Storage, Edge Functions, Realtime) |
| Testing | Vitest 3 (unit), Playwright (e2e) |
| CI/CD | GitHub Actions → Vercel |

## 🚀 Getting started

**Prerequisites:** Node.js ≥ 20 (22 recommended), npm.

```bash
git clone https://github.com/MrinallSamal-byte/Garbage_BBSR.git
cd Garbage_BBSR
npm install
cp .env.example .env.local   # then fill in your values
npm run dev                  # http://localhost:5173
```

### Environment variables

| Variable | Required | Purpose |
|---|---|---|
| `VITE_SUPABASE_URL` | yes (prod mode) | Your Supabase project URL |
| `VITE_SUPABASE_PUBLISHABLE_KEY` | yes (prod mode) | Browser-safe publishable key (legacy `VITE_SUPABASE_ANON_KEY` also supported) |
| `VITE_ADMIN_FUNCTION_URL` | yes (admin panel) | URL of the `admin-moderation` edge function |
| `VITE_LOCAL_ADMIN_KEY` | no | Enables the static-JSON fallback admin mode (**local dev only** — never set in production) |
| `SUPABASE_URL` / `SUPABASE_SECRET_KEY` | seed scripts only | Server-only secret key for seeding (**never** prefix with `VITE_`) |
| `ADMIN_KEY` | edge function | Shared secret the admin panel must send |
| `ADMIN_ALLOWED_ORIGINS` | edge function | CORS allow-list for admin calls |

> Without Supabase env vars the app runs in **demo mode**: static seed data from
> `/public/*.json`, fully functional UI, localStorage persistence. Great for exploring the codebase.

### Scripts

| Command | Description |
|---|---|
| `npm run dev` | Start Vite dev server |
| `npm run build` | Typecheck (`tsc -b`) + production build |
| `npm run lint` | ESLint with zero-warning policy |
| `npm run typecheck` | TypeScript project build check |
| `npm test` | Run unit tests (Vitest) |
| `npm run e2e` | Run Playwright e2e suite |
| `npm run check:supabase` | Round-trip health probe of a Supabase project |
| `npm run seed:pull` | Import seed data from a source project |
| `npm run seed:supabase` | Upsert seed data into your project (`SEED_DRY_RUN=1` to preview) |

## 🏗️ Architecture

```
┌───────────────────────────── Browser ─────────────────────────────┐
│  React SPA (no router lib — history API)                          │
│  ├─ PublicApp  : feed, map, report wizard, profiles, modals       │
│  ├─ AdminPanel : moderation queue (lazy-loaded)                   │
│  └─ MapView    : MapLibre GL clusters + ward layers (lazy-loaded) │
│                                                                   │
│  Backend abstraction (src/services/backend.ts)                    │
│  ├─ LocalBackend    : static JSON seeds + localStorage (demo)     │
│  └─ SupabaseBackend : PostgREST views/RPCs, Storage XHR uploads,  │
│                       realtime subscriptions w/ reconnect         │
└───────────────┬───────────────────────────────────────────────────┘
                │ anon key (RLS-scoped)
┌───────────────▼───────────── Supabase ────────────────────────────┐
│  garbage_reports ──▶ public_garbage_reports VIEW (approved-only,  │
│  report_upvotes      GPS masked to ward centroid)                 │
│  wards / representatives / ward_escalations                       │
│  Storage: garbage-photos bucket (insert-only for clients)         │
│  Edge fn: admin-moderation (ADMIN_KEY header, service role)       │
│  Realtime: sanitized change-signal tables                         │
└───────────────────────────────────────────────────────────────────┘
```

Deep dive: [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) · Security model: [SECURITY.md](SECURITY.md)

## 🗄️ Database setup (your own instance)

1. Create a Supabase project
2. `supabase link && supabase db push` — applies migrations in `supabase/migrations/`
3. Deploy the edge function: `supabase functions deploy admin-moderation`
4. Set its secrets: `ADMIN_KEY`, `ADMIN_ALLOWED_ORIGINS`
5. Fill `.env.local` and run `npm run check:supabase` to verify

## 🤝 Contributing

PRs welcome! See [CONTRIBUTING.md](CONTRIBUTING.md). Every PR runs lint + typecheck +
87 unit tests + build in CI — please make sure they pass locally first:

```bash
npm run lint && npm run typecheck && npm test
```

## 🐛 Reporting issues

Found a bug or have a feature idea? Open an issue using the templates.
Security vulnerabilities: please follow [SECURITY.md](SECURITY.md) — do not open public issues.

## 📜 License

[MIT](LICENSE) © Amma Odisha contributors

---

<div align="center">
<sub>Built for a cleaner Bhubaneswar 🇮🇳 · ଅମା ଓଡ଼ିଶା, ସ୍ୱଚ୍ଛ ଓଡ଼ିଶା</sub>
</div>
