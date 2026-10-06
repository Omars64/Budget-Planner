import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, expect, test, vi } from 'vitest'
import Modal from './Modal'
afterEach(cleanup)
test('footer cancellation also protects unsaved edits', async () => {
  const close=vi.fn()
  render(<Modal open protectChanges title="Edit record" onClose={close} footer={<button type="button" onClick={close}>Cancel</button>}><input aria-label="Description"/></Modal>)
  fireEvent.change(screen.getByLabelText('Description'),{target:{value:'Changed'}})
  fireEvent.click(screen.getByRole('button',{name:'Cancel'}))
  expect(close).not.toHaveBeenCalled()
  await screen.findByText('Discard your unsaved changes?')
})
test('dirty edits survive Escape and Android Back until explicitly discarded', async () => {
  const close=vi.fn()
  render(<Modal open protectChanges title="Edit record" onClose={close}><form><input aria-label="Description" defaultValue="Original"/><button type="button" onClick={close}>Cancel</button></form></Modal>)
  fireEvent.change(screen.getByLabelText('Description'),{target:{value:'Changed'}})
  fireEvent.keyDown(document,{key:'Escape'})
  expect(close).not.toHaveBeenCalled()
  await waitFor(() => expect(screen.getByText('Discard your unsaved changes?')).toBeVisible())
  fireEvent.click(screen.getByText('Keep editing'))
  expect(screen.getByLabelText('Description')).toHaveValue('Changed')
  act(() => window.dispatchEvent(new Event('budgetly:back',{cancelable:true})))
  fireEvent.click(screen.getByText('Discard changes'))
  expect(close).toHaveBeenCalledOnce()
})
test('recoverable drafts and ordinary pickers close without extra confirmation', () => {
  const close=vi.fn()
  render(<Modal open preserveDraft protectChanges title="New record" onClose={close}><input aria-label="Description"/></Modal>)
  fireEvent.change(screen.getByLabelText('Description'),{target:{value:'Draft'}})
  fireEvent.click(screen.getByLabelText('Close dialog'))
  expect(close).toHaveBeenCalledOnce()
})
test('custom picker changes can explicitly protect the edited form', async () => {
  const close=vi.fn()
  render(<Modal open protectChanges isDirty title="Edit record" onClose={close}/>)
  fireEvent.click(screen.getByLabelText('Close dialog'))
  expect(close).not.toHaveBeenCalled()
  await waitFor(() => expect(screen.getByText('Keep editing')).toBeVisible())
})
