import { Capacitor, registerPlugin } from '@capacitor/core'
import { dateInput } from './time'

const VoiceInput = registerPlugin('VoiceInput')
let activeRecognition = null

const nativeAndroid = () => typeof Capacitor.isNativePlatform === 'function' && Capacitor.isNativePlatform() && Capacitor.getPlatform() === 'android'

export const voiceInputSupported = () => {
  if (nativeAndroid()) return true
  return typeof window !== 'undefined' && Boolean(window.SpeechRecognition || window.webkitSpeechRecognition)
}

const voiceError = error => {
  const code = String(error?.code || error?.error || '').toLowerCase()
  const message = String(error?.message || error || '').toLowerCase()
  if (code.includes('not-allowed') || code.includes('permission') || message.includes('permission')) return 'Microphone permission was denied. Allow it in your device or browser settings.'
  if (code.includes('no-speech') || message.includes('no speech')) return 'No speech was detected. Try again and speak after the microphone opens.'
  if (code.includes('network')) return 'Voice input is unavailable right now. Check your connection and try again.'
  if (code.includes('aborted') || code.includes('cancel')) return 'Voice input cancelled.'
  if (message.includes('not implemented') || message.includes('unavailable')) return 'Voice input is not available on this device.'
  return error?.message || 'Voice input could not be started. Try again.'
}

export async function listenForVoice({ language = 'en-US' } = {}) {
  if (nativeAndroid()) {
    try {
      const result = await VoiceInput.listen({ language })
      const text = String(result?.text || '').trim()
      if (!text) throw new Error('No speech was detected. Try again.')
      return text
    } catch (error) {
      throw new Error(voiceError(error))
    }
  }

  const Recognition = typeof window !== 'undefined' && (window.SpeechRecognition || window.webkitSpeechRecognition)
  if (!Recognition) throw new Error('Voice input is not available in this browser. Try Chrome, Edge, or the Budgetly Android app.')
  if (activeRecognition) throw new Error('Voice input is already listening.')

  return new Promise((resolve, reject) => {
    const session = {
      recognition: null,
      restartTimer: null,
      finalParts: [],
      interim: '',
      stopRequested: false,
      settled: false,
    }
    const text = () => [...session.finalParts, session.interim].filter(Boolean).join(' ').replace(/\s+/g, ' ').trim()
    const finish = (callback, value) => {
      if (session.settled) return
      session.settled = true
      if (session.restartTimer) window.clearTimeout(session.restartTimer)
      if (activeRecognition === session) activeRecognition = null
      callback(value)
    }
    const finishFromSpeech = () => {
      const value = text()
      if (value) finish(resolve, value)
      else finish(reject, new Error('No speech was detected. Try again.'))
    }
    const scheduleRestart = () => {
      if (session.settled || session.stopRequested || session.restartTimer) return
      session.restartTimer = window.setTimeout(() => {
        session.restartTimer = null
        startRecognition()
      }, 120)
    }
    const startRecognition = () => {
      if (session.settled || session.stopRequested) return
      let recognition
      try { recognition = new Recognition() } catch (error) { finish(reject, new Error(voiceError(error))); return }
      session.recognition = recognition
      recognition.lang = language
      recognition.continuous = true
      recognition.interimResults = true
      recognition.maxAlternatives = 1
      recognition.onresult = event => {
        let interim = ''
        for (let index = event.resultIndex || 0; index < event.results.length; index += 1) {
          const result = event.results[index]
          const transcript = result?.[0]?.transcript?.trim() || ''
          if (result.isFinal && transcript) session.finalParts.push(transcript)
          else if (transcript) interim += `${transcript} `
        }
        session.interim = interim.trim()
      }
      recognition.onerror = event => {
        const code = String(event?.error || '').toLowerCase()
        if (session.stopRequested) { finishFromSpeech(); return }
        if (code === 'no-speech' || code === 'aborted') { scheduleRestart(); return }
        finish(reject, new Error(voiceError(event)))
      }
      recognition.onend = () => {
        session.recognition = null
        if (session.stopRequested) finishFromSpeech()
        else scheduleRestart()
      }
      try { recognition.start() } catch (error) { finish(reject, new Error(voiceError(error))) }
    }
    session.stop = () => {
      session.stopRequested = true
      if (session.restartTimer) window.clearTimeout(session.restartTimer)
      if (session.recognition) {
        try { session.recognition.stop() } catch { finishFromSpeech() }
      } else finishFromSpeech()
      window.setTimeout(() => {
        if (session.stopRequested && !session.settled) finishFromSpeech()
      }, 500)
    }
    activeRecognition = session
    startRecognition()
  })
}

