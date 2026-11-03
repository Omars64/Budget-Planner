export default function OperationalSignals({ signals }) {
  if (!signals) return null
  return <section aria-label="Recent service signals" className="stack gap-12">
    <h4>Last {signals.window_minutes} minutes</h4>
    <dl className="resource-dashboard">
      <div><dt>Failed financial requests</dt><dd>{signals.failed_financial_requests}</dd></div>
      <div><dt>App errors reported</dt><dd>{signals.client_errors}</dd></div>
      <div><dt>Requests taking 2 seconds or more</dt><dd>{signals.slow_requests}</dd></div>
    </dl>
    {signals.healthy === false && <p role="alert" className="form-error">Repeated financial request failures need attention. Check service events before asking users to retry.</p>}
    <p className="muted">These are recorded service events, not balances or proof that a particular entry was lost. Normal validation and permission errors are excluded from the failure alert.</p>
  </section>
}
