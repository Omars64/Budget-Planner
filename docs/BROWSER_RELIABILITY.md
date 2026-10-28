# Browser reliability release gate

The `Synthetic offline browser gate` check runs real Chromium on GitHub Actions. It signs in with the current password form, opens `/#/transactions`, submits an expense while offline, reads the committed IndexedDB queue, reloads offline through the built service worker, verifies the identical queue record, reconnects, and checks the authenticated ledger contains exactly one transaction. A second connectivity cycle and reload check for replay. It queues another A expense offline, signs out through the UI, and signs in as B in the same browser context, checking both B's authenticated ledger and online/offline UI contain neither A transaction.

No local browser automation is intended. The script refuses execution unless `CI=true`; do not set that locally. The parent can use CUA for local UI checks. No mocked API routes, injected tokens, application imports, or synthetic IndexedDB writes are used by Playwright.

## Parent integration required

Make `Synthetic offline browser gate` a required branch/release check, or call this reusable workflow from the parent-owned `.github/workflows/quality.yml`:

```yaml
  browser-reliability:
    uses: ./.github/workflows/browser-reliability.yml
```

Release/deployment jobs must depend on that job (alongside existing quality jobs). Merely running a parallel workflow does not prevent release; repository protection or a release dependency is required. This change does not modify parent-owned release workflows or repository settings.

The workflow uses the parent's exact dev dependency `@playwright/test@1.64.1` through `npm ci`, then installs its Chromium revision. The parent owns the manifest and lockfile changes. Python dependencies come from `requirements.txt` (including httpx for the self-test).

After Chromium installation, CI also runs `npx vitest run src/lib/offlineStore.test.js` with `FLOWBUDGET_PLAYWRIGHT=@playwright/test` and `FLOWBUDGET_BROWSER_CHANNEL=chromium`. This enables the real cross-tab IndexedDB tests against their intercepted synthetic origin; no local browser execution is required.

Before the offline scenario, the gate re-registers `/budgetly-push-sw.js` at root scope and toggles its notification preferences off/on/off through acknowledged messages. It dispatches a synthetic push event in the actual worker and verifies the installed listener handles it; an invalid synthetic version prevents notification display. It never requests permission or subscribes externally. The subsequent offline reload proves the fetch handler still serves the shell after those operations. The UI route is `/#/transactions` (HashRouter).

## Isolation

`browser-reliability-server.py` clears the entire inherited environment except a small OS runtime allowlist **before any API imports**, supplies a new temporary SQLite path and signing secret, rejects external DNS, and blocks socket `connect`/`connect_ex` except numeric loopback. It uses the real application routes and password hashing with two synthetic `example.test` users and synthetic wallets/categories. It creates schema explicitly, marks storage ready, replaces both initialization functions with failure guards, and runs uvicorn with lifespan off. Production/demo seeding never runs. Temporary data is disposed and removed on normal helper exit. The harness verifies readiness against the spawned helper's PID, sends SIGTERM even if browser cleanup fails, waits up to five seconds, and uses SIGKILL if needed. CI runner teardown removes data on forced termination.

The API and built shell share `http://127.0.0.1:8765`; there is no remote target option. Access logs, browser traces, screenshots, response bodies and credentials are not emitted. Browser requests outside the origin are rejected where routing applies and fail the test even when initiated by a service worker. The API socket guard covers provider requests independently.

Build mode `browser-reliability` avoids `.env.production`; the workflow starts Vite with an empty environment except runtime essentials. The guard rejects the four files Vite loads in this mode, including symlinks: `.env`, `.env.local`, `.env.browser-reliability`, and `.env.browser-reliability.local`. The tracked `.env.example` is allowed because Vite does not load it in this mode. CI must not receive production secrets. The gate requires a fresh checkout and port 8765 available.

Run only the non-browser isolation/sign-in smoke check locally:

```powershell
python scripts/browser-reliability-server.py --self-test
```

Failures fail the job with no retry. The end-to-end scenario covers a personal one-time expense and sequential account switching; the separate IndexedDB suite covers cross-tab queue coordination. These checks do not claim browser-engine coverage beyond Chromium or cover crash recovery, attachments or shared spaces.

The reconnect scenario explicitly tests a lost acknowledgment: Playwright forwards the first queued POST to the real loopback API with `route.fetch` (15-second timeout), verifies success, takes the browser offline, and aborts the response. It waits for the failed request and completed sync, verifies the same IndexedDB entry and idempotency key remain with attempted history, and independently reads the authenticated loopback ledger to prove one committed row. A second reconnect must send the original key, clear the queue, and return the same single server transaction ID. A later reconnect/reload checks for replay again. No server response is mocked.