export async function stopVoiceInput() {
  if (nativeAndroid()) {
    try { await VoiceInput.stop() } catch { /* The recognition result will settle the original call. */ }
    return
  }
  try { activeRecognition?.stop?.() } catch { /* The browser may already have ended recognition. */ }
}

const escapeRegExp = value => String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
const rowId = value => value?.wallet_id ?? value?.id ?? ''
const rowName = value => String(value?.name || '').trim()

function namedMatches(text, rows) {
  return rows
    .map(row => ({ row, name: rowName(row) }))
    .filter(item => item.name)
    .flatMap(item => {
      const aliases = [...new Set([item.name, item.name.replace(/\b(wallet|account|card)\b/gi, '').replace(/\s+/g, ' ').trim()])].filter(Boolean)
      const match = aliases.map(alias => new RegExp(`\\b${escapeRegExp(alias)}\\b`, 'i').exec(text)).filter(Boolean).sort((a, b) => a.index - b.index || b[0].length - a[0].length)[0]
      return match ? [{ ...item, index: match.index }] : []
    })
    .sort((a, b) => a.index - b.index || b.name.length - a.name.length)
}

const numberWords = {
  zero: 0, oh: 0, one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9,
  ten: 10, eleven: 11, twelve: 12, thirteen: 13, fourteen: 14, fifteen: 15, sixteen: 16, seventeen: 17, eighteen: 18, nineteen: 19,
  twenty: 20, thirty: 30, forty: 40, fifty: 50, sixty: 60, seventy: 70, eighty: 80, ninety: 90,
}
const numberWord = '(?:zero|oh|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|thirteen|fourteen|fifteen|sixteen|seventeen|eighteen|nineteen|twenty|thirty|forty|fifty|sixty|seventy|eighty|ninety|hundred|thousand|point|and|a|half)'

function spokenInteger(words) {
  let total = 0
  let current = 0
  words.forEach(word => {
    if (word === 'hundred' || word === 'thousand') {
      const scale = word === 'thousand' ? 1000 : 100
      current = (current || 1) * scale
      if (scale === 1000) { total += current; current = 0 }
    } else if (numberWords[word] !== undefined) current += numberWords[word]
  })
  return total + current
}

function spokenNumber(value) {
  const words = value.toLowerCase().replace(/-/g, ' ').split(/\s+/).filter(word => !['and', 'a'].includes(word))
  const point = words.indexOf('point')
  if (point >= 0) {
    const whole = spokenInteger(words.slice(0, point))
    const digits = words.slice(point + 1).map(word => numberWords[word]).filter(value => value !== undefined)
    return digits.length ? Number(`${whole}.${digits.join('')}`) : whole
  }
  if (words.includes('half')) return spokenInteger(words.filter(word => word !== 'half')) + 0.5
  return spokenInteger(words)
}

function spokenAmountFrom(text) {
  const currency = '(?:kwd|k\\.?d\\.?|d\\.?k\\.?|dinars?|fils?)'
  const sequence = `(${numberWord}(?:\\s+${numberWord})*)`
  const currencyMatch = new RegExp(`${sequence}\\s*${currency}|${currency}\\s*${sequence}`, 'i').exec(text)
  const contextualMatch = new RegExp(`\\b(?:spent|spend|paid|pay|cost|amount|income|received|receive|transfer(?:red)?|send|sent|move|moved|shift|top up|put)(?:\\s+(?:was|is|of|me|about|around))*\\s*${sequence}`, 'i').exec(text)
  const raw = currencyMatch?.[1] || currencyMatch?.[2] || contextualMatch?.[1] || ''
  return raw ? { raw, value: spokenNumber(raw) } : { raw: '', value: '' }
}

function amountFrom(text) {
  const currency = text.match(/(?:\b(?:kwd|kd|k\.?d\.?|d\.?k\.?)\s*)(\d+(?:[.,]\d{1,3})?)|(\d+(?:[.,]\d{1,3})?)\s*(?:\bkwd\b|\bkd\b|k\.?d\.?|d\.?k\.?)\b/i)
  const contextual = text.match(/\b(?:spent|spend|paid|pay|cost|amount|income|received|receive|transfer(?:red)?|send|sent|move|moved|shift|top up|put)(?:\s+(?:was|is|of|me|about|around))*\s*(\d+(?:[.,]\d{1,3})?)/i)
  if (!currency && !contextual) {
    const spoken = spokenAmountFrom(text)
    if (spoken.raw) return spoken
  }
  const generic = text.replace(/\b\d{1,2}:\d{2}\b/g, ' ').replace(/\b\d{1,2}\s*(?:am|pm)\b/gi, ' ').match(/\b\d+(?:[.,]\d{1,3})?\b/)
  const raw = currency?.[1] || currency?.[2] || contextual?.[1] || generic?.[0] || ''
  return raw ? { raw, value: Number(raw.replace(',', '.')) } : { raw: '', value: '' }
}

