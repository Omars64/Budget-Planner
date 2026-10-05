# Budgetly 5.11.0

Backward-compatible usability features: minor version 5.11.0, Android version code 49.

- Password, Passkey, and Guest share the top sign-in method row. Guest shows only its device-storage notice and Continue button; signup and Google completion remain separate flows.
- Mobile authentication removes duplicate promotional copy while preserving the desktop right-hand form and background watermark.
- Page and sheet transitions are short. Charts animate for 300 ms; reduced-motion preferences disable optional movement.
- Successful offline synchronization gives a brief completion message. Existing save, autosave, and failure/retry states remain intact.
- Overview offers collapsed, device/account-specific frequent-page shortcuts and a rolling seven-day personal summary. Transfers and opening balances are excluded; actual transaction dates determine the week, not reporting months. Review links open the matching records.
- Successful goal contributions celebrate new 25%, 50%, 75%, and completion milestones once. Preferences control shortcuts, summary, and celebrations.
- Firebase Android configuration is included. Server credentials remain exclusively in Production secrets; see UPDATE_NOTIFICATIONS.md for activation and delivery limitations.

Financial records, balances, shared permissions, app package, and signing identity are not migrated or replaced. This release does not add financial schema changes.

Verification: frontend and backend suites, mobile/desktop light/dark checks, production push readiness, restricted FCM sender dry-run, and signed APK build. Real closed-app push acceptance checks remain outstanding until an opted-in device receives a newer-version notification.
