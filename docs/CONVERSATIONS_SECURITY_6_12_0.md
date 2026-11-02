# Budgetly 6.12.0 verification

Approved UI implemented for the shared browser/Android frontend:

- Profile tag moved from sidebar to the common header; sidebar navigation and standalone sign-out remain. More has sign-out as its last action.
- Private feedback conversations have separate, append-only administrator and sender replies. Legacy replies remain readable. Status saves separately; posting a reply does not change status. Request IDs protect retries.
- Google confirmation and device passkey registration are separate actions. The identity method is highlighted, and registration remains visible with a clear prerequisite. Confirmation expires locally and is independently enforced server-side.
- Google failures distinguish wrong account, missing authentication-time claim, stale authentication and generic failure without exposing credentials or provider claims.

Validation:

- Full frontend suite: 581 passed, 4 skipped. The sandboxed first run timed out on two unrelated tests; the unrestricted full run passed.
- Focused backend integration/security tests: 44 passed. Includes private reply visibility, stale-read acknowledgement, request replay, same-account fresh Google confirmation and additive migrations.
- Migration suite after adding a legacy-reply preservation scenario: 5 passed.
- Synthetic browser/API/database scenario passed: independent status autosave, posted reply visible to recipient after reload, unread acknowledgement, Google-confirmed virtual WebAuthn enrollment persisted without password, header/More mobile layout. Google response simulated; no production financial records used.
- Lint: no errors (six pre-existing Fast Refresh warnings).
- Android native tests: 17 passed. Debug APK, signed release APK and AAB built successfully, version code 106.

Google configuration:

- Confirmed production client belongs to project `thermal-pattern-510706-g0`.
- Added the existing public homepage and privacy-policy URLs to branding.
- User approved publishing Google sign-in; Audience now reports In production. Billing remains disabled.
- Session age claims remains disabled by Google until branding is verified. Google's check explicitly requires homepage ownership verification, followed by a 24-hour propagation wait before retrying branding.
- Downloaded Google's URL-prefix ownership proof for `omarsolanki46@gmail.com` and prepared `public/google2fb6544c716dfc39.html`. The user explicitly approved publishing v6.12.0 with that proof and completing the Search Console owner claim. Keep the public file after verification.
- Do not remove the authentication-time check or substitute token issuance time. Do not claim live Google reauthentication is repaired before claim availability and a real confirmation are verified.

Release applies one additive table migration (`f73b921cd054`). It does not rewrite legacy feedback or financial records. A code rollback retains the new table and conversation history.
