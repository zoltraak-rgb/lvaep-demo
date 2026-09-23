# Verification record

## Automated

Run `pnpm test` and `pnpm build`. Tests cover database role isolation, last-admin protection, group accounting, partial attendance, dates, retries, stale writes, recurring plans, pending identity resolution/reversal, monthly review preservation/invalidation, achievements, assignment endings, CSV import identity/atomicity, site/schedule edits and absence permissions. DOM tests cover forms, escaping, errors, retries and participant correction.

All email transport tests use stubs. PostgreSQL tests use isolated PGlite with synthetic Auth identities; they are not proof of deployed email or real concurrent connection behavior.

## Manual checks already observed during development

- Existing administrator/tutor password sign-in and hosted Supabase records.
- Tutor lesson saving, planned lesson recording, individual attendance and report updates.
- Mixed official/pending lesson shows teaching time once and pending minutes separately.
- Achievement save and appearance in review without changing hours.
- Supabase migrations through 0016 reported success in the hosted editor.
- EmailJS dashboard test received in the user-controlled mailbox (separate from app email integration).

These observations occurred during local-site development against hosted Supabase. They are not blanket confirmation of every production URL workflow.

## Deployed acceptance checklist

- [ ] Open public URL while signed out; no records or role switch appear.
- [ ] Existing tutor and administrator can sign in, reload and sign out.
- [ ] Shared-device option clears the local session on browser-session end.
- [ ] Tutor cannot access staff report/roster or another tutor's data.
- [ ] Separate staff account cannot alter administrator settings.
- [ ] Save shared 90-minute lesson with 90/45 attendance: teaching 90, attendance 135.
- [ ] Remove/add an attendee in correction; totals update, history remains.
- [ ] Duplicate warning permits a deliberate second lesson; retry creates no extra row.
- [ ] Pending linking preserves lesson date, teaching time and prior review confirmation.
- [ ] Previous-month confirmation and later correction produce appropriate review state.
- [ ] CSV/PDF match current visible report and identify their snapshot time.
- [ ] Import preview writes nothing; valid repeat is idempotent; invalid sample commits nothing.
- [ ] Absence codes add zero hours; tutors cannot enter them unless enabled by admin.
- [ ] Phone layout and keyboard flow: sign-in, lesson, review and report.
- [ ] Invitation, expiry/replacement, reset, revoke and scheduler/follow-up delivery after integration is completed.

Unfinished items remain requirements; this file does not narrow the specification. Do not claim the full demonstration complete until the required deployed workflows and account access have been checked.

## Public exploration update
- 98 automated tests pass: seeded database, no admin role, tutor mutation restriction, dedicated-account login buttons, tour progression/dismissal/reopening, and existing suite.
- Hosted seed transaction returned Success in Supabase.
- Final browser inspection was blocked by automatic approval review usage limits. User must check both live entry buttons, first-visit tour and sample records.
