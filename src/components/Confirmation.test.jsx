import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeAll, expect, it, vi } from 'vitest'
import { useConfirmation } from './Confirmation'

afterEach(cleanup)
beforeAll(() => {
  HTMLDialogElement.prototype.showModal = function () { this.open = true }
  HTMLDialogElement.prototype.close = function () { this.open = false }
})
function Harness({ result }) {
  const { confirm, confirmation } = useConfirmation()
  return <><button onClick={async () => result(await confirm('Delete this transaction?'))}>Delete</button>{confirmation}</>
}
it('does not delete until confirmed and lets the user cancel', async () => {
  const result = vi.fn()
  render(<Harness result={result} />)
  fireEvent.click(screen.getByText('Delete'))
  expect(screen.getByRole('dialog')).toHaveTextContent('Delete this transaction?')
  expect(result).not.toHaveBeenCalled()
  fireEvent.click(screen.getByText('Cancel'))
  await waitFor(() => expect(result).toHaveBeenLastCalledWith(false))
  fireEvent.click(screen.getByText('Delete'))
  fireEvent.click(screen.getByText('Confirm'))
  await waitFor(() => expect(result).toHaveBeenLastCalledWith(true))
})
it('treats Escape as cancellation', async () => {
  const result = vi.fn()
  render(<Harness result={result} />)
  fireEvent.click(screen.getByText('Delete'))
  fireEvent(screen.getByRole('dialog'), new Event('cancel', { bubbles: true, cancelable: true }))
  await waitFor(() => expect(result).toHaveBeenCalledWith(false))
})
