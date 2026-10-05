export const shortcutPages = [
  ['/transactions','Transactions'], ['/wallets','Wallets'], ['/budgets','Budgets'],
  ['/analytics','Analytics'], ['/upcoming','Upcoming'], ['/attention','Attention'],
  ['/calendar','Calendar'], ['/goals','Goals & debts'], ['/notes','Notes'], ['/ask-ai','Ask Budgetly'],
]
const key = id => `budgetly:page-usage:v1:${id}`
export function readPageUsage(id) {
  try {
    const saved = JSON.parse(localStorage.getItem(key(id))) || {}
    return Object.fromEntries(shortcutPages.map(([path]) => [path,Math.min(10000,Math.max(0,Number.isInteger(saved[path]) ? saved[path] : 0))]))
  } catch { return {} }
}
export function recordPageVisit(id,path,enabled=true) {
  if (!id || !enabled || !shortcutPages.some(([route]) => route === path)) return
  try { const saved=readPageUsage(id); saved[path]=Math.min(10000,(saved[path] || 0)+1); localStorage.setItem(key(id),JSON.stringify(saved)) } catch { /* Navigation works without optional local history. */ }
}
export function frequentPages(id,allowed) {
  const saved=readPageUsage(id)
  return shortcutPages.filter(([path]) => !allowed || allowed.has(path)).sort((a,b) => (saved[b[0]] || 0)-(saved[a[0]] || 0)).slice(0,3)
}
