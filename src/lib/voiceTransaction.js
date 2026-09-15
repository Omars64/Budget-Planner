import { dateInput } from './time'

const escape = value => String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
const id = row => row?.wallet_id ?? row?.id
const canonical = value => String(value || '').toLowerCase().replace(/&/g, ' and ').replace(/[^a-z0-9]+/g, ' ').trim().replace(/\s+/g, ' ')
const clean = value => value.trim().replace(/^[,:.\s]+|[,:.!?\s]+$/g, '').replace(/\s+/g, ' ')
const words = { zero:0, oh:0, one:1, two:2, three:3, four:4, five:5, six:6, seven:7, eight:8, nine:9, ten:10, eleven:11, twelve:12, thirteen:13, fourteen:14, fifteen:15, sixteen:16, seventeen:17, eighteen:18, nineteen:19, twenty:20, thirty:30, forty:40, fifty:50, sixty:60, seventy:70, eighty:80, ninety:90 }
const numberToken = String.raw`(?:\d+(?:[.,]\d+)?|${Object.keys(words).join('|')}|hundred|thousand|half)`
const numeric = String.raw`${numberToken}(?:(?:\s+|(?<=[a-z])-(?=[a-z]))(?:(?:point|and|a)\s+)*${numberToken})*`
const currency = String.raw`(?:kwd|k\.?d\.?|dinars?|fils)`

function integer(tokens) {
  let total = 0, group = 0
  for (const token of tokens) {
    if (token === 'hundred') group = (group || 1) * 100
    else if (token === 'thousand') { total += (group || 1) * 1000; group = 0 }
    else group += words[token] ?? (Number(token) || 0)
  }
  return total + group
}

function numberValue(raw) {
  const tokens = raw.toLowerCase().replace(/-/g, ' ').split(/\s+/).filter(t => !['and','a'].includes(t))
  const point = tokens.indexOf('point')
  if (point >= 0) {
    const decimals = tokens.slice(point + 1)
    const digits = decimals.every(t => (words[t] ?? Number(t)) < 10)
      ? decimals.map(t => words[t] ?? t).join('')
      : String(integer(decimals))
    return Number(`${integer(tokens.slice(0, point))}.${digits}`)
  }
  if (tokens.length === 1 && /^\d/.test(tokens[0])) return Number(tokens[0].replace(',', '.'))
  return integer(tokens.filter(t => t !== 'half')) + (tokens.includes('half') ? .5 : 0)
}

function findAmount(text, explicit = false) {
  const candidates = [...text.matchAll(new RegExp(String.raw`\b(${numeric})(?:\s*(${currency})\b)?`, 'gi'))]
  for (const match of candidates) {
    const before = text.slice(0, match.index)
    const after = text.slice(match.index + match[0].length)
    // Times and relative dates must never become transaction amounts.
    if (/\b(?:at|time|date)\s*$/i.test(before) || /^(?::\d|\s*(?:am|pm|days?\s+ago|hours?\s+ago)\b)/i.test(after)) continue
    const context = /\b(?:amount|spent|spend|paid|pay|cost|receive[ds]?|income|refund|transfer(?:red)?|move[ds]?|send|sent|log|record|add|transaction)\b[^.!?]*$/i.test(before)
    const unitsBefore = new RegExp(String.raw`\b${currency}\s*$`, 'i').test(before)
    if (!explicit && !context && !match[2] && !unitsBefore && (before.trim() || !/^\s*(?:$|for|on)/i.test(after))) continue
    let value = numberValue(match[1])
    let end = match.index + match[0].length
    if (match[2]?.toLowerCase() === 'fils') value /= 1000
    else if (match[2]) {
      const fils = new RegExp(String.raw`^\s*(?:and\s+)?(${numeric})\s+fils\b`, 'i').exec(after)
      if (fils) { value += numberValue(fils[1]) / 1000; end += fils[0].length }
    }
    if (Number.isFinite(value) && value > 0) return { value:Number(value.toFixed(3)), start:match.index, end }
  }
  return null
}

function matches(text, rows) {
  const found = []
  for (const row of rows) {
    const name = canonical(row.name)
    const aliases = [...new Set([name, name.replace(/\b(wallet|account|card)\b/g, '').trim()])].filter(Boolean)
    for (const alias of aliases) {
      const pattern = alias.split(' ').map(word => word === 'and' ? '(?:and|&)' : escape(word)).join(String.raw`\s+`)
      const match = new RegExp(String.raw`\b${pattern}\b`, 'i').exec(text)
      if (match) { found.push({ row, start:match.index, end:match.index + match[0].length }); break }
    }
  }
  return found.sort((a,b) => a.start - b.start || (b.end-b.start) - (a.end-a.start))
}

