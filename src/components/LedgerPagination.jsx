import { ChevronLeft, ChevronRight } from 'lucide-react'

export default function LedgerPagination({ ledger }) {
  if (!ledger.hasMore && ledger.page === 1) return null
  return <nav className="ledger-pagination" aria-label="Transaction pages">
    <button className="button ghost small" onClick={ledger.previous} disabled={ledger.page === 1 || ledger.busy} aria-label="Previous transaction page"><ChevronLeft size={18}/>Previous</button>
    <span aria-live="polite">Page {ledger.page}</span>
    <button className="button ghost small" onClick={ledger.next} disabled={!ledger.hasMore || ledger.busy} aria-label="Next transaction page">Next<ChevronRight size={18}/></button>
  </nav>
}
