# Verification status and next checks

## Automated local checks

- Run `pnpm test` for actual migration/function/RLS tests and reporting/date calculations.
- Run `pnpm build` for the unconfigured preview.
- Also build with non-secret placeholder Supabase URL/key to compile the configured integration path. This is a compilation check, not an authenticated service test.

## Before the first live demonstration

- Verify Free plans and provider ownership without credit-card enrollment.
- Apply migrations to a dedicated empty demo project; verify anon, tutor, second tutor, staff and admin through the real API.
- Provision real invitation-controlled users without public signup or role choice; test invitation, revocation, setup recovery and password reset.
- Exercise sign-in persistence and shared-device sign-out on deployed pages.
- Staff add/assign a fictional student. Tutor saves a shared 90-minute lesson with 90/45-minute attendance. Check tutor time 90, student time 135.
- Retry a lost success response: one saved lesson. A deliberate second lesson should warn and require explicit confirmation.
- Invalid student in group: save nothing. Second tutor must not read the lesson, attendance or audit.
- Check stale writes, simultaneous requests and deactivation against hosted PostgreSQL.
- Inspect mobile at 375px and desktop; tab through sign-in, dialogs and save/retry, including focus return, status announcements and validation.
- Complete every remaining feature/failure-case requirement from the final handoff; this checklist does not replace it.

No manual/deployed checks above have passed yet. No recipient delivery test has run.
