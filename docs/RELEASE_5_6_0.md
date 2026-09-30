# Budgetly 5.6.0

Android version code: 41.

- Replaced native description datalists with dismissible, inline recent-description buttons in personal and shared transaction forms. Suggestions do not submit the form or block other controls.
- Separated transaction actions from the scrollable fields. The action bar spans the dialog; the visual viewport continues to keep focused inputs visible when the keyboard opens.
- Settings > Personal preferences > Transaction helpers offers independent switches for description suggestions, remembered entry choices, recent-choice ordering, templates, and balance previews. These preferences are per account on the current device. Safety validation remains enabled.
- Existing preferences default to helpers enabled. Disabling suggestions keeps history; disabling remembered entries clears that account's personal/shared entry history.
- No database schema, transaction payload, permissions, or production records changed.

Verification: 112 frontend tests passed, production build and Android sync passed, lint completed with zero errors (existing warnings remain). Browser regression checks passed at 320/390/1440px in light/dark mode, including a simulated reduced visual viewport for keyboard-open input visibility and footer separation.

Before release, test the signed APK on a physical Android device with Samsung Keyboard and Gboard. Desktop viewport simulation does not verify real IME behavior. No APK, deployment, or Git push was performed by this change.
