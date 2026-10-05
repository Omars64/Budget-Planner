import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { openGoogleFlow } from './googleFlow'
import { api } from './api'
import { Capacitor } from '@capacitor/core'

vi.mock('./api',()=>({api:vi.fn(),jsonBody:value=>({body:JSON.stringify(value)})}))
vi.mock('@capacitor/core',()=>({Capacitor:{isNativePlatform:vi.fn(()=>true)},registerPlugin:()=>({open:vi.fn().mockResolvedValue({})})}))
const flow={authorization_url:'https://accounts.google.com/o/oauth2/v2/auth'}
const options={pollPath:'/api/auth/google/poll',pollBody:{poll_secret:'secret'}}
beforeEach(()=>Capacitor.isNativePlatform.mockReturnValue(true))
afterEach(()=>{vi.useRealTimers();vi.restoreAllMocks();vi.clearAllMocks()})

it('resumes Android polling after a transient browser-switch network failure',async()=>{
  vi.useFakeTimers()
  api.mockRejectedValueOnce(Object.assign(new Error('network'),{network:true}))
    .mockResolvedValueOnce({status:'name_required'})
  const result=openGoogleFlow(flow,options)
  await vi.advanceTimersByTimeAsync(1800)
  expect(await result).toEqual({status:'name_required'})
  expect(api).toHaveBeenCalledTimes(2)
})

it('does not consume a native login while the app is backgrounded',async()=>{
  vi.useFakeTimers()
  const visibility=vi.spyOn(document,'visibilityState','get').mockReturnValue('hidden')
  api.mockResolvedValue({status:'complete',token:'token'})
  const result=openGoogleFlow(flow,options)
  await vi.advanceTimersByTimeAsync(1800)
  expect(api).not.toHaveBeenCalled()
  visibility.mockReturnValue('visible')
  await vi.advanceTimersByTimeAsync(1800)
  expect(await result).toEqual({status:'complete',token:'token'})
})

it('does not retry an authorization error',async()=>{
  api.mockRejectedValue(Object.assign(new Error('expired'),{status:400}))
  await expect(openGoogleFlow(flow,options)).rejects.toThrow('expired')
  expect(api).toHaveBeenCalledTimes(1)
})

it('can cancel while waiting for the Android app to resume',async()=>{
  vi.useFakeTimers()
  vi.spyOn(document,'visibilityState','get').mockReturnValue('hidden')
  const controller=new AbortController()
  const result=openGoogleFlow(flow,{...options,signal:controller.signal})
  const rejected=expect(result).rejects.toMatchObject({name:'AbortError'})
  await vi.advanceTimersByTimeAsync(0)
  controller.abort()
  await rejected
  expect(api).not.toHaveBeenCalled()
})

it('preserves web popup handling',async()=>{
  Capacitor.isNativePlatform.mockReturnValueOnce(false).mockReturnValue(false)
  const popup={closed:false,location:{replace:vi.fn()},close:vi.fn()}
  api.mockResolvedValue({status:'name_required'})
  expect(await openGoogleFlow(flow,{...options,popup})).toEqual({status:'name_required'})
  expect(popup.close).toHaveBeenCalled()
})
