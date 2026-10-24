import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import Notes from './Notes'
import { api } from '../lib/api'
import { updateResourcePolicy } from '../lib/resourcePolicy'

const state=vi.hoisted(()=>({notify:vi.fn(), activeSpace:null}))
vi.mock('../App', () => ({ useApp: () => ({ user: { id: 901 }, activeSpace: state.activeSpace, notify: state.notify, confirm: vi.fn(async () => true) }) }))
vi.mock('../lib/api', () => ({ api: vi.fn(), jsonBody: value => ({ body: JSON.stringify(value) }) }))
let note
beforeEach(() => {
  state.activeSpace = null
  note = { id: 1, title: 'Plan', content: 'Original content', is_owner: true, can_edit: true, version: 1, note_type: 'text', page_style: 'plain', shares: [] }
  sessionStorage.clear()
  localStorage.clear()
  api.mockImplementation((path, options) => {
    if (path === '/api/note-folders') return Promise.resolve([{ id: 2, name: 'Personal' }])
    if (options?.method === 'PUT') { note = { ...note, ...JSON.parse(options.body), version: note.version + 1 }; return Promise.resolve(note) }
    return Promise.resolve(path === '/api/notes' ? [note] : note)
  })
})
it('undoes a note move without discarding content edits', async () => {
  render(<Notes/>)
  fireEvent.click(await screen.findByText('Plan'))
  await screen.findByDisplayValue('Original content')
  fireEvent.click(screen.getByRole('button',{name:'Folder and paper settings'}))
  fireEvent.change(screen.getByLabelText('Note folder'),{target:{value:'2'}})
  const undo=state.notify.mock.calls.find(([message])=>message==='Note moved')[2]
  fireEvent.change(screen.getByLabelText('Note content'),{target:{value:'Keep this edit'}})
  await act(async()=>undo.run())
  expect(screen.getByLabelText('Note folder')).toHaveValue('')
  expect(screen.getByLabelText('Note content')).toHaveValue('Keep this edit')
})
afterEach(() => { cleanup(); vi.clearAllMocks(); vi.useRealTimers(); vi.restoreAllMocks(); updateResourcePolicy({client_poll_seconds:60}) })

it('protects edits made during a background read and keeps autosave immediate while hidden', async () => {
  vi.useFakeTimers()
  const visibility = vi.spyOn(document,'visibilityState','get').mockReturnValue('visible')
  render(<Notes/> )
  await act(async () => vi.advanceTimersByTimeAsync(0))
  fireEvent.click(screen.getByText('Plan'))
  await act(async () => vi.advanceTimersByTimeAsync(0))
  let finish
  api.mockImplementationOnce(() => new Promise(resolve => { finish = resolve }))
  await act(async () => vi.advanceTimersByTimeAsync(60000))
  const reads = () => api.mock.calls.filter(([path])=>path==='/api/notes').length
  expect(reads()).toBe(2)
  fireEvent.change(screen.getByLabelText('Note content'),{target:{value:'Keep my draft'}})
  await act(async () => vi.advanceTimersByTimeAsync(0))
  expect(reads()).toBe(2)
  await act(async () => finish([{...note,content:'Remote edit'}]))
  expect(screen.getByLabelText('Note content')).toHaveValue('Keep my draft')
  visibility.mockReturnValue('hidden'); document.dispatchEvent(new Event('visibilitychange'))
  await act(async () => vi.advanceTimersByTimeAsync(1200))
  expect(api).toHaveBeenCalledWith('/api/notes/1',expect.objectContaining({method:'PUT'}))
  expect(note.content).toBe('Keep my draft')
})

it('opens a folder drawer, selects a folder and closes without changing saved notes', async () => {
  render(<Notes/> )
  await screen.findByText('Plan')
  fireEvent.click(screen.getByRole('button', { name: 'Folders', exact: true }))
  const drawer = await screen.findByRole('dialog', { name: 'Folders' })
  fireEvent.click(within(drawer).getByRole('button', { name: 'Personal 0' }))
  await waitFor(() => expect(screen.getByRole('button', { name: 'Folders', exact: true })).toHaveAttribute('aria-expanded', 'false'))
  expect(screen.getByRole('heading', { name: 'Personal 0' })).toBeInTheDocument()
  expect(screen.getByText('No notes here yet')).toBeInTheDocument()
  expect(api.mock.calls.some(([, options]) => options?.method)).toBe(false)
})

it('distinguishes no search results and clears the query without losing the folder', async () => {
  render(<Notes/> )
  await screen.findByText('Plan')
  fireEvent.change(screen.getByRole('textbox', { name: 'Search notes' }), { target: { value: 'no match here' } })
  expect(screen.getByText('No matching notes')).toBeInTheDocument()
  fireEvent.click(screen.getAllByRole('button', { name: 'Clear search' })[0])
  expect(screen.getByText('Plan')).toBeInTheDocument()
})

it('shows scoped Space notes to a member without treating ownership as visibility', async () => {
  state.activeSpace = { id: 77 }
  note = { ...note, is_owner: false, folder_id: 2 }
  render(<Notes/> )
  await screen.findByText('Plan')
  expect(screen.getByRole('heading', { name: 'All notes 1' })).toBeInTheDocument()
  expect(screen.queryByRole('button', { name: /Shared notes/ })).not.toBeInTheDocument()
})

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
