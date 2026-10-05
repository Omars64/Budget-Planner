import { beforeEach, expect, test, vi } from 'vitest'
import { syncUpdatePush } from './updatePush'
import { PushNotifications } from '@capacitor/push-notifications'
import { AppUpdater } from './appUpdates'
import { api } from './api'

const state=vi.hoisted(()=>({token:'',native:true}))
vi.mock('./api',()=>({api:vi.fn(),auth:{get token(){return state.token}},jsonBody:value=>({body:JSON.stringify(value)}),publicApiUrl:path=>path}))
vi.mock('./appUpdates',()=>({androidUpdatesAvailable:()=>state.native,AppUpdater:{setPushAlerts:vi.fn(),info:vi.fn()}}))
vi.mock('@capacitor/push-notifications',()=>({PushNotifications:{unregister:vi.fn(),checkPermissions:vi.fn(),register:vi.fn(),createChannel:vi.fn()}}))
beforeEach(()=>{vi.clearAllMocks();localStorage.clear();state.token='';state.native=true;AppUpdater.setPushAlerts.mockResolvedValue();AppUpdater.info.mockResolvedValue({pushConfigured:false});PushNotifications.unregister.mockResolvedValue();api.mockResolvedValue({id:42})})
test('guest does not create a remote push subscription',async()=>{
  expect(await syncUpdatePush(true)).toEqual({enabled:false})
  expect(api).not.toHaveBeenCalled();expect(PushNotifications.register).not.toHaveBeenCalled()
})
test('turning off updates sets native suppression before unregistering',async()=>{
  await syncUpdatePush(false)
  expect(AppUpdater.setPushAlerts).toHaveBeenCalledWith({enabled:false})
  expect(PushNotifications.unregister).toHaveBeenCalledOnce()
  expect(api).not.toHaveBeenCalled()
})
test('missing Android Firebase configuration never invokes native registration',async()=>{
  state.token='signed-in'
  vi.spyOn(globalThis,'fetch').mockResolvedValue({ok:true,json:async()=>({android:true})})
  expect(await syncUpdatePush(true)).toEqual({configured:false})
  expect(PushNotifications.register).not.toHaveBeenCalled()
  vi.restoreAllMocks()
})
