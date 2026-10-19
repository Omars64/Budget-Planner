import { cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import NotesFolders from './NotesFolders'

afterEach(cleanup)
const folders = [{ id: 3, name: 'testing' }, { id: 2, name: 'Personal' }, { id: 1, name: 'Advance' }]
const notes = [{ id: 1, is_owner: true, folder_id: 2, pinned: true }, { id: 2, is_owner: false }]
const props = () => ({ folders, notes, selected: '2', canManage: true, onSelect: vi.fn(), onCreate: vi.fn(), onRename: vi.fn(), onDelete: vi.fn() })

it('keeps folders in alphabetical rows with counts and hides destructive tools until managing', () => {
  const callbacks = props()
  render(<NotesFolders {...callbacks}/> )
  const rows = document.querySelectorAll('.notes-folder-item')
  expect([...rows].map(row => row.textContent)).toEqual(['Advance 0', 'Personal 1', 'testing 0'])
  expect(screen.getByRole('button', { name: 'Personal 1' })).toHaveAttribute('aria-current', 'page')
  expect(screen.queryByRole('button', { name: 'Delete Personal' })).not.toBeInTheDocument()
  fireEvent.click(screen.getByRole('button', { name: 'Manage folders' }))
  fireEvent.click(within(rows[1]).getByRole('button', { name: 'Rename Personal' }))
  expect(callbacks.onRename).toHaveBeenCalledWith(folders[1])
  fireEvent.click(within(rows[1]).getByRole('button', { name: 'Delete Personal' }))
  expect(callbacks.onDelete).toHaveBeenCalledWith(folders[1])
  fireEvent.click(screen.getByRole('button', { name: 'Advance 0' }))
  expect(callbacks.onSelect).toHaveBeenCalledWith('1')
})

it('does not expose management tools to a read-only Space member', () => {
  render(<NotesFolders {...props()} canManage={false}/> )
  expect(screen.getByRole('button', { name: 'New folder' })).toBeDisabled()
  expect(screen.queryByRole('button', { name: 'Manage folders' })).not.toBeInTheDocument()
  expect(screen.getByRole('button', { name: 'Shared notes 1' })).toBeInTheDocument()
})

it('counts Space notes for members even when they are not the owner', () => {
  render(<NotesFolders {...props()} notes={[{ is_owner: false, folder_id: 2, pinned: true }]} inSpace/> )
  expect(screen.getByRole('button', { name: 'All notes 1' })).toBeInTheDocument()
  expect(screen.getByRole('button', { name: 'Personal 1' })).toBeInTheDocument()
  expect(screen.queryByRole('button', { name: /Shared notes/ })).not.toBeInTheDocument()
})
