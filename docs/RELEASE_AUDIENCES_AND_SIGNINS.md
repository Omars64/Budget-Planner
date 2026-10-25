# Release audiences and sign-in history

Release notes remain a version-keyed array in `release-notes.json`. Omit
`audience` (or use `"all"`) for user-facing improvements. Add `"audience":"admin"`
for administrative changes. Admins see both sets; users see only shared items.
For an entirely administrative release, users see a generic maintenance summary.
The release manifest's legacy `notes` field contains only the user summary, so
older APKs also receive safe user-facing notes for newly published releases.
The bounded `adminNotes` field carries the complete list for role-aware clients.
The API preserves both fields for Android's available-update popup; the installed
What's new popup uses the same filtering on Android and web.
This is presentation targeting, not a way to publish confidential information:
release metadata and source assets remain public. Older administrators need this
update to see the additional admin-only notes in their popup.

Admin > User management shows each account's latest recorded sign-in. The history
button opens up to 50 existing account-session records per page, newest first.
Only administrators can call the history endpoint. It does not return authentication
tokens, session IDs, IP addresses, raw user agents, or financial records.

Signed in is the session creation time, not every app opening. Last active is the
existing throttled request timestamp (approximately five-minute granularity).
Device labels are approximate and can be absent for older sessions. Times display
in the administrator's device timezone. Active means unrevoked and unexpired,
not that the person is currently online. Ended includes revocation, so it does not
assert that someone explicitly clicked Sign out. No new tracking, schema migration,
or extra per-request database write is introduced by this feature. Historical
records that were never stored cannot be reconstructed.
