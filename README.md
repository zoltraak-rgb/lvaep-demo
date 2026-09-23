# LVAEP tutoring records — demonstration

A student-built demonstration for a literacy tutoring program. **Not an official LVAEP service. Use fictional data only.**

Tutors record shared lessons once while preserving each student's attendance. Staff review monthly reports and resolve students waiting for an assignment. Password sign-in and database-enforced roles protect records; there is no public role switch.

## Working features

- Email/password sign-in, persistent or shared-device sessions, sign-out; tutor, staff and administrator database roles.
- Student roster and dated assignments, CSV preview/import with stable identity references, atomic commits and safe retries.
- Individual/group attendance, partial attendance, duplicate warnings, saved groups, weekly plans and month/list calendar. Plans never create attendance automatically.
- Corrections, participant changes and voiding with audit history and stale-write detection.
- Pending-student requests and attendance, verified staff linking and correction. Teaching time counts once; pending attendance stays separate.
- Per-tutor monthly review, confirmation and updated-since-review state. Linking already-reviewed pending attendance preserves the tutor's confirmation.
- Staff reports, search, student details, CSV export and browser Print / Save PDF.
- Achievements, dated absence codes, administrator control of tutor absence entry, assignment endings and staff reversal, reusable tutoring site/schedule details.

## Incomplete integration

This repository is a substantial demonstration, **not a production-ready system or a completed implementation of every planned feature**. Invitation/replacement-link/password-reset delivery, account provisioning UI, monthly scheduled emails and staff follow-up delivery are not connected. Server email modules are tested building blocks; they do not send mail by themselves. Separate staff demonstration account and a hosted reset/seed procedure still need setup. Do not enter real student data.

## Run and test

Requires Node.js 22.12+ and pnpm.

```sh
pnpm install --frozen-lockfile
cp .env.example .env.local
# Set your Supabase URL and publishable key in .env.local.
pnpm dev
pnpm test
pnpm build
```

Never use a service-role key in `VITE_*`. The publishable key is intentionally browser-visible; row-level security and checked database functions enforce access. Passwords, provider secrets and `.env.local` are excluded from Git.

## Database setup

Apply `supabase/migrations/*.sql` in numeric order to a dedicated new **Supabase Free demonstration project**. Migrations are transactional but generally not repeatable after successful installation. Existing projects should run only unapplied migrations. Keep public signup disabled. The owner must securely create the initial Auth users and matching `people` records; ordinary visitors cannot choose a role. No credentials are included in this repository.

All client-facing tables have row-level security. Application writes go through role-checked functions with validation and audit events. Last-administrator protection is enforced in the database. Shared lesson duration and per-student attendance are separate; dates are reported in America/New_York.

## Deployment

The Vite production output is `dist/`. `.openai/hosting.json` configures Sites static hosting. Build with the target project's publishable configuration, then deploy `dist` through the hosting workflow. Supabase retains authentication and storage. Hosting does not enable the unfinished email modules. Do not upload the parent planning/setup directory, private account details or local environment files.

Sites hosting is included within existing eligible ChatGPT plan beta limits; Supabase uses its Free plan. Limits and availability can change. No purchased domain, paid upgrades or billable overages are authorized for this demo.

## Demo and verification

See [DEMO-GUIDE.md](DEMO-GUIDE.md), [TEST-CHECKLIST.md](TEST-CHECKLIST.md) and [CSV samples](samples/README.md). Automated tests exercise real migrations in isolated PostgreSQL (PGlite), domain calculations and browser-form behavior (JSDOM). They do not replace hosted authentication, inbox delivery or usability testing. Test identities are synthetic and mail transports are stubbed.

Public source contains no demo account passwords. Obtain authorized demonstration access separately from the project owner.
