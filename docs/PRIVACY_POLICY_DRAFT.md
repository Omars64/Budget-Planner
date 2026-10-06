# Budgetly Privacy Policy - Draft for Review

Draft prepared: 6 October 2026. Not published or effective yet.

Historical draft: the operator approved publication on 6 October 2026. The
current policy source is `public/privacy.html`, served at
`https://budget-planner-ecru-seven.vercel.app/privacy.html` after deployment.
Do not use this historical draft as the OAuth privacy-policy URL.

Before publication, the operator must confirm the hosting/database providers,
retention and deletion practices, administrator access, applicable jurisdictions,
and contact details below. This draft is not a substitute for legal review.

## Who operates Budgetly

Budgetly is operated by Omar Solanki. Proposed privacy contact:
omarsolanki46@gmail.com. Confirm this contact before publication.

## Information processed

Budgetly processes the account name and email address you provide, authentication
information, and records you choose to enter, such as wallets, transactions,
budgets, goals, debts, notes, and attachments. Features can also process your
preferences, device notification registrations, and security/audit events.

Guest records are stored on the device/browser. Clearing its storage or
uninstalling the app can remove those records. Signing in does not itself grant
permission to replace an existing account's records; importing guest records
requires confirmation.

Account features use Budgetly's hosted service. Offline features can retain local
copies and pending changes to synchronize when connectivity returns. Shared
features make the selected records available to the people you share them with.
Confirm the precise administrator-access limits before publication.

## How information is used

Information is used to provide the requested finance and notes features, authenticate
accounts, synchronize records, create requested backups, deliver enabled
notifications, and support security and service operation. Forecasts are estimates,
not guarantees of future balances or financial advice.

## Google sign-in

Google sign-in is optional. Google supplies the identity information needed to
verify your account. You choose the name used in Budgetly. Budgetly does not receive
your Google password. Signing in with Google does not automatically save your
financial records in Google Drive.

## Optional Google Drive backups

Connecting Drive is a separate, optional authorization. Budgetly requests the
`drive.file` permission for files used with the app, not unrestricted access to
your Drive. When you request a backup, Budgetly uploads an export of your records
to your chosen Google account. It can list and download the backups belonging to
your Budgetly connection to support restoration.

The current backup export is a JSON file, not a separately password-encrypted
Budgetly archive. Anyone you give access to that file may be able to read it.
Budgetly encrypts stored Drive refresh tokens on its server; this does not make
the exported backup end-to-end encrypted.

Disconnecting removes Budgetly's locally stored Drive credential and attempts to
revoke the Google authorization. If revocation fails, Budgetly reports that
failure; you can also remove access from your Google Account. Existing backup
files are not deleted by disconnecting. You control deletion and sharing of
those files in Google Drive.

Budgetly's use of information received from Google APIs will adhere to the
Google API Services User Data Policy, including its Limited Use requirements.
The operator must verify continuing compliance before publishing this commitment.

## Notifications and optional AI

If you enable closed-app update alerts, Budgetly stores a push registration for
that device/browser. Firebase Cloud Messaging or your browser's push service
delivers update messages. These update messages do not include financial records.
You can disable alerts in settings and through device/browser permissions.

Built-in guidance can work without a paid AI response. If an external AI feature
is enabled and used, relevant prompts and the financial context required by that
feature may be sent to the configured AI provider. Confirm the exact provider,
information sent, consent controls, and retention settings before publication.
Do not describe external AI processing as purely on-device.

## Service providers and storage

The production service is hosted on Vercel. Google processes Google sign-in and
optional Drive backups; Firebase and browser push services process enabled push
delivery. The operator must identify the production database, email, and any
other providers and applicable storage locations before publication. Processing
may take place outside your country.

## Security, retention, and your choices

Budgetly uses authentication, access controls, and encryption for certain stored
credentials. No service can promise absolute security. Do not include passwords,
card security codes, or other unnecessary sensitive information in records.

You can use guest mode, decline optional Drive/AI features, manage notifications,
export records, and request account deletion through available settings or the
privacy contact. Deleting the app does not necessarily delete a hosted account.
Backups you created in Drive or downloaded remain under your control.

Before publication, specify how long records, logs, deleted items, and service
backups are retained; how account deletion affects shared records; and the time
needed to complete deletion. Do not promise immediate removal from every backup.

## Changes and contact

When the final policy is published, provide an effective date and explain how
material changes will be communicated. Contact the confirmed operator address
for privacy questions and applicable data-rights requests.

## Publication Checklist

- Confirm operator/contact and jurisdiction-specific requirements.
- Confirm provider list, administrator access, and retention/deletion details.
- Confirm optional AI data flow and disclosures against the current implementation.
- Review the Google Limited Use commitment and operational compliance.
- Publish the approved policy at a stable, publicly accessible HTTPS URL.
- Use that URL in Google OAuth branding; do not link Google to this draft.
