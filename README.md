# LVAEP demonstration

A student project for fictional tutoring records. Not an official LVAEP service.

## Current increment

Implemented locally: invitation-account password sign-in integration, role-restricted read policies, staff student creation and assignment, atomic multi-student lesson saving, individual attendance minutes, duplicate warnings and safe retries, a calendar list, and basic monthly time totals. No public role selector or simulated persistence.

**This is an incomplete development build.** Supabase has not been connected and the site is not deployed. Without configuration, the landing page explicitly disables sign-in. An invitation flow is not implemented merely because the password sign-in screen exists.

Still to build: invitations/recovery/mail hook; account management screens; session editing/voiding; saved groups; month-grid calendar and recurrence; pending students; review/version tracking; achievements/absence/stopped assignments; imports; complete reporting/search/exports; scheduling/follow-up; settings; demo accounts/reset kit. No scope has been dropped. See the private project checkpoint for the authoritative specification and decisions.

## Run locally

Use Node.js 22.12+ (tested with 24.19), and pnpm:

```sh
pnpm install --frozen-lockfile
pnpm dev
pnpm test
pnpm build
```

Copy `.env.example` to `.env.local` only when the project exists. Enter its URL and **publishable** key. These two values identify the public API; row-level security enforces access. Never put a service-role key, database password or mail-provider key into `VITE_*` variables or source files. Restart the development server after configuration changes.

## Database

`supabase/migrations/0001_foundation.sql` creates tables, read policies and transaction-based write functions. Apply in order to a **new dedicated demonstration project**, not an existing operational database. The migration is transactional, but not repeatable after successful installation. It assumes Supabase's `auth.users`, `auth.uid()`, `anon` and `authenticated` roles. Keep public signup disabled. Do not use a public client to bootstrap administrator access.

The first administrator must be linked to a verified Supabase Auth user by the project owner through a privileged setup process. That account-creation workflow and the Send Email Hook still need implementation; do not invent recipient addresses or paste credentials into SQL documentation. Creating records/importing data must not send invitations.

Every client table has row-level security; clients receive SELECT only. Write functions enforce roles, assignments, version checks and audit events. Tutors cannot change roles or write tables directly. Public functions have their default PUBLIC execution privilege revoked. A tutor's request UUID makes a retry identify the same logical lesson; a different payload using that UUID is rejected. Shared lessons and attendance are separate tables. Assignment dates are inclusive in this first increment; stop/reversal UI remains unimplemented pending policy clarification.

## Verification

Tests run the actual migration in an isolated in-memory PostgreSQL engine (PGlite), with test-only Supabase identity stubs and synthetic IDs. They exercise database permissions and functions; the engine is not used to store browser records or replace the hosted backend. Tests cover privacy, direct-write denial, last-admin protection, assignment validation, atomic group saves, partial attendance, same-day warnings, retry handling, stale edits, historical dates and report calculations. Test fixtures never send messages.

These tests **do not** verify real Supabase authentication, deployed API grants, mail delivery, simultaneous connections, visual layout, keyboard interaction or mobile usability. Those checks remain required before claiming a working demonstration. The hosted project's configured API page size must remain at least 1,000 for the current pagination helper; report snapshot consistency under concurrent edits needs a later backend reporting transaction.

## Deployment and budget

No deployment has occurred. Proposed services are Supabase Free and Cloudflare Workers Free, with EmailJS Free for server-side email. Account-specific $0/no-card terms and delivery remain verification gates; no paid plan or domain purchase is authorized. Cloudflare deployment configuration and scheduled jobs are not included in this increment.

Only this application directory is intended for the eventual public source repository. Private planning/checkpoint files, mailbox setup details and provider credentials remain outside it.
