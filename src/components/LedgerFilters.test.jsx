import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import LedgerFilters, { defaultLedgerFilters } from './LedgerFilters'
import SettingsSection from './SettingsSection'

afterEach(cleanup)
it('keeps filters hidden and applies them together, without a Kuwait label', async () => {
  const onChange = vi.fn()
  render(<LedgerFilters value={defaultLedgerFilters} onChange={onChange} wallets={[{id:7,name:'Main Wallet'}]}/> )
  expect(screen.queryByLabelText('Wallet')).not.toBeInTheDocument()
  fireEvent.click(screen.getByRole('button', {name:'Filter transactions'}))
  fireEvent.change(screen.getByLabelText('Wallet'), {target:{value:'7'}})
  fireEvent.change(screen.getByLabelText('Month'), {target:{value:'2026-09'}})
  expect(onChange).not.toHaveBeenCalled()
  expect(screen.queryByText('Month (Kuwait)')).not.toBeInTheDocument()
  fireEvent.click(screen.getByRole('button', {name:'Apply filters'}))
  expect(onChange).toHaveBeenCalledWith({...defaultLedgerFilters,wallet:'7',month:'2026-09'})
  await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
})
it('does not apply cancelled changes and supports individual filter removal', () => {
  const onChange = vi.fn()
  render(<LedgerFilters value={{...defaultLedgerFilters,wallet:'7'}} onChange={onChange} wallets={[{id:7,name:'Main Wallet'}]}/> )
  fireEvent.click(screen.getByRole('button', {name:'Filter transactions'}))
  fireEvent.change(screen.getByLabelText('Type'), {target:{value:'income'}})
  fireEvent.click(screen.getByRole('button', {name:'Close dialog'}))
  expect(onChange).not.toHaveBeenCalled()
  fireEvent.click(screen.getByRole('button', {name:'Remove wallet filter'}))
  expect(onChange).toHaveBeenCalledWith(defaultLedgerFilters)
})
it('starts settings groups collapsed', () => {
  const {container}=render(<SettingsSection title="Trash"><button>Delete backup</button></SettingsSection>)
  expect(container.querySelector('details').open).toBe(false)
})
