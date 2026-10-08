import { currencyCodes, currencyDigits } from '../currency'

export function normalizeBankText(value = '') {
  return String(value).normalize('NFKC').replace(/[\u0660-\u0669\u06f0-\u06f9]/g, char => String(char.charCodeAt(0) % 16))
    .replace(/\u066b/g, '.').replace(/\u066c/g, ',').replace(/\s+/g, ' ').trim()
}

export const containsSensitiveSecurityMessage = text => /\b(?:otp|one[- ]time|verification code|authentication code|security code|password|passcode|login attempt|do not share|pin)\b|رمز\s*(?:التحقق|التفعيل)|كلمة\s*المرور/i.test(text)
export const normalizeMerchant = text => /^(?:talabat(?:\.com|\*\d+| kw)?)$/i.test(text.trim()) ? 'Talabat' : text.trim()
const number = '(?:[0-9]{1,3}(?:,[0-9]{3})+|[0-9]+)(?:\\.[0-9]{1,3})?'
const codes = `${currencyCodes.join('|')}|KD|K\\.D\\.|د\\.ك`
const amountPattern = new RegExp(`(?<![A-Za-z0-9.,])(?:(${codes})\\s*(${number})|(${number})\\s*(${codes}))(?![A-Za-z0-9]|[.,][0-9])`, 'gi')
const precedingCurrency = new RegExp(`(?:${codes})\\s*$`, 'i')

function amountString(value, currency) {
  const [whole, fraction = ''] = value.replace(/,/g, '').split('.')
  const digits = currencyDigits(currency)
  if (fraction.length > digits && /[1-9]/.test(fraction.slice(digits))) return null
  const significant = whole.replace(/^0+(?=\d)/, '')
  if (significant.length > 12 || !/[1-9]/.test(significant + fraction)) return null
  return `${significant}${digits ? '.' + fraction.slice(0, digits).padEnd(digits, '0') : ''}`
}

export function parseBankNotification(raw = {}) {
  const text = normalizeBankText([raw.title, raw.bigText || raw.text, raw.subText].filter(Boolean).join(' '))
  if (!text || containsSensitiveSecurityMessage(text)) return { recognized: false, reason: 'Security or empty message' }
  if (/\b(?:offer|promotion|points earned|statement is ready|maintenance|welcome to|loan offer|credit limit)\b/i.test(text)) return { recognized: false, reason: 'Not a transaction' }
  const transaction_type = /\b(refund(?:ed)?|reversal|reversed|reverted|chargeback)\b|استرداد|عكس العملية/i.test(text) ? 'refund'
    : /\b(credited|salary|deposit(?:ed)?|received|incoming transfer)\b|راتب|إيداع/i.test(text) ? 'income'
      : /\b(atm|cash withdrawal|withdrawn|withdrawal)\b|سحب نقدي/i.test(text) ? 'withdrawal'
        : /\b(transferred|transfer|beneficiary|sent to)\b|تحويل/i.test(text) ? 'transfer'
          : /\b(purchase|spent|pos|knet|card used|payment|debit(?:ed)?|transaction at|was used)\b|شراء|دفع/i.test(text) ? 'expense' : null
  if (!transaction_type) return { recognized: false, reason: 'No transaction action' }
  const found = Array.from(text.matchAll(amountPattern)).map(match => {
    const code = (match[1] || match[4]).toUpperCase()
    const currency = /^(KD|K\.D\.|د\.ك)$/.test(code) ? 'KWD' : code
    const conflictingCurrency = match[3] && precedingCurrency.test(text.slice(0, match.index))
    return { amount: conflictingCurrency ? null : amountString(match[2] || match[3], currency), currency, index: match.index }
  }).filter(item => item.amount)
  if (!found.length) return { recognized: false, reason: 'No transaction amount' }
  // Balances/limits are not transaction amounts; retain ambiguity for review.
  const amounts = found.filter(item => !/(?:balance|available|limit)\s*[:=]?\s*$/i.test(text.slice(Math.max(0, item.index - 30), item.index)))
  if (!amounts.length) return { recognized: false, reason: 'Only balance detected' }
  const selected = amounts[0]
  const account_last4 = text.match(/(?:ending(?: in)?|card|account|a\/c)\s*[:#-]?\s*[*xX]*(\d{4})(?!\d)|[*xX]{2,}(\d{4})(?!\d)/i)?.slice(1).find(Boolean) || ''
  let merchant = text.match(/(?:purchase at|used at|transaction at|merchant\s*:?|\bat|\bfrom|\bPOS)\s+(.+?)(?=\s+(?:on|using|card|account|balance|available|for|ref(?:erence)?)\b|[,;]|$)/i)?.[1]?.trim().replace(/[.]+$/, '') || 'Unknown merchant'
  merchant = merchant.replace(/\b(?:\d[ -]?){12,19}\b/g, '[redacted]').slice(0, 160)
  if (/^(?:\d|KWD\b|KD\b)/i.test(merchant)) merchant = 'Unknown merchant'
  const reasons = ['Amount detected', 'Transaction type detected', 'Timestamp needs review']
  if (merchant !== 'Unknown merchant') reasons.push('Merchant detected')
  if (account_last4) reasons.push('Card ending detected')
  if (amounts.length > 1) reasons.push('Multiple amounts: review required')
  const posted = new Date(raw.postedAt || Date.now())
  if (!Number.isFinite(posted.getTime())) return { recognized: false, reason: 'Invalid timestamp' }
  return { recognized: true, transaction_type, amount: selected.amount, currency: selected.currency,
    merchant: normalizeMerchant(merchant), account_last4, occurred_at: posted.toISOString(),
    confidence: amounts.length > 1 ? 0.55 : Math.min(0.95, 0.65 + (merchant !== 'Unknown merchant' ? 0.2 : 0) + (account_last4 ? 0.1 : 0)), reasons }
}

export async function notificationHash(raw) {
  if (raw.contentHash) return raw.contentHash
  const bytes = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(JSON.stringify([raw.packageName, raw.postedAt || '', raw.title || '', raw.bigText || raw.text || ''])))
  return Array.from(new Uint8Array(bytes), value => value.toString(16).padStart(2, '0')).join('')
}
