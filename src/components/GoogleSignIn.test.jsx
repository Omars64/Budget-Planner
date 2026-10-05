import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import GoogleSignIn from './GoogleSignIn'
import { api } from '../lib/api'
import { openGoogleFlow, reserveGoogleWindow } from '../lib/googleFlow'
vi.mock('../lib/api',()=>({api:vi.fn(),jsonBody:data=>({body:JSON.stringify(data)})}))
vi.mock('../lib/googleFlow',()=>({openGoogleFlow:vi.fn(),reserveGoogleWindow:vi.fn()}))
afterEach(cleanup)
beforeEach(()=>{
  vi.clearAllMocks()
  reserveGoogleWindow.mockReturnValue({close:vi.fn()})
  api.mockImplementation(path=>Promise.resolve(path.endsWith('/config')?{enabled:true}:{authorization_url:'https://accounts.google.com/o/oauth2/v2/auth',poll_secret:'secret'}))
})
it('does not offer Google sign-in before configuration is ready',async()=>{
  api.mockResolvedValue({enabled:false});render(<GoogleSignIn onLogin={vi.fn()}/>)
  await waitFor(()=>expect(api).toHaveBeenCalled())
  expect(screen.queryByRole('button',{name:'Continue with Google'})).not.toBeInTheDocument()
})
it('asks for a preferred name before completing Google signup',async()=>{
  const login=vi.fn();openGoogleFlow.mockResolvedValue({status:'name_required'})
  render(<GoogleSignIn onLogin={login}/>)
  fireEvent.click(await screen.findByRole('button',{name:'Continue with Google'}))
  const input=await screen.findByLabelText('Your name in Budgetly')
  expect(screen.getByRole('status')).toHaveTextContent('tap Create Google account to finish')
  expect(login).not.toHaveBeenCalled()
  fireEvent.change(input,{target:{value:'Omar'}})
  api.mockImplementation(path=>Promise.resolve(path.endsWith('/complete-name')?{token:'token',user:{username:'Omar'}}:{}))
  fireEvent.click(screen.getByRole('button',{name:'Create Google account'}))
  await waitFor(()=>expect(login).toHaveBeenCalledWith({token:'token',user:{username:'Omar'}}))
  expect(api).toHaveBeenCalledWith('/api/auth/google/complete-name',expect.objectContaining({body:JSON.stringify({poll_secret:'secret',preferred_name:'Omar'})}))
})
it('never silently merges matching email accounts',async()=>{
  const login=vi.fn();openGoogleFlow.mockResolvedValue({status:'link_required'})
  render(<GoogleSignIn onLogin={login}/>)
  fireEvent.click(await screen.findByRole('button',{name:'Continue with Google'}))
  expect(await screen.findByRole('alert')).toHaveTextContent('Sign in with your existing method')
  expect(login).not.toHaveBeenCalled()
})
it('cancels pending signup on unmount without creating an account',async()=>{
  openGoogleFlow.mockResolvedValue({status:'name_required'})
  const {unmount}=render(<GoogleSignIn onLogin={vi.fn()}/>)
  fireEvent.click(await screen.findByRole('button',{name:'Continue with Google'}))
  await screen.findByLabelText('Your name in Budgetly');unmount()
  expect(api).toHaveBeenCalledWith('/api/auth/google/cancel',expect.objectContaining({method:'POST'}))
})
