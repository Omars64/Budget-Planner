import { describe, expect, it } from 'vitest'
import { normalizeBankText, normalizeMerchant, parseBankNotification } from './parser'
import fixtures from '../../../tests/fixtures/bank_notifications/synthetic.json'

const parse = text => parseBankNotification({ text, postedAt: Date.UTC(2026, 9, 8, 12), packageName: 'test.bank' })
describe('bank alert parser', () => {
  it.each(['+1.000KWD', '+ KWD 1.000', 'KWD +1.000', '+1.000 KD', '+د.ك 1.000'])('accepts a generic signed credit: %s', amount => {
    expect(parse(`Any Bank ${amount} Account 9010`)).toMatchObject({ recognized: true, amount: '1.000', transaction_type: 'income', account_last4: '9010', currency: 'KWD', confidence: 0.65 })
  })
  it.each(['-1.000KWD', '- KWD 1.000', 'KWD -1.000', '\u22121.000 KWD'])('accepts a generic signed debit: %s', amount => {
    expect(parse(`Another Bank ${amount} at Shop card xxxx4821`)).toMatchObject({ recognized: true, amount: '1.000', transaction_type: 'expense', merchant: 'Shop' })
  })
  it.each([['+50.25USD', '50.25', 'USD', 'income'], ['EUR -12.30', '12.30', 'EUR', 'expense'], ['+100JPY', '100', 'JPY', 'income'], ['-١٫٠٠٠KWD', '1.000', 'KWD', 'expense']])('supports signed catalog currencies: %s', (text, amount, currency, kind) => expect(parse(text)).toMatchObject({ recognized: true, amount, currency, transaction_type: kind }))
  it.each(['Balance: -1.000KWD', 'Available +1.000 KWD', 'Available balance: KWD -1.000', 'KWD +1.000 (available balance)', 'رصيد -١٫٠٠٠KWD', 'Your available balance is +1.000KWD', 'Offer +1.000KWD', 'OTP +1.000KWD', '+KWD -1.000', '--1.000KWD', '+1.0001KWD', '+1.000XYZ', '-0.000KWD'])('rejects unsafe signed-only alert: %s', text => expect(parse(text).recognized).toBe(false))
  it('chooses the signed payment instead of an unsigned balance', () => expect(parse('Available 200.000KWD; -5.000KWD at Shop')).toMatchObject({ amount: '5.000', transaction_type: 'expense' }))
  it('does not mistake the following balance label for a payment suffix', () => expect(parse('-5.000KWD Balance 200.000KWD')).toMatchObject({ amount: '5.000', transaction_type: 'expense' }))
  it('flags multiple signed payments for review', () => expect(parse('+1.000KWD and -2.000KWD')).toMatchObject({ amount: '1.000', transaction_type: 'income', confidence: 0.55 }))
  it('preserves positive refund and negative ATM semantics', () => {
    expect(parse('Refund +1.000KWD')).toMatchObject({ transaction_type: 'refund' })
    expect(parse('ATM -1.000KWD')).toMatchObject({ transaction_type: 'withdrawal' })
  })
  it.each([['+', 'income'], ['-', 'expense'], ['\u2212', 'expense']])('parses CBK WAMD direction %s', (sign, kind) => {
    const result = parse(`CBK\n${sign}1.000KWD\nYOU Ac 9010\nWAMD\nAvailable 20.488KWD`)
    expect(result).toMatchObject({ recognized: true, amount: '1.000', currency: 'KWD', account_last4: '9010', merchant: 'WAMD transfer', transaction_type: kind, confidence: 0.65 })
    expect(result.reasons).toContain('Transfer direction needs review')
  })
  it('supports a CBK app title and Arabic digits', () => expect(parseBankNotification({ title: 'CBK Mobile', text: 'CBK +١٫٠٠٠KWD YOU Ac ٩٠١٠ WAMD Available ٢٠٫٤٨٨KWD' })).toMatchObject({ amount: '1.000', account_last4: '9010' }))
  it.each(['CBK Mobile Application is running in foreground', 'CBK Available +20.488KWD', 'CBK +1.000KWD YOU Ac 9010 WAMD Available 20.488KWD OTP 12345', 'CBK +1.0001KWD YOU Ac 9010 WAMD Available 20.488KWD'])('rejects incomplete/security/non-payment CBK alerts: %s', text => expect(parse(text).recognized).toBe(false))
  it.each(fixtures)('fixture: $name', fixture => expect(parse(fixture.text).transaction_type || null).toBe(fixture.kind))
  it.each(['KWD 12.500', '12.500 KWD', 'KD 12.500', 'K.D. 12.500', 'د.ك 12.500', '12.500 د.ك'])('parses %s without floating point', amount => {
    expect(parse(`Purchase ${amount} at TALABAT.`)).toMatchObject({ recognized: true, amount: '12.500', currency: 'KWD', merchant: 'Talabat', transaction_type: 'expense' })
  })
  it('normalizes Arabic and Persian digits, separators and comma groups', () => {
    expect(normalizeBankText('١۲٣')).toBe('123')
    expect(parse('Purchase KWD ١٬٢٣٤٫٥٠٠ at Shop')).toMatchObject({ amount: '1234.500' })
  })
  it.each([['Salary credited KWD 500.000', 'income'], ['KWD 25.000 credited after reversal', 'refund'], ['ATM withdrawal KWD 50.000', 'withdrawal'], ['KWD 100.000 transferred to beneficiary', 'transfer']])('classifies %s', (text, type) => expect(parse(text).transaction_type).toBe(type))
  it.each(['Your OTP is 492183. Do not share this code.', 'Purchase KWD 5.000 verification code 12345', 'New offer: payment KWD 5.000', 'Your statement is ready KWD 5.000', 'Your balance is KWD 50.000', 'Random words', '', 'Purchase KWD 0.000', 'Purchase USD 1.001'])('rejects %s', text => expect(parse(text).recognized).toBe(false))
  it('keeps missing merchant honest and parses card endings', () => {
    expect(parse('Purchase of KWD 12.500')).toMatchObject({ recognized: true, merchant: 'Unknown merchant' })
    for (const ending of ['ending 1234', 'ending in 1234', 'card xx1234', 'account xxxx1234', '****1234']) expect(parse(`Purchase KWD 5.000 ${ending}`).account_last4).toBe('1234')
  })
  it('distinguishes transaction amounts from available balances and flags ambiguity', () => {
    expect(parse('Purchase KWD 5.000 at Shop; Balance KWD 100.000').amount).toBe('5.000')
    expect(parse('Purchase KWD 5.000 or KWD 6.000').confidence).toBe(0.55)
  })
  it('normalizes only known merchant aliases', () => {
    for (const name of ['TALABAT.COM', 'TALABAT*12345', 'TALABAT KW']) expect(normalizeMerchant(name)).toBe('Talabat')
    expect(normalizeMerchant('Talabat Grocery Store')).toBe('Talabat Grocery Store')
  })
  it('never keeps a full card number in merchant details', () => expect(parse('Purchase KWD 5.000 at Merchant 4111111111111111').merchant).not.toContain('4111111111111111'))
  it.each(['Purchase KWD 1.2345', 'Purchase 1.2345 KWD', 'Purchase XXKWD 5.000', 'Purchase KWD 5.000USD'])('never accepts a partial amount or currency: %s', text => expect(parse(text).recognized).toBe(false))
})
