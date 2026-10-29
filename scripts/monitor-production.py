"""Check public readiness; optionally maintain one GitHub incident, without app secrets."""
import argparse
import json
import os
import time
from urllib.request import Request, urlopen
from urllib.error import HTTPError, URLError
from http.client import HTTPException

TITLE = '[Budgetly Monitor] Service needs attention'
PROBE_ERROR_CODES = frozenset({'STORAGE_UNAVAILABLE', 'COORDINATION_UNAVAILABLE'})


def probe_diagnostic(attempt, status, headers, payload):
    """Print only bounded status and explicitly allowlisted public signals."""
    status = status if type(status) is int and 100 <= status <= 599 else 'unknown'
    source = headers.get('X-Budgetly-Readiness-Source') if headers is not None else None
    source = source if source in ('cached', 'probe') else 'unknown'
    code = payload.get('code') if isinstance(payload, dict) else None
    code = code if isinstance(code, str) and code in PROBE_ERROR_CODES else 'unknown'
    print(f'Probe {attempt}: status={status} source={source} code={code}')


def healthy(url):
    for attempt in range(3):
        status, headers, payload = None, None, None
        try:
            with urlopen(Request(url, headers={'User-Agent': 'Budgetly-Readiness', 'Cache-Control': 'no-cache'}), timeout=15) as response:
                status, headers = response.status, response.headers
                payload = json.loads(response.read(4096))
                probe_diagnostic(attempt + 1, status, headers, payload)
                if response.status == 200 and isinstance(payload, dict) and payload.get('ok') is True:
                    return True
        except HTTPError as error:
            status, headers = error.code, error.headers
            try:
                with error:
                    payload = json.loads(error.read(4096))
            except (OSError, HTTPException, ValueError):
                pass
            probe_diagnostic(attempt + 1, status, headers, payload)
        except (URLError, OSError, HTTPException, ValueError):
            probe_diagnostic(attempt + 1, status, headers, payload)
        if attempt < 2:
            time.sleep(5)
    return False


def incident(ok, repository, token):
    def request(path, method='GET', body=None):
        req = Request('https://api.github.com/repos/' + repository + path, method=method,
                      data=json.dumps(body).encode() if body is not None else None,
                      headers={'Authorization': 'Bearer ' + token, 'Accept': 'application/vnd.github+json',
                               'Content-Type': 'application/json', 'User-Agent': 'Budgetly-Monitor'})
        with urlopen(req, timeout=20) as response:
            return json.loads(response.read())
    issues = []
    for page in range(1, 6):
        batch = request(f'/issues?state=open&per_page=100&page={page}')
        issues.extend(batch)
        if len(batch) < 100:
            break
    existing = next((row for row in issues if row.get('title') == TITLE and
                     row.get('user', {}).get('login') == 'github-actions[bot]' and 'pull_request' not in row), None)
    if ok and existing:
        request(f"/issues/{existing['number']}/comments", 'POST', {'body': 'Readiness recovered. Check Admin → Service health for recent events.'})
        request(f"/issues/{existing['number']}", 'PATCH', {'state': 'closed'})
    elif not ok and not existing:
        request('/issues', 'POST', {'title': TITLE, 'body': 'Budgetly failed three readiness probes. Check Vercel errors, the cron-job.org runner, and Admin → Service health. No financial data or credentials are collected by this monitor.', 'assignees': [repository.split('/')[0]]})


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--url', required=True)
    parser.add_argument('--github-issues', action='store_true')
    args = parser.parse_args()
    if not args.url.startswith('https://'):
        parser.error('An HTTPS readiness URL is required')
    ok = healthy(args.url)
    if args.github_issues:
        incident(ok, os.environ['GITHUB_REPOSITORY'], os.environ['GH_TOKEN'])
    print('Readiness: healthy' if ok else 'Readiness: needs attention')
    return 0 if ok else 1


if __name__ == '__main__':
    raise SystemExit(main())
