# FlowBudget

FlowBudget is a full-stack personal budget planner inspired by the workflow coverage of mature mobile budget managers, with an original interface and implementation.

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

- `DATABASE_URL` — defaults to local SQLite if omitted
- `APP_SECRET` — signing secret for PIN unlock sessions; **replace before deployment**
- `CORS_ORIGINS` — comma-separated cross-origin frontend origins for development or split deployments
- `ADMIN_INITIAL_USERNAME` — first admin account display name, defaults to `Omar`
- `ADMIN_INITIAL_EMAIL` — first admin account email, defaults to `omarsolanki46@gmail.com`
- `ADMIN_INITIAL_PASSWORD` — first admin password; set this in deployment secrets before first startup

For hosted PostgreSQL, use a SQLAlchemy/psycopg URL such as:

```text
postgresql+psycopg://USER:PASSWORD@HOST/DATABASE?sslmode=require
```

## Vercel deployment notes

The repository is intentionally shaped as a Vite app with a FastAPI entry point at `api/index.py`. Current Vercel Python support recognizes FastAPI applications as Python Functions.

Before a real deployment:

1. Push this folder to a Git repository.
2. Import the repository into Vercel.
3. Add a strong random `APP_SECRET`.
4. Add a managed PostgreSQL `DATABASE_URL`.
5. Build with `npm run build`.
6. Verify `/api/health` after deployment.

**Do not rely on SQLite for persistent data on a serverless deployment.** Local SQLite is excellent for development, but a hosted serverless filesystem is not the correct persistence layer for personal financial records. Use managed Postgres in production.

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