function dateFrom(text) {
  const offset = /\btomorrow\b/i.test(text) ? 1 : /\byesterday\b/i.test(text) ? -1 : 0
  const base = new Date(Date.now() + offset * 86400000)
  let value = dateInput(base)
  const twelveHour = text.match(/\b(?:at\s*)?(\d{1,2})(?::([0-5]\d))?\s*(am|pm)\b/i)
  const twentyFourHour = text.match(/\bat\s+([01]?\d|2[0-3]):([0-5]\d)\b/i)
  if (!offset && !twelveHour && !twentyFourHour) return ''
  if (twelveHour) {
    let hour = Number(twelveHour[1]) % 12
    if (twelveHour[3].toLowerCase() === 'pm') hour += 12
    value = `${value.slice(0, 11)}${String(hour).padStart(2, '0')}:${twelveHour[2] || '00'}`
  } else if (twentyFourHour) {
    value = `${value.slice(0, 11)}${String(Number(twentyFourHour[1])).padStart(2, '0')}:${twentyFourHour[2]}`
  }
  return value
}

function cleanDescription(value) {
  return value.replace(/[,.!?]+$/g, '').replace(/^\s*(?:a|an|the)\s+/i, '').trim()
}

export function parseVoiceTransaction(text, { wallets = [], categories = [] } = {}) {
  const source = String(text || '').trim().replace(/\s+/g, ' ')
  if (!source) return {}
  const lower = source.toLowerCase()
  const amount = amountFrom(source)
  const walletMatches = namedMatches(source, wallets)
  const transferWords = /\b(transfer|transferred|move|moved|shift|top up)\b/.test(lower)
  const incomeWords = /\b(income|received|receive|salary|paycheck|deposit|refund|cashback|rebate|earned|credit|came in|got paid)\b/.test(lower)
  const transferContext = walletMatches.length >= 2 || /\b(?:wallet|account|between)\b/.test(lower) || (/\bfrom\b/.test(lower) && /\bto\b/.test(lower)) || (walletMatches.length >= 1 && /\b(?:into|to)\b/.test(lower))
  const type = (transferWords && transferContext) || (/\b(send|sent)\b/.test(lower) && walletMatches.length >= 1) ? 'transfer' : incomeWords ? 'income' : 'expense'
  const categoryMatches = namedMatches(source, categories.filter(category => !category.kind || category.kind === type))
  const walletIds = walletMatches.map(item => rowId(item.row)).filter(Boolean)
  const noteMatch = source.match(/\b(?:note|memo)\s+(?:that\s+)?(.+)$/i)
  const body = noteMatch ? source.slice(0, noteMatch.index).trim() : source
  const descriptionMatch = body.match(/\b(?:for|on|about|bought|buy|purchased|purchase|ordered|ordering|paid for|spent on)\s+(.+?)(?=\s+(?:from|using|via|with|at|today|yesterday|tomorrow|because|since)\b|$)/i)
  let description = cleanDescription(descriptionMatch?.[1] || '')
  if (!description || /^\d/.test(description)) {
    let fallback = body
    if (amount.raw) fallback = fallback.replace(new RegExp(escapeRegExp(amount.raw), 'i'), ' ')
    walletMatches.forEach(item => { fallback = fallback.replace(new RegExp(escapeRegExp(item.name), 'i'), ' ') })
    categoryMatches.forEach(item => { fallback = fallback.replace(new RegExp(escapeRegExp(item.name), 'i'), ' ') })
    description = cleanDescription(fallback.replace(/\b(?:a|an|the|please|can you|could you|i|me|my|we|want|would|like|to|in|into|and|add|create|record|log|save|new|transaction|expense|income|transfer|transferred|move|moved|shift|top up|send|sent|spent|spend|paid|pay|bought|buy|purchased|purchase|ordered|ordering|received|receive|got paid|from|using|via|with|for|on|at|today|tomorrow|yesterday|because|since|wallet|account|card|kwd|kd|k\.d|d\.k|dinars?|fils?|it|was|cost|cost me|amount|money|around|about)\b/gi, ' '))
  }
  if (!description) description = type === 'transfer' ? 'Transfer' : type === 'income' ? 'Income' : 'Expense'
  return {
    type,
    amount: amount.value,
    description,
    notes: noteMatch ? cleanDescription(noteMatch[1]) : '',
    date: dateFrom(source),
    wallet_id: walletIds[0] || '',
    transfer_wallet_id: type === 'transfer' ? walletIds[1] || '' : '',
    category_id: type === 'transfer' ? '' : rowId(categoryMatches[0]?.row) || '',
  }
}
