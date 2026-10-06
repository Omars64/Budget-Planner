import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, expect, test, vi } from 'vitest'
import RestorePreview from './RestorePreview'

afterEach(cleanup)
const preview={name:'backup.json',data:{version:1},counts:[{key:'wallets',label:'Wallets',count:2}]}
test('requires explicit confirmation and keeps failed restores retryable', async () => {
  const restore=vi.fn().mockRejectedValueOnce(new Error('Connection lost')).mockResolvedValueOnce(undefined)
  render(<RestorePreview preview={preview} onClose={vi.fn()} onRestore={restore}/>)
  expect(screen.getByRole('button',{name:'Replace workspace'})).toBeDisabled()
  expect(restore).not.toHaveBeenCalled()
  fireEvent.click(screen.getByRole('checkbox'))
  fireEvent.click(screen.getByRole('button',{name:'Replace workspace'}))
  await screen.findByRole('alert')
  expect(screen.getByRole('alert')).toHaveTextContent('Connection lost')
  fireEvent.click(screen.getByRole('button',{name:'Replace workspace'}))
  await waitFor(()=>expect(restore).toHaveBeenCalledTimes(2))
})
test('cancel does not restore records', () => {
  const restore=vi.fn(),close=vi.fn()
  render(<RestorePreview preview={preview} onClose={close} onRestore={restore}/>)
  fireEvent.click(screen.getByRole('button',{name:'Cancel'}))
  expect(close).toHaveBeenCalledOnce()
  expect(restore).not.toHaveBeenCalled()
})
