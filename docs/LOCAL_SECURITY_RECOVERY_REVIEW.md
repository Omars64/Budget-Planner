# Local security, load and recovery verification

Run from the repository root with Python and requirements-dev.txt installed:

```powershell
python -m scripts.verify_local --mode all --output .verification/local-evidence.json
python -m scripts.verify_local --mode load --requests 200 --workers 8
python -m scripts.verify_local --mode recovery
python -m scripts.verify_local --mode security
python -m pytest tests/test_local_verification.py
```

Evidence files are created exclusively: use a new filename on subsequent runs.
Failures exit nonzero; success emits JSON with named checks and load metrics.
No tokens, passwords, encryption keys or financial records are written to evidence.

## Isolation and reproducibility

Each invocation must use a fresh Python process. Before importing the API, the
tool clears inherited environment configuration, sets a fresh SQLite database
inside a unique temporary directory under ignored `.verification`, disables demo
seeding and creates synthetic accounts under `example.test`. It does not load
`.env`, accept a target URL, use S3 or read existing database/backup files.
Socket connect/connect_ex calls are denied, including loopback application
traffic. Windows asyncio's internal socketpair creation is permitted only during
that operation on its creating thread. This is an accidental-egress guard for
the Python application, not an OS sandbox against malicious subprocesses.
The database engine is disposed and the temporary directory removed on exit.

The fixture has a fixed date, a 100-unit wallet and a 7.125-unit expense.
Load uses bounded workers (1..16) and requests (1..2000), exercising authenticated
wallet, transaction and dashboard reads. JSON reports nearest-rank p50/p95,
throughput, elapsed time and zero errors on success. Timing varies by host.
This measures a small SQLite ASGI workload; it does not establish production
capacity, HTTP/TLS latency, PostgreSQL contention or concurrent write safety.

## Automated review evidence

- Missing/invalid authentication is rejected.
- A regular user cannot list admin users, see the owner's wallet or delete it.
- Restore requires recent identity confirmation.
- A synthetic API export survives Fernet encryption, gzip and verifier decoding.
- Unsupported restore input is rejected without changing transactions.
- After deleting the synthetic wallet, restore rebuilds transaction values and
  the expected 92.875 balance even when identifiers are remapped.
- Verifier tests reject wrong keys, tampering and malformed required collections.
- Archive tests cover exact size boundaries, short storage reads, compressed
  expansion, combined gzip members, damaged trailers and bounded file/S3 input.
- A subprocess regression injects hostile inherited database/service settings
  and verifies that the drill still completes locally.

`verify_external_backup.py` remains an operator tool: its `--key` mode accesses
configured S3, and `--file` may read sensitive downloaded data. Neither mode is
used by these drills. Its new pure decoder validates required collection types;
this is archive validation, not a full restore compatibility guarantee. Plaintext
`--output` is opt-in and refuses existing files atomically; operators must choose
a protected directory with appropriate filesystem permissions and retention.

## Remaining review scope

The external verifier now caps encrypted input at 40,000,000 bytes and
decompressed JSON at 25,000,000 bytes (the restore API's default JSON limit).
Both local-file and S3 reads consume bounded chunks, stopping at the input limit
plus one byte; S3 bodies are closed on success or failure. Direct decoder callers
also receive the encrypted-size check before decryption. Gzip reads stop at the
JSON limit plus one byte, with one shared budget across concatenated members.
Within-limit archives must pass gzip trailer integrity checks before JSON parsing.
Limits are fixed verifier constants, independent of inherited environment values.
Fernet authentication and JSON parsing still need memory proportional to these
bounded inputs; this protection does not impose a CPU deadline or JSON depth cap.
Deployments with a larger restore limit need a separately reviewed verifier policy.

On 2026-10-11 the parent reported that `npm audit --omit=dev --json` succeeded
with `NODE_USE_SYSTEM_CA=1` and returned zero vulnerabilities. This resolves the
earlier DNS/certificate failures using the system CA store with TLS verification
enabled. Coordinate any future dependency updates separately.
The repository places `@capacitor/cli` in production dependencies, so production
audit scope includes native build tooling; evaluate whether it belongs in
devDependencies before interpreting runtime exposure. No packages were changed.

These checks cover representative API paths, not a complete security audit.
Review password reset/email enumeration, session expiry/revocation, rate limits,
collaborator/space permissions, upload limits, passkeys, CORS, secret management
and dependency advisories separately. Recovery coverage should be extended for
notes/attachments, receipts, transfers, recurring/planned entries, planner links
and shared spaces before relying on complete workspace recovery claims.
No real off-site object retrieval, key escrow, provider outage, full database
rebuild, RPO or RTO is proven here. Production recovery requires a separately
authorized exercise with sanitized fixtures and isolated infrastructure.

## Recorded local check

On 2026-10-11 the combined drill passed all seven named checks. Forty reads with
four workers completed without errors; measured p50 was 91.809 ms and p95 was
190.09 ms (38.52 requests/second). These host-specific numbers are evidence of
execution, not a capacity target. Full machine-readable results are kept locally
in `.verification/local-evidence.json`. The focused verifier/local-tool tests and
the existing external backup tests passed. Windows required running the ASGI
drill outside the desktop filesystem sandbox for the internal socketpair.

The bounded decoder patch passed all 18 focused archive/verifier tests,
including input and decompression boundaries and gzip integrity checks.
The parent subsequently reported full backend gates passing (284 tests) and
frontend gates passing (342 tests). These full-suite and npm audit results are
parent-provided evidence; this task ran the focused decoder checks directly.
