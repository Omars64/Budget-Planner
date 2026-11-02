import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, expect, test, vi } from 'vitest'
import Feedback from './Feedback'
import { api } from '../lib/api'
import { updateResourcePolicy } from '../lib/resourcePolicy'

const context=vi.hoisted(()=>({user:{id:1,role:'user'},notify:vi.fn(),confirm:vi.fn()}))
vi.mock('../App', () => ({useApp:()=>context}))
vi.mock('../lib/api', () => ({api:vi.fn(),jsonBody:value=>({body:JSON.stringify(value)})}))
afterEach(() => { cleanup(); vi.useRealTimers(); vi.restoreAllMocks(); updateResourcePolicy({client_poll_seconds:60}) })
beforeEach(()=>{context.user.role='user';context.notify.mockReset();context.confirm.mockResolvedValue(true);api.mockReset()})

test('feedback follows policy updates, pauses hidden/offline, and cleans up on unmount', async () => {
  vi.useFakeTimers()
  const visibility = vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('visible')
  const connectivity = vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(true)
  api.mockResolvedValue([])
  const view = render(<Feedback/> )
  await act(async () => vi.advanceTimersByTimeAsync(0))
  expect(api).toHaveBeenCalledTimes(1)
  visibility.mockReturnValue('hidden')
  document.dispatchEvent(new Event('visibilitychange'))
  await act(async () => vi.advanceTimersByTimeAsync(120000))
  expect(api).toHaveBeenCalledTimes(1)
  connectivity.mockReturnValue(false); visibility.mockReturnValue('visible')
  document.dispatchEvent(new Event('visibilitychange'))
  await act(async () => vi.advanceTimersByTimeAsync(60000))
  expect(api).toHaveBeenCalledTimes(1)
  connectivity.mockReturnValue(true)
  window.dispatchEvent(new Event('online')); window.dispatchEvent(new Event('focus'))
  await act(async () => vi.advanceTimersByTimeAsync(0))
  expect(api).toHaveBeenCalledTimes(2)
  act(() => window.dispatchEvent(new CustomEvent('budgetly:resource-policy',{detail:{client_poll_seconds:15}})))
  await act(async () => vi.advanceTimersByTimeAsync(15000))
  expect(api).toHaveBeenCalledTimes(3)
  view.unmount()
  window.dispatchEvent(new Event('focus'))
  await act(async () => vi.advanceTimersByTimeAsync(60000))
  expect(api).toHaveBeenCalledTimes(3)
})

const feedback={id:1,subject:'Synthetic suggestion',content:'Test content',sender_name:'Synthetic user',sender_email:'test@example.test',status:'new',reply:'',revision:'original',reply_revision:'empty',created_at:'2026-11-02T08:00:00Z'}

test('admin status autosaves independently and reply posting appends a visible conversation', async()=>{
  context.user.role='admin'
  api.mockResolvedValueOnce([feedback]).mockResolvedValueOnce({...feedback,status:'reviewing',revision:'saved'}).mockResolvedValueOnce({...feedback,status:'reviewing',revision:'saved',comments:[{id:'posted',author_name:'Omar',is_admin:true,content:'Fixed for you.'}]})
  render(<Feedback/>)
  fireEvent.click(await screen.findByRole('button',{name:/Synthetic suggestion/}))
  fireEvent.change(screen.getByLabelText('Reply to user'),{target:{value:'Fixed for you.'}})
  fireEvent.change(screen.getByLabelText('Status',{exact:true}),{target:{value:'reviewing'}})
  await screen.findByText('Saved',{exact:true})
  expect(JSON.parse(api.mock.calls[1][1].body)).toEqual({status:'reviewing',revision:'original'})
  expect(screen.getByLabelText('Reply to user')).toHaveValue('Fixed for you.')
  fireEvent.click(screen.getByRole('button',{name:'Post reply'}))
  await waitFor(()=>expect(context.notify).toHaveBeenCalledWith('Reply posted'))
  expect(api.mock.calls[2][0]).toBe('/api/feedback/1/comments')
  expect(JSON.parse(api.mock.calls[2][1].body)).toEqual({content:'Fixed for you.',request_id:expect.any(String)})
  expect(screen.getByRole('region',{name:'Conversation'})).toHaveTextContent('Fixed for you.')
  expect(screen.getByLabelText('Reply to user')).toHaveValue('')
})

test('a recipient sees an unread reply and only acknowledges the exact displayed reply revision', async()=>{
  const answered={...feedback,reply:'Your answer.',reply_unread:true,reply_revision:'new-reply'}
  api.mockResolvedValueOnce([answered]).mockResolvedValueOnce({...answered,reply_unread:false})
  render(<Feedback/>)
  expect(await screen.findByText('New reply',{exact:true})).toBeInTheDocument()
  fireEvent.click(screen.getByRole('button',{name:/Synthetic suggestion/}))
  expect(screen.getByText('Your answer.',{exact:true})).toBeInTheDocument()
  await waitFor(()=>expect(screen.queryByText('New reply',{exact:true})).not.toBeInTheDocument())
  expect(api.mock.calls[1][0]).toBe('/api/feedback/1/read')
  expect(JSON.parse(api.mock.calls[1][1].body)).toEqual({reply_revision:'new-reply'})
})
