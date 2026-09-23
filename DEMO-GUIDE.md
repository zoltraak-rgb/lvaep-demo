# Five-minute demonstration

Open [the live website](https://zoltraak-rgb.github.io/lvaep-demo/) and choose **Try as tutor** or **Try as staff** without registering. Both shared demo accounts already exist and contain fictional records. Their dedicated credentials are intentionally public; personal/admin credentials are not. Use separate browser profiles to explore both roles at once.

1. **Tutor Home:** click **Try as tutor**. Open a planned lesson or Log session. Select two assigned students, 90 teaching minutes, and adjust one student's attendance to 45. Save once.
2. **Calendar:** find that recorded lesson. Explain that 90 teaching minutes and 135 student attendance minutes measure different things. Future plans are not attendance.
3. **Correction:** View / edit, correct minutes or participants, save. The original values remain in staff Change history. Only this lesson changes, not group membership.
4. **Review:** open a previous month's review. Expand each student's entries, achievements and absence codes. Confirm once for all students. A later substantive correction changes the status to Updated since review.
5. **Staff report:** in the **Try as staff** session, refresh Reports for the same month. Open a tutor's details, inspect student attendance, then export CSV or Print / Save PDF.
6. **Optional:** demonstrate a pending student request, explain separate pending attendance, then staff verify and link it. Never match solely by name. Linking already-reviewed attendance does not fabricate a new tutor confirmation.
7. **Optional import:** use `samples/roster-clean.csv`, review the preview, then explicitly commit. Repeating the import must reuse the same references. The invalid sample must save nothing.

## What to say honestly

The core recording/reporting workflows use a real database with permissions. This is a student demonstration, not an official LVAEP service. Authentication uses existing password accounts. Invitation/recovery delivery, automatic reminder/report email and staff follow-up sending remain unfinished; do not demonstrate them as operational. EmailJS dashboard delivery was tested separately, not as proof of integrated account delivery.

## Safe cleanup

An initial seed is installed, but no repeatable automatic reset exists. To undo a demo session, use **Void this mistaken lesson**; audit history remains. Remove a mistaken achievement or absence through its normal removal control. Archive an unused imported student. Do not delete Auth users or run blanket SQL deletes to reset a demonstration. Assignment stop reversal is staff-only and does not recreate canceled plans automatically.

## Reviewer access

The public URL opens the sign-in page. Choose **Try as tutor** or **Try as staff** to enter the existing shared accounts; reviewers do not need private access or registration. The staff demo account is not an administrator. Edits affect shared fictional records and are visible to other visitors. Never share personal/admin credentials.
