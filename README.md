# Budgetly

Budgetly (formerly FlowBudget) is a full-stack personal budget planner inspired by the workflow coverage of mature mobile budget managers, with an original interface and implementation.

Both transaction ledgers support wallet, Kuwait calendar month, type and text filters, newest/oldest sorting, and pages of 100 records. Wallet member lists and signed-in sessions start collapsed. Android release 1.0.3 uses the Budgetly display name and retains `com.flowbudget.app`, the existing signing key, storage keys, and forwarding headers for compatibility. Deploy the API changes together with the frontend before using the new month, sort and pagination controls in the APK.

The visual system is deliberately transparent/glass-like and uses **`#0a4173` as the primary accent**. The UI includes animated ambient layers, spring modals, animated page transitions, live charting, responsive cards, mobile bottom navigation and desktop navigation.

## Included features

- Dashboard with current balance, monthly income, expenses and net movement
- Income, expense and transfer transactions
- Wallet-to-wallet transfer accounting
- Search and transaction type filtering
- Custom income and expense categories
- Wallets: cash, bank, card and digital wallet
- Wallet archiving and deletion safety checks
- Weekly, monthly and yearly budgets
- Budget thresholds and visual warning states
- Savings goals and contributions
- Debt / receivable tracking and payment progress
- Financial calendar with per-day income and expense totals
- Six-month analytics and category breakdowns
- Recurring transaction definitions with due-occurrence materialization on reads
- 4–8 digit PIN lock with salted PBKDF2 hashing and signed unlock sessions
- Email/password login with admin and user roles
- Admin user management for creating, editing, deactivating, password resetting and deleting users
- Per-user wallets, categories, transactions, budgets, goals, debts and preferences
- JSON backup and restore
- Currency, week-start and number-format settings
- Seeded demo dataset for immediate exploration
- Responsive mobile / tablet / desktop layouts
- Notes with folders, search, pinned notes, text export, and tab-session draft recovery
- Shared notes for registered accounts, with owner-controlled view/edit permissions and version conflict detection
- User feedback with categories and an admin inbox, reading pane, statuses, and replies visible to the sender
- Mobile sign-out and shared-wallet remaining balances
- Password changes invalidate existing account sessions

Notes and feedback use the same database as account and budget data. Their tables are created during the existing database startup transaction. Only note owners can delete or share notes; editors can update content. Folder deletion retains the notes. Account deletion removes that account's notes, shares, and feedback. Note drafts remain only in the current browser tab session and are cleared on sign-out.

The local browser verification script `scripts/verify-workspace.cjs` uses an isolated local API/database and requires `FLOWBUDGET_TEST_PASSWORD`. It exercises note sharing, feedback replies, mobile balances, logout, and logo rendering. It refuses remote URLs; screenshots are saved to the ignored `.verification/` directory.

## Technology

### Frontend
- React 19
- Vite 8
- JavaScript / JSX
- React Router
- Framer Motion
- Recharts
- Lucide icons
- date-fns

### Backend
- Python 3.13
- FastAPI
- SQLAlchemy 2 with fixed-precision `NUMERIC(..., 3)` money columns
- Pydantic
- SQLite for local use
- PostgreSQL-compatible through `DATABASE_URL`

## Local setup

### Requirements

- Node.js 22+ recommended
- Python 3.13 recommended

### 1. Create the Python environment

```bash
python -m venv .venv
```

Activate it:

**macOS / Linux**

```bash
source .venv/bin/activate
```

**Windows PowerShell**

```powershell
.\.venv\Scripts\Activate.ps1
```

Install backend dependencies:

```bash
pip install -r requirements.txt
```

### 2. Install frontend dependencies

```bash
npm install
```

### 3. Start the API

In terminal 1:

```bash
python -m uvicorn api.index:app --reload --port 8000
```

API: `http://127.0.0.1:8000`

Swagger docs: `http://127.0.0.1:8000/docs`

### 4. Start the React frontend

In terminal 2:

```bash
npm run dev
```

Open the Vite URL, normally `http://localhost:5173`.

Vite proxies `/api` requests to the local FastAPI server.

## Android app build

The repository includes a Capacitor Android project. The browser build uses relative `/api` requests locally, while the installed Android app automatically uses the production FlowBudget API at `https://budget-planner-ecru-seven.vercel.app`. Override this during development with `VITE_API_BASE_URL`.

