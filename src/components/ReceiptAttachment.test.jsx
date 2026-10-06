import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, expect, test, vi } from 'vitest'
import ReceiptAttachment from './ReceiptAttachment'
import { api } from '../lib/api'
import { receiptImage } from '../lib/receiptImage'
vi.mock('../App',()=>({useApp:()=>({isGuest:false,confirm:async()=>true})}))
vi.mock('../lib/api',()=>({api:vi.fn(),jsonBody:value=>({body:JSON.stringify(value)})}))
vi.mock('../lib/receiptImage',()=>({receiptImage:vi.fn()}))
afterEach(cleanup)
beforeEach(()=>{vi.clearAllMocks();api.mockResolvedValue(null);receiptImage.mockResolvedValue({name:'receipt.jpg',image:'data:image/jpeg;base64,AA=='})})
test('keeps receipt requests hidden until expanded and requires an explicit save',async()=>{
  const dirty=vi.fn()
  const {container}=render(<ReceiptAttachment transactionId={12} onDirty={dirty}/>)
  expect(api).not.toHaveBeenCalled()
  const details=container.querySelector('details');details.open=true;fireEvent(details,new Event('toggle'))
  await waitFor(()=>expect(api).toHaveBeenCalledWith('/api/transactions/12/receipt',expect.anything()))
  await waitFor(()=>expect(screen.getByRole('button',{name:'Choose photo'})).toBeEnabled())
  fireEvent.change(container.querySelectorAll('input[type=file]')[1],{target:{files:[new globalThis.File(['photo'],'receipt.jpg',{type:'image/jpeg'})]}})
  await screen.findByRole('button',{name:'Save receipt'})
  expect(api).toHaveBeenCalledTimes(1)
  expect(dirty).toHaveBeenCalledWith(true)
  api.mockResolvedValue({name:'receipt.jpg',image:'data:image/jpeg;base64,AA=='})
  fireEvent.click(screen.getByRole('button',{name:'Save receipt'}))
  await screen.findByText('Receipt saved.')
  expect(api).toHaveBeenLastCalledWith('/api/transactions/12/receipt',expect.objectContaining({method:'PUT'}))
  expect(dirty).toHaveBeenLastCalledWith(false)
})
test('keeps an unsaved photo available after a failed upload',async()=>{
  const {container}=render(<ReceiptAttachment transactionId={12}/>)
  const details=container.querySelector('details');details.open=true;fireEvent(details,new Event('toggle'))
  await waitFor(()=>expect(screen.getByRole('button',{name:'Choose photo'})).toBeEnabled())
  fireEvent.change(container.querySelector('input'),{target:{files:[new globalThis.File(['photo'],'receipt.jpg',{type:'image/jpeg'})]}})
  await screen.findByRole('button',{name:'Save receipt'})
  api.mockRejectedValue(new Error('Offline'))
  fireEvent.click(screen.getByRole('button',{name:'Save receipt'}))
  await screen.findByRole('alert')
  expect(screen.getByRole('img')).toBeVisible()
  expect(screen.getByRole('button',{name:'Save receipt'})).toBeEnabled()
})