function choose(text, rows, label, issue) {
  const normalized = canonical(text).replace(/^(?:my|the)\s+/, '').replace(/\s+(?:please|instead)$/, '')
  let candidates = rows.filter(row => canonical(row.name) === normalized)
  if (!candidates.length) candidates = matches(text, rows).map(item => item.row)
  if (candidates.length === 1) return id(candidates[0])
  issue(candidates.length ? `More than one ${label} matches "${clean(text)}". Please choose one.` : `Could not match ${label} "${clean(text)}". Please choose it in the form.`)
  return undefined
}

function datePatch(text, currentDate) {
  const relative = /\b(day before yesterday|yesterday|today|tomorrow|\d+\s+days?\s+ago)\b/i.exec(text)
  const clock = /\b(?:at|time)?\s*(1[0-2]|0?[1-9])(?::([0-5]\d))?\s*(a\.?m\.?|p\.?m\.?)\b/i.exec(text)
    || /\b(?:at|time)\s+([01]?\d|2[0-3]):([0-5]\d)\b/i.exec(text)
  if (!relative && !clock) return ''
  let base = currentDate || dateInput()
  if (relative) {
    const word = relative[0].toLowerCase()
    const offset = word === 'tomorrow' ? 1 : word === 'yesterday' ? -1 : word === 'day before yesterday' ? -2 : word.includes('ago') ? -Number.parseInt(word) : 0
    base = dateInput(new Date(Date.now() + offset * 86400000)).slice(0,10) + base.slice(10)
  }
  if (clock) {
    let hour = Number(clock[1])
    if (clock[3]) hour = hour % 12 + (/^p/i.test(clock[3]) ? 12 : 0)
    base = `${base.slice(0,11)}${String(hour).padStart(2,'0')}:${clock[2] || '00'}`
  }
  return base
}

