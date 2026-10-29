# Offline and outage follow-up — 29 October 2026

The v6.5.6 quality run passed backend, Android JVM, PostgreSQL concurrency and
PostgreSQL load checks. Its browser journey failed during offline reopening;
Android release publication remained blocked. A diagnostic rerun confirmed the
browser was offline, retained its token and local account pointer, but did not
reach the signed-in shell. The diagnostic emits only fixed metadata from the
isolated synthetic origin, never session or financial payloads.

Offline startup now reads the existing token-fingerprint-bound local session
directly when the browser reports offline, rather than first awaiting an HTTP
authentication failure. A missing matching local session leaves the account
locked. An account/token change during restoration does not expose the old one.
Focused tests cover both successful reopening and the locked case without any
authentication network request. The full browser journey remains a release gate.

Production has a separate provider outage: Vercel runtime logs show Neon rejecting
connections because the account/project quota is exceeded. Upstash requests
continue returning 200. The public probe returns STORAGE_UNAVAILABLE, and the
health workflow correctly fails. No database restore, deletion, provider switch
or paid upgrade was performed by this work. A deployment cannot remove a provider
quota block; allowance reset or owner-approved billing is required.

The monitor now prints only HTTP status, an allowlisted readiness source and a
fixed error code. Raw URLs, credentials, response bodies and exceptions remain
excluded. Failure criteria and retries are unchanged; real outages are not
converted into green checks.
