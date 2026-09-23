import { parseDateTime } from './dateTimePicker'

export function transactionErrors(form) {
  const errors = {}
  if (!Number.isFinite(Number(form.amount)) || Number(form.amount) <= 0) errors.amount = 'Enter an amount greater than zero.'
  if (!form.wallet_id) errors.wallet_id = 'Choose a wallet.'
  if (!parseDateTime(form.date)) errors.date = 'Choose a valid transaction date and time.'
  if (form.type === 'transfer' && (!form.transfer_wallet_id || String(form.transfer_wallet_id) === String(form.wallet_id))) errors.transfer_wallet_id = 'Choose a different destination wallet.'
  if (form.recurring_frequency && form.recurring_frequency !== 'none' && (!form.recurring_until || form.recurring_until < form.date.slice(0, 10))) errors.recurring_until = 'Choose a repeat-until date on or after the transaction date.'
  return errors
}

export function focusInvalid(form) {
  window.requestAnimationFrame(() => form?.querySelector('[aria-invalid="true"]')?.focus())
}
