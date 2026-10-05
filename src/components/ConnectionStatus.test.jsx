import { act, cleanup, render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, expect, test, vi } from 'vitest'
import ConnectionStatus from './ConnectionStatus'
const state=vi.hoisted(()=>({rows:[]}))
vi.mock('../App',()=>({useApp:()=>({user:{id:1}})}))
vi.mock('../lib/offlineSync',()=>({listOfflineQueue:async()=>state.rows}))
afterEach(()=>{cleanup();state.rows=[]})
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

test('completed sync announces success only when the queue is empty',async()=>{
  state.rows=[{status:'pending',path:'/api/transactions'}]
  render(<MemoryRouter><ConnectionStatus/></MemoryRouter>)
  await screen.findByRole('status')
  act(()=>window.dispatchEvent(new CustomEvent('budgetly:sync-state',{detail:{userId:'1',syncing:true}})))
  await act(async()=>window.dispatchEvent(new CustomEvent('budgetly:sync-state',{detail:{userId:'1',syncing:false}})))
  expect(screen.queryByText('All entries synced')).toBeNull()
  act(()=>window.dispatchEvent(new CustomEvent('budgetly:sync-state',{detail:{userId:'1',syncing:true}})))
  state.rows=[]
  await act(async()=>{window.dispatchEvent(new Event('budgetly:offline-queue-changed'));window.dispatchEvent(new CustomEvent('budgetly:sync-state',{detail:{userId:'1',syncing:false}}))})
  expect(screen.getByRole('status')).toHaveTextContent('All entries synced')
})
