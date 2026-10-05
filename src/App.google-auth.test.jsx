import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, expect, test, vi } from 'vitest'
import { LoginScreen } from './App'
import { api } from './lib/api'
import { openGoogleFlow, reserveGoogleWindow } from './lib/googleFlow'

vi.mock('./lib/api',async importOriginal=>({...await importOriginal(),api:vi.fn()}))
vi.mock('./lib/googleFlow',()=>({openGoogleFlow:vi.fn(),reserveGoogleWindow:vi.fn()}))
afterEach(cleanup)
beforeEach(()=>{
  vi.clearAllMocks()
  reserveGoogleWindow.mockReturnValue({close:vi.fn()})
  api.mockImplementation(path=>Promise.resolve(path.endsWith('/config')?{enabled:true}:{poll_secret:'secret',authorization_url:'https://accounts.google.com/o/oauth2/v2/auth'}))
})

test.each(['login','signup'])('%s hides alternatives throughout Google signup and restores them on cancel',async mode=>{
  openGoogleFlow.mockResolvedValue({status:'name_required'})
  render(<LoginScreen onLogin={vi.fn()}/>)
  if(mode==='signup')fireEvent.click(screen.getByRole('button',{name:'Create an account'}))
  fireEvent.change(screen.getByLabelText('Email'),{target:{value:'draft@example.com'}})
  fireEvent.click(await screen.findByRole('button',{name:'Continue with Google'}))
  await screen.findByLabelText('Your name in Budgetly')
  expect(screen.queryByLabelText('Email')).not.toBeInTheDocument()
  expect(screen.queryByLabelText('Password')).not.toBeInTheDocument()
  expect(screen.queryByLabelText('Username')).not.toBeInTheDocument()
  expect(screen.queryByRole('button',{name:'Forgot password?'})).not.toBeInTheDocument()
  expect(screen.queryByRole('button',{name:'Biometric / passkey'})).not.toBeInTheDocument()
  expect(screen.queryByRole('button',{name:'Continue to email verification'})).not.toBeInTheDocument()
  expect(screen.queryByText('Already have an account?')).not.toBeInTheDocument()
  fireEvent.click(screen.getByRole('button',{name:'Cancel',exact:true}))
  expect(await screen.findByLabelText('Email')).toHaveValue('draft@example.com')
  expect(screen.getByLabelText('Password')).toBeInTheDocument()
})

test('Google errors keep alternatives hidden until explicit cancellation',async()=>{
  openGoogleFlow.mockRejectedValue(new Error('Try Google again'))
  render(<LoginScreen onLogin={vi.fn()}/>)
  fireEvent.click(await screen.findByRole('button',{name:'Continue with Google'}))
  expect(await screen.findByRole('alert')).toHaveTextContent('Try Google again')
  expect(screen.queryByLabelText('Email')).not.toBeInTheDocument()
  fireEvent.click(screen.getByRole('button',{name:'Cancel Google sign-in'}))
  await screen.findByLabelText('Email')
})

test('email controls are hidden while waiting in the Google browser',async()=>{
  let resolve
  openGoogleFlow.mockReturnValue(new Promise(done=>{resolve=done}))
  render(<LoginScreen onLogin={vi.fn()}/>)
  fireEvent.click(await screen.findByRole('button',{name:'Continue with Google'}))
  await waitFor(()=>expect(openGoogleFlow).toHaveBeenCalled())
  expect(screen.queryByLabelText('Email')).not.toBeInTheDocument()
  expect(screen.getByRole('button',{name:'Cancel Google sign-in'})).toBeInTheDocument()
  fireEvent.click(screen.getByRole('button',{name:'Cancel Google sign-in'}))
  resolve({status:'name_required'})
  await screen.findByLabelText('Email')
  expect(screen.queryByLabelText('Your name in Budgetly')).not.toBeInTheDocument()
})
