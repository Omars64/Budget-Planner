import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, beforeEach, expect, test, vi } from 'vitest'
import ConnectionStatus from './ConnectionStatus'
const state=vi.hoisted(()=>({rows:[], userId:1, read:vi.fn(), flush:vi.fn()}))
vi.mock('../App',()=>({useApp:()=>({user:{id:state.userId}})}))
vi.mock('../lib/offlineSync',()=>({listOfflineQueue:(...args)=>state.read(...args)}))
vi.mock('../lib/api',()=>({flushOfflineTransactions:()=>state.flush()}))
beforeEach(()=>{state.read.mockImplementation(async()=>state.rows);state.flush.mockResolvedValue()})
afterEach(()=>{cleanup();state.rows=[];state.userId=1;vi.resetAllMocks();vi.unstubAllGlobals()})
test('failed shared writes are clearly reviewable instead of silently marked saved', async()=>{
  state.rows=[{status:'failed',path:'/api/shared/transactions'}]
  render(<MemoryRouter><ConnectionStatus/></MemoryRouter>)
  expect(await screen.findByRole('link',{name:'Review saved entries'})).toHaveAttribute('href','/shared-transactions')
  expect(screen.getByRole('status')).toHaveTextContent('1 need review')
  act(()=>window.dispatchEvent(new CustomEvent('budgetly:sync-state',{detail:{userId:'1',syncing:true}})))
  expect(screen.getByRole('status')).toHaveTextContent('Syncing saved entries')
  state.rows=[]
  await act(async()=>window.dispatchEvent(new Event('budgetly:offline-queue-changed')))
  expect(screen.queryByRole('status')).toBeNull()
})

test('a failed queue read stays visible and can be checked without sending writes', async()=>{
  state.read.mockRejectedValueOnce(new Error('Storage unavailable'))
  render(<MemoryRouter><ConnectionStatus/></MemoryRouter>)
  expect(await screen.findByRole('alert')).toHaveTextContent('does not confirm that it is empty')
  fireEvent.click(screen.getByRole('button',{name:'Retry queue check'}))
  await waitFor(()=>expect(screen.queryByRole('status')).toBeNull())
  expect(state.flush).not.toHaveBeenCalled()
})

test('a retry keeps preserved entries visible until confirmation and completion stays silent', async()=>{
  state.rows=[{status:'pending',path:'/api/transactions'}]
  let complete
  state.flush.mockImplementationOnce(()=>new Promise(resolve=>{complete=resolve}))
  render(<MemoryRouter><ConnectionStatus/></MemoryRouter>)
  const retry=await screen.findByRole('button',{name:'Retry sync'})
  expect(screen.getByRole('status')).toHaveTextContent('Server save not yet confirmed')
  expect(screen.getByRole('status')).toHaveTextContent('saved on this device')
  fireEvent.click(retry)
  expect(screen.getByRole('button',{name:'Retrying…'})).toBeDisabled()
  await act(async()=>complete())
  expect(await screen.findByRole('alert')).toHaveTextContent('queued entries are still on this device')
  state.rows=[]
  await act(async()=>window.dispatchEvent(new Event('budgetly:offline-queue-changed')))
  expect(screen.queryByRole('status')).toBeNull()
  expect(screen.queryByRole('alert')).toBeNull()
})

test('offline feedback does not promise that unverified device storage will save new entries', async()=>{
  vi.stubGlobal('navigator',{onLine:false})
  render(<MemoryRouter><ConnectionStatus/></MemoryRouter>)
  await act(async()=>{})
  expect(screen.getByRole('status')).toHaveTextContent('Check each save result before closing the form')
  expect(screen.queryByText(/New entries will be saved/)).toBeNull()
})

test('a stale queue read cannot resurrect entries removed by a newer read', async()=>{
  let resolveOld
  state.read.mockImplementationOnce(()=>new Promise(resolve=>{resolveOld=resolve}))
  render(<MemoryRouter><ConnectionStatus/></MemoryRouter>)
  await act(async()=>window.dispatchEvent(new Event('budgetly:offline-queue-changed')))
  await act(async()=>resolveOld([{status:'pending',path:'/api/transactions'}]))
  expect(screen.queryByRole('status')).toBeNull()
})

test('an account switch ignores the previous account’s retry result', async()=>{
  state.rows=[{status:'pending',path:'/api/transactions'}]
  let complete
  state.flush.mockImplementationOnce(()=>new Promise(resolve=>{complete=resolve}))
  const {rerender}=render(<MemoryRouter><ConnectionStatus/></MemoryRouter>)
  fireEvent.click(await screen.findByRole('button',{name:'Retry sync'}))
  state.userId=2
  state.rows=[]
  rerender(<MemoryRouter><ConnectionStatus/></MemoryRouter>)
  await act(async()=>complete())
  expect(screen.queryByRole('status')).toBeNull()
  expect(screen.queryByRole('alert')).toBeNull()
})

test('a thrown retry error remains actionable without claiming the queue is empty', async()=>{
  state.rows=[{status:'pending',path:'/api/transactions'}]
  state.flush.mockRejectedValueOnce(new Error('Storage failed'))
  render(<MemoryRouter><ConnectionStatus/></MemoryRouter>)
  fireEvent.click(await screen.findByRole('button',{name:'Retry sync'}))
  expect(await screen.findByRole('button',{name:'Retry queue check'})).toBeEnabled()
  expect(screen.getByRole('status')).toHaveTextContent('saved on this device')
  expect(screen.getAllByRole('alert').map(item=>item.textContent).join(' ')).toContain('does not confirm that it is empty')
})

test('completed sync stays silent while pending and failed entries remain visible',async()=>{
  state.rows=[{status:'pending',path:'/api/transactions'}]
  render(<MemoryRouter><ConnectionStatus/></MemoryRouter>)
  await screen.findByRole('status')
  act(()=>window.dispatchEvent(new CustomEvent('budgetly:sync-state',{detail:{userId:'1',syncing:true}})))
  await act(async()=>window.dispatchEvent(new CustomEvent('budgetly:sync-state',{detail:{userId:'1',syncing:false}})))
  expect(screen.queryByText('All entries synced')).toBeNull()
  act(()=>window.dispatchEvent(new CustomEvent('budgetly:sync-state',{detail:{userId:'1',syncing:true}})))
  state.rows=[]
  await act(async()=>{window.dispatchEvent(new Event('budgetly:offline-queue-changed'));window.dispatchEvent(new CustomEvent('budgetly:sync-state',{detail:{userId:'1',syncing:false}}))})
  expect(screen.queryByRole('status')).toBeNull()
})
