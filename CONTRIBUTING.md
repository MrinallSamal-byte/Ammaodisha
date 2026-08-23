# Contributing to Amma Odisha

Thanks for helping build a cleaner Bhubaneswar! 🧹

## Getting set up

```bash
git clone https://github.com/MrinallSamal-byte/Garbage_Reporter_BBSR.git
cd Garbage_Reporter_BBSR
npm install
cp .env.example .env.local   # fill in Supabase creds (or run in demo mode without them)
npm run dev
```

No Supabase credentials? The app runs in **demo mode** with static seed data — perfect for UI work.

## Before you open a PR

CI enforces all of these, so please run them locally:

```bash
npm run lint        # ESLint, zero warnings allowed
npm run typecheck   # tsc -b
npm test            # Vitest unit suite
npm run e2e         # Playwright (optional but appreciated for UI changes)
```

## Ground rules

- **TypeScript strict** — no `any` unless truly unavoidable; no `@ts-ignore`.
- **Zero-warning lint policy** — `eslint --max-warnings=0` is enforced.
- **Tests**: bug fixes should come with a regression test when practical.
  New i18n strings must be added to **both** English and Odia dictionaries
  (`src/services/i18n.ts`) — a parity test will catch drift.
- **Security-sensitive code** (RLS migrations, edge functions, storage policies)
  requires extra scrutiny; please explain the threat model in your PR description.
- **Comments**: keep them for *why*, not *what*.
- Keep commits focused; rebase rather than merge when updating your branch.

## Backend / schema changes

1. Add a new SQL migration in `supabase/migrations/` — never edit applied migrations.
2. Verify RLS is enabled and grants are minimal for any new table/function.
3. Test with `npm run check:supabase` against a dev project.
4. If adding columns consumed by the frontend, remember `SupabaseBackend` and
   `LocalBackend` in `src/services/backend.ts` must stay behaviorally in sync.

## Areas that need help

- Server-side rate limiting & captcha integration
- Admin auth upgrade from shared key to Supabase Auth roles
- Odia translation review from native speakers
- Accessibility passes on the report wizard
- Performance: virtualizing the public feed list

## Code of conduct

Be kind and constructive. See [CODE_OF_CONDUCT.md](CODE_OF_CONDUCT.md).