// Return only spoken fields. Later recordings are patches to the current draft.
export function parseVoiceTransaction(text, { wallets = [], categories = [], current = {}, onIssue = () => {} } = {}) {
  const source = String(text || '').replace(/\s+/g, ' ').trim()
  if (!source) return {}
  const patch = {}
  const removed = []
  const mask = () => {
    const chars = source.split('')
    removed.forEach(([start,end]) => chars.fill(' ', start, end))
    return chars.join('')
  }
  const marker = /\b(?:(?:for|under|in|with|also|and)\s+)?(?:(?:set|change|update|make|use|add|clear|remove)\s+(?:the\s+)?)?(amount|description|category|notes?|memo|(?:source|from|destination|to)\s+wallet|wallet|date|time|type)\b\s*(?:(?:is|was|to|as|of)\s+|[:=]\s*)?/gi
  const fields = [...source.matchAll(marker)].map((match,index,array) => {
    const start = match.index + match[0].length
    const rest = source.slice(start,array[index+1]?.index ?? source.length)
    const boundary = /\s+(?:from|using|via|into|with)\s+|\s+at\s+\d|\s+(?:today|yesterday|tomorrow)\b|\s+for\s+(?!category\b)/i.exec(rest)
    const end = start + (boundary?.index ?? rest.length)
    return { match, key:match[1].toLowerCase(), start, end, value:clean(source.slice(start,end)).replace(/\s+and$/i,'') }
  })
  fields.filter(f => ['description','note','notes','memo','category'].includes(f.key)).forEach(f => removed.push([f.match.index,f.end]))
  const command = mask()
  const transfer = /\b(transfer(?:red)?|move[ds]?|shift|send|sent)\b/i.test(command)
    && (matches(command,wallets).length >= 2 || /\b(?:from|to|between|wallet|account)\b/i.test(command))
  const explicitType = fields.filter(f => f.key === 'type').at(-1)?.value.match(/\b(expense|income|transfer)\b/i)?.[1]?.toLowerCase()
  if (explicitType) patch.type = explicitType
  else if (transfer) patch.type = 'transfer'
  else if (/\b(received?|income|salary|paycheck|refund|cashback|earned|deposit|got paid)\b/i.test(command)) patch.type = 'income'
  else if (/\b(expense|spent|spend|paid|bought|purchased|cost)\b/i.test(command)) patch.type = 'expense'
  else if (!current.type && /\b(?:add|log|record|transaction)\b/i.test(command)) patch.type = 'expense'
  const type = patch.type || current.type || 'expense'
  const validCategories = categories.filter(c => !c.kind || c.kind === type)
  for (const field of fields) {
    const { key, value, match, start, end } = field
    const clearing = /\b(clear|remove)\b/i.test(match[0])
    if (!value && !clearing) continue
    if (key === 'amount') {
      const amount = findAmount(value,true)
      if (amount) { patch.amount = amount.value; removed.push([match.index, start+amount.end]) }
      else { removed.push([match.index,end]); onIssue('Could not read that amount. Please enter it in the form.') }
      continue
    }
    removed.push([match.index,end])
    if (key === 'description') patch.description = clearing ? '' : value
    else if (['note','notes','memo'].includes(key)) patch.notes = clearing ? '' : value.replace(/^that\s+/i,'')
    else if (key === 'category' && type !== 'transfer') {
      const categoryId = clearing || /^(none|uncategorized)$/i.test(value) ? '' : choose(value,validCategories,'category',onIssue)
      if (categoryId !== undefined) patch.category_id = categoryId
    } else if (key.includes('wallet')) {
      const walletId = choose(value,wallets,'wallet',onIssue)
      if (walletId !== undefined) patch[/^(destination|to)/.test(key) ? 'transfer_wallet_id' : 'wallet_id'] = walletId
    } else if (key === 'date' || key === 'time') {
      const date = datePatch(`${key} ${value}`,patch.date || current.date)
      if (date) patch.date = date
      else onIssue('Could not read that date or time. Please choose it in the form.')
    }
  }
  let remaining = mask()
  const walletMatches = matches(remaining,wallets).filter(item => {
    const before = remaining.slice(0,item.start)
    return /\b(?:from|to|into|using|via|with|in)\s+(?:(?:my|the)\s+)?$/i.test(before) || /^\s*$/.test(before)
  })
  for (const item of walletMatches) {
    const prefix = remaining.slice(0,item.start).match(/\b(from|to|into|using|via|with|in)\s+(?:(?:my|the)\s+)?$/i)
    const target = type === 'transfer' && /^(to|into)$/i.test(prefix?.[1] || '') ? 'transfer_wallet_id' : 'wallet_id'
    const tied = walletMatches.filter(other => other.start === item.start)
    if (tied.length > 1) { onIssue(`More than one wallet matches "${item.row.name}". Please choose one.`); continue }
    if (!(target in patch)) patch[target] = id(item.row)
    removed.push([prefix ? item.start-prefix[0].length : item.start, item.end])
  }
  remaining = mask()
  if (!('amount' in patch)) {
    const amount = findAmount(remaining)
    if (amount) { patch.amount = amount.value; removed.push([amount.start,amount.end]) }
  }
  remaining = mask()
  const date = datePatch(remaining,patch.date || current.date)
  if (date) patch.date = date
  remaining = remaining.replace(/\b(day before yesterday|yesterday|today|tomorrow|\d+\s+days?\s+ago)\b/gi,' ')
    .replace(/\b(?:at\s+)?\d{1,2}(?::\d{2})?\s*[ap]\.?m\.?/gi,' ').replace(/\bat\s+\d{1,2}:\d{2}\b/gi,' ')
  if (!('description' in patch)) {
    const forMatch = /\b(?:for|on|bought|purchased|ordered)\s+(.+)$/i.exec(remaining)
    let description = clean(forMatch?.[1] || '')
    if (!description && 'amount' in patch) description = clean(remaining.replace(/\b(?:could you|can you|please|add|log|record|transaction|expense|income|transfer|transferred|move|moved|i|we|my|the|a|an|was|is|around|about|spent|spend|paid|pay|cost|received|receive|from|to|into|using|via|with|and|wallet|account|card|kwd|kd|dinars?|fils)\b/gi,' '))
    description = description.replace(/^(?:a|an|the)\s+/i,'').replace(/\s+(?:please|and|wallet)$/i,'')
    if (description) patch.description = description
  }
  return patch
}

export function applyVoiceTransaction(text, current, options = {}) {
  const issues = []
  const patch = parseVoiceTransaction(text,{...options,current,onIssue:message => issues.push(message)})
  const draft = {...current,...patch}
  if (patch.type && patch.type !== current.type && !('category_id' in patch)) draft.category_id = ''
  if (draft.type === 'transfer') draft.category_id = ''
  else draft.transfer_wallet_id = ''
  if (options.shared) {
    const source = options.wallets?.find(w => String(id(w)) === String(draft.wallet_id))
    const target = options.wallets?.find(w => String(id(w)) === String(draft.transfer_wallet_id))
    if (String(draft.wallet_id) !== String(current.wallet_id) && !('category_id' in patch)) draft.category_id = ''
    if (target && (id(source) === id(target) || source?.owner_email !== target.owner_email)) {
      draft.transfer_wallet_id = ''
      issues.push('Choose a different destination wallet belonging to the same owner.')
    }
  }
  return { draft, issues:[...new Set(issues)], changed:Object.keys(patch).length > 0 }
}