```powershell
npm run android:sync
npm run android:open
```

For a connected device or emulator, use `npm run android:run`. For a Play Store release, open the `android/` project in Android Studio and generate a signed **Android App Bundle** (`.aab`). Keep the package name `com.flowbudget.app` stable for future updates, protect the upload keystore, and use Google Play App Signing. The backend remains on Vercel; never put database credentials in the Android app.

On this Windows machine, build an installable signed APK and an AAB with:

```powershell
npm run android:apk -- -Release -UseWindowsTrustStore
```

This uses JDK 21 (from `JAVA_HOME`, `-JdkHome`, or the locally downloaded `.verification/toolchain/jdk-21*` folder) and the Android SDK under `%LOCALAPPDATA%/Android/Sdk`. It does not change your system Java. `-UseWindowsTrustStore` uses Windows' trusted certificates for Gradle downloads; TLS verification remains enabled. Without `-Release`, the command builds a debug APK for development.

Release outputs use the current version name, for example `android/app/build/outputs/apk/release/FlowBudget-1.0.2.apk` and `android/app/build/outputs/bundle/release/app-release.aab`. Install the APK on Android; the AAB is for a later Play Console submission. The first release build generates a signing key in `.android-signing/` and protects its password with Windows DPAPI. Keep that folder and the Windows account: the encrypted password file is tied to this user and machine. Arrange a secure key/password backup before publishing. Signing files and generated APKs/AABs are ignored by Git.

The installed app bundles the interface locally and uses Capacitor's native HTTPS transport for the existing production API. Existing accounts and financial data are shared with the website. Android passkeys use Credential Manager and require a screen lock, a passkey provider, and the published Digital Asset Links association. Automatic SMS capture remains disabled. Local reminders can run outside the app after permission is granted; there is no remote push service configured. The login screen's **Keep me signed in on this device** option persists the server session for up to 24 hours in browser or Android app storage; signing out removes the saved token.

For phone testing, transfer the release APK to your Android device, open it, and allow installation from that specific file/browser app if Android requests it. Revoke that installation permission afterward. Sign in with your existing FlowBudget account. This APK is not a Play Store publication.

If the emulator launches but HTTPS requests fail with `Trust anchor for certification path not found`, check whether PC antivirus HTTPS scanning is replacing the server certificate. This machine's AVG Web/Mail Shield does that. Windows trusts its certificate, but the emulator does not. Test the release on a physical phone using a trusted connection instead of disabling TLS verification or adding an antivirus CA to the production app. Emulator startup and release signing were verified; authenticated workflows and bank-app coexistence still require physical-device testing.

## First launch

The first API startup creates the database and seeds a small demo dataset with wallets, transactions, budgets, goals and a debt. You can remove these records normally or use **Settings → Demo data → Reset demo data** to restore them.

The local SQLite file is `flowbudget.db` and is ignored by Git.

## Tests

Backend integration/regression suite:

```bash
python -m pytest -q tests/test_api.py
```

Frontend unit tests:

```bash
npm test
```

Production frontend build:

```bash
npm run build
```

The generated static build is written to `dist/`.

## Environment variables

Copy `.env.example` if you want explicit configuration.

- `DATABASE_URL` — defaults to local SQLite if omitted outside Vercel
- `FLOWBUDGET_DATABASE_URL` / `FLOWBUDGET_POSTGRES_URL` — managed Neon integration variables; these take precedence over `DATABASE_URL`
- `APP_SECRET` — signing secret for PIN unlock sessions; **replace before deployment**
- `CORS_ORIGINS` — comma-separated cross-origin frontend origins for development or split deployments
- `ADMIN_INITIAL_USERNAME` — first admin account display name, defaults to `Omar`
- `ADMIN_INITIAL_EMAIL` — first admin account email, defaults to `omarsolanki46@gmail.com`
- `ADMIN_INITIAL_PASSWORD` — first admin password; set this in deployment secrets before first startup
- `SMTP_HOST`, `SMTP_PORT` — email server and port (Gmail: `smtp.gmail.com`, `587`)
- `SMTP_USER`, `SMTP_PASSWORD`, `SMTP_FROM` — sender login, app password, and sender address; Gmail requires an App Password for the account in `SMTP_USER`, not its regular password
- `PUBLIC_APP_URL` — canonical HTTPS URL used in password-reset links; keep this on the same trusted domain users recognize

