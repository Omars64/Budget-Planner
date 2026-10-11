import { afterEach, expect, it, vi } from 'vitest'
import { cleanup, render, screen } from '@testing-library/react'
import AppErrorBoundary from './AppErrorBoundary'
import { reportClientFailure } from '../lib/diagnostics'
vi.mock('../lib/diagnostics', () => ({reportClientFailure:vi.fn()}))
afterEach(() => { cleanup(); vi.restoreAllMocks() })
it('keeps ordinary content unchanged', () => {
  render(<AppErrorBoundary><p>Ledger ready</p></AppErrorBoundary>)
  expect(screen.getByText('Ledger ready')).toBeInTheDocument()
})
it('shows a reload screen without exposing crash details', () => {
  vi.spyOn(console, 'error').mockImplementation(() => {})
  const Broken = () => { throw new Error('private-bank-record') }
  render(<AppErrorBoundary><Broken/></AppErrorBoundary>)
  expect(screen.getByRole('alert')).toHaveTextContent('Your saved records have not been changed')
  expect(screen.getByRole('button',{name:'Reload Budgetly'})).toBeInTheDocument()
  expect(screen.queryByText('private-bank-record')).not.toBeInTheDocument()
  expect(reportClientFailure).toHaveBeenCalledWith('render')
})
