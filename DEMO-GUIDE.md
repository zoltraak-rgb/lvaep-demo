# Five-minute demonstration

Use only fictional records and accounts provided privately by the owner. Keep tutor and administrator sessions in separate browser profiles. Never publish account passwords in this repository.

1. **Tutor Home:** sign in with an existing tutor account. Open a planned lesson or Log session. Select two assigned students, 90 teaching minutes, and adjust one student's attendance to 45. Save once.
2. **Calendar:** find that recorded lesson. Explain that 90 teaching minutes and 135 student attendance minutes measure different things. Future plans are not attendance.
3. **Correction:** View / edit, correct minutes or participants, save. The original values remain in staff Change history. Only this lesson changes, not group membership.
4. **Review:** open a previous month's review. Expand each student's entries, achievements and absence codes. Confirm once for all students. A later substantive correction changes the status to Updated since review.
5. **Staff report:** in the administrator session, refresh Reports for the same month. Open a tutor's details, inspect student attendance, then export CSV or Print / Save PDF.
6. **Optional:** demonstrate a pending student request, explain separate pending attendance, then staff verify and link it. Never match solely by name. Linking already-reviewed attendance does not fabricate a new tutor confirmation.
7. **Optional import:** use `samples/roster-clean.csv`, review the preview, then explicitly commit. Repeating the import must reuse the same references. The invalid sample must save nothing.

## What to say honestly

The core recording/reporting workflows use a real database with permissions. This is a student demonstration, not an official LVAEP service. Authentication uses existing password accounts. Invitation/recovery delivery, automatic reminder/report email and staff follow-up sending remain unfinished; do not demonstrate them as operational. EmailJS dashboard delivery was tested separately, not as proof of integrated account delivery.

## Safe cleanup

There is no automatic reset button or complete hosted seed/reset procedure yet. To undo a demo session, use **Void this mistaken lesson**; audit history remains. Remove a mistaken achievement or absence through its normal removal control. Archive an unused imported student. Do not delete Auth users or run blanket SQL deletes to reset a demonstration. Assignment stop reversal is staff-only and does not recreate canceled plans automatically.

## Reviewer access

The public URL opens the sign-in page. Records are visible only to authorized accounts. Arrange reviewer access privately with the owner before submitting a link; do not share the owner's administrator password. A separate non-admin staff account still needs provisioning.
