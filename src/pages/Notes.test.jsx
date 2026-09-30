import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import Notes from './Notes'
import { api } from '../lib/api'

vi.mock('../App', () => ({ useApp: () => ({ user: { id: 901 }, notify: vi.fn(), confirm: vi.fn(async () => true) }) }))
vi.mock('../lib/api', () => ({ api: vi.fn(), jsonBody: value => ({ body: JSON.stringify(value) }) }))
let note
beforeEach(() => {
  note = { id: 1, title: 'Plan', content: 'Original content', is_owner: true, can_edit: true, version: 1, note_type: 'text', page_style: 'plain', shares: [] }
  sessionStorage.clear()
  api.mockImplementation((path, options) => {
    if (path === '/api/note-folders') return Promise.resolve([{ id: 2, name: 'Personal' }])
    if (options?.method === 'PUT') { note = { ...note, ...JSON.parse(options.body), version: note.version + 1 }; return Promise.resolve(note) }
    return Promise.resolve(path === '/api/notes' ? [note] : note)
  })
})
afterEach(() => { cleanup(); vi.clearAllMocks() })

it('keeps secondary controls collapsed, exposes accessible icon tools and autosaves settings with content', async () => {
  render(<Notes/> )
  fireEvent.click(await screen.findByText('Plan'))
  await screen.findByDisplayValue('Original content')
  expect(screen.queryByLabelText('Note folder')).not.toBeInTheDocument()
  expect(screen.getByRole('button', { name: 'Text note' })).toHaveAttribute('aria-pressed', 'true')
  fireEvent.click(screen.getByRole('button', { name: 'Folder and paper settings' }))
  fireEvent.change(screen.getByLabelText('Note folder'), { target: { value: '2' } })
  fireEvent.change(screen.getByLabelText('Paper style'), { target: { value: 'lined' } })
  fireEvent.change(screen.getByLabelText('Note content'), { target: { value: 'Updated content' } })
  await waitFor(() => expect(note).toMatchObject({ content: 'Updated content', folder_id: 2, page_style: 'lined' }), { timeout: 4000 })
  fireEvent.keyDown(window, { key: 'Escape' })
  expect(screen.queryByLabelText('Note folder')).not.toBeInTheDocument()
  fireEvent.click(screen.getByRole('button', { name: 'Back to notes' }))
  await screen.findByRole('button', { name: 'List view' })
  fireEvent.click(screen.getByRole('button', { name: 'List view' }))
  expect(screen.getByRole('button', { name: 'Grid view' })).toBeInTheDocument()
})
