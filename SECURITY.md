# Security Policy

## Reporting a vulnerability

Please do **not** open a public GitHub issue for security vulnerabilities.

Instead, report privately:

- **GitHub:** Use [Security → Report a vulnerability](https://github.com/MrinallSamal-byte/Garbage_BBSR/security/advisories/new)
- **Email:** the repository owner (see GitHub profile)

Include: description, affected component/URL, reproduction steps, and impact assessment.
You will get an acknowledgment within 72 hours. We ask for up to 90 days for a fix
before public disclosure.

## Security model

| Layer | Control |
|---|---|
| Database | Row Level Security on all tables; anon role can only INSERT reports/upvotes and read approved, sanitized data |
| GPS privacy | Public surfaces use a `security_invoker` view that masks exact coordinates to ward centroids; raw lat/lng is not granted to anon |
| Photos | Storage bucket is insert-only for clients (no overwrite/delete); listing disabled |
| Admin | All moderation flows through one Edge Function gated by an `ADMIN_KEY` header + strict CORS origin allow-list, executed with the service role |
| Transport | Strict CSP, `X-Frame-Options: DENY`, `nosniff`, referrer policy set in `vercel.json` |
| Rate limiting | Client-side daily report limits (deterrent only — see Known limitations) |

## Known limitations

- The admin function uses a **shared static key** with JWT verification disabled.
  Suitable for small trusted moderator teams; rotate the key if it leaks.
  A Supabase-Auth-based admin identity is the planned upgrade path.
- Upvote/report rate limits are client-side only; server-side throttling
  (edge-function or DB-side) is on the roadmap.
- Anonymous cleanup-proof submission is validated (bucket-scoped URLs, coordinate
  bounds, row locking) but not captcha-gated.

## Supported versions

Only the latest commit on `main` receives security fixes. Deployments track `main` via Vercel.

## For maintainers

- Never put secrets in `VITE_*` variables — they are compiled into the browser bundle.
- `SUPABASE_SECRET_KEY` / service-role keys must exist only in Supabase edge-function
  secrets and local untracked `.env.local`.
- Review new migrations for RLS/grant changes; run `supabase db lint` when available.
