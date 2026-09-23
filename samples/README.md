# Roster import samples

Only fictional records. Sign in as staff/admin, open **Roster → Import roster**, and select the CSV. Preview does not save anything. Review warnings and explicitly confirm before committing.

- `roster-clean.csv`: adds two students, with no assignments or email. These names/references are separate from demonstration seed records. Reimporting with the same references reuses the existing students.
- `roster-invalid.csv`: deliberately fails validation (missing reference, conflicting duplicate reference, impossible date, unknown tutor). Nothing should be committed.

Columns must be exactly `student_ref,student_name,tutor_ref,starts_on`. Student reference is a stable staff-only identifier; never reuse it for another person. Names alone do not identify people. Existing student references must use the saved name. The same name with a different reference is a warning to investigate, not an automatic merge.

For assignments, copy an active tutor's reference from the import screen and fill `starts_on` as YYYY-MM-DD. Tutor reference and start date must both be present or both blank. This imports students/assignments, not accounts, invitations or historical attendance. Maximum 500 rows, 500 KB.