Passwords are never stored as plaintext or reversible encryption. New passwords are stored as salted, memory-hard `scrypt` hashes. Existing legacy PBKDF2 hashes remain readable only for verification so current users are not locked out; changing a password replaces the old hash with `scrypt`.

### Outlook delivery

The application sends small plain-text-plus-HTML transactional messages with a stable `Message-ID`, `Reply-To`, and sender-domain alignment. This improves compatibility, but application code cannot override an Outlook/Microsoft 365 tenant quarantine policy. For reliable delivery, send from a domain you control rather than a personal Gmail address and publish all three records for that sending domain:

1. SPF authorizes the actual email provider.
2. DKIM signs outgoing messages for the same domain used in `From`.
3. DMARC aligns that authenticated domain with `From` and starts at `p=none` while reports are reviewed.

The SMTP configuration now rejects a mismatched `SMTP_FROM` domain. If the current Gmail sender still lands in quarantine, check the quarantine message's `Authentication-Results` for `spf`, `dkim`, `dmarc`, and `compauth`; then configure the sending domain/provider or ask the Outlook administrator to release and allow the verified sender. Do not add a broad allow rule for an unauthenticated sender.

In Vercel, open the **budget-planner project > Settings > Environment Variables**. Apply production settings to **Production**, then redeploy for changes to take effect. Keep passwords and database connection strings out of Git. Connecting Neon with the `FLOWBUDGET` prefix supplies `FLOWBUDGET_DATABASE_URL` automatically.

After deployment, `/api/health` must report `persistent_storage: true` and `database: postgresql`. `/api/health/email?probe=true` must report `ready: true` before email signup can work. `EMAIL_AUTH_FAILED` means the SMTP provider rejected the sender credentials.

For hosted PostgreSQL, use a SQLAlchemy/psycopg URL such as:

```text
postgresql+psycopg://USER:PASSWORD@HOST/DATABASE?sslmode=require
```

## Vercel deployment notes

The repository is intentionally shaped as a Vite app with a FastAPI entry point at `api/app.py`. Current Vercel Python support recognizes FastAPI applications as Python Functions.

Before a real deployment:

1. Push this folder to a Git repository.
2. Import the repository into Vercel.
3. Add a strong random `APP_SECRET`.
4. Add a managed PostgreSQL `DATABASE_URL`.
5. Build with `npm run build`.
6. Verify `/api/health` after deployment.

**Do not rely on SQLite for persistent data on a serverless deployment.** Local SQLite is excellent for development, but a hosted serverless filesystem is not the correct persistence layer for personal financial records. The API returns HTTP 503 when storage initialization fails. It also rejects SQLite on Vercel unless `ALLOW_EPHEMERAL_SQLITE=true` is explicitly set for a temporary preview; use managed Postgres in production.

For an authorized live collaboration smoke test, set `FLOWBUDGET_ADMIN_PASSWORD` in the current PowerShell 7 session and run `./scripts/verify-production.ps1`. The test creates two temporary accounts, verifies sharing and persistence beyond two minutes, and deletes its test accounts and data afterward. It does not test email delivery.

The frontend uses hash routing so static-host refreshes do not require SPA rewrite rules.

## Data model

- `Wallet`
- `Category`
- `Transaction`
- `Budget`
- `Goal`
- `Debt`
- `AppSetting`

Transfers are stored as one transaction with a source and destination wallet. Wallet balances are derived rather than stored, which reduces drift and keeps transfer accounting consistent.

## Security scope

FlowBudget now uses account login with `admin` and `user` roles. Budget records are scoped to the signed-in user, while admins can manage accounts from the Admin page. For public production use, add rate limiting, email verification/password reset flows and migration tooling before inviting untrusted users.

## Design notes

- Primary accent: `#0a4173`
- Transparent/glass panels instead of an opaque app canvas
- Semantic green/red are reserved for income/expense state, while primary navigation, active controls and core branding stay on the requested blue accent
- The app is original and does not include proprietary Smart Budget assets, logos or source code
