import { afterEach, beforeEach, expect, test, vi } from 'vitest'
import { saveNotificationSettings } from './notificationSettings'
import { upcomingPushActive } from './upcomingDelivery'
import { syncUpdatePush } from './updatePush'
import { PushNotifications } from '@capacitor/push-notifications'
import { AppUpdater } from './appUpdates'
import { api } from './api'

const state=vi.hoisted(()=>({token:'',native:true}))
vi.mock('./api',()=>({api:vi.fn(),auth:{get token(){return state.token}},jsonBody:value=>({body:JSON.stringify(value)}),publicApiUrl:path=>path}))
vi.mock('./appUpdates',()=>({androidUpdatesAvailable:()=>state.native,AppUpdater:{setPushAlerts:vi.fn(),info:vi.fn()}}))
vi.mock('@capacitor/push-notifications',()=>({PushNotifications:{unregister:vi.fn(),checkPermissions:vi.fn(),register:vi.fn(),createChannel:vi.fn()}}))
beforeEach(()=>{vi.clearAllMocks();localStorage.clear();state.token='';state.native=true;AppUpdater.setPushAlerts.mockResolvedValue();AppUpdater.info.mockResolvedValue({pushConfigured:false});PushNotifications.unregister.mockResolvedValue();api.mockResolvedValue({id:42})})
afterEach(()=>{vi.unstubAllGlobals();vi.restoreAllMocks();sessionStorage.clear()})

test('upcoming Web Push stays registered when update and recorded-entry alerts are off', async () => {
  state.token='signed-in';state.native=false
  saveNotificationSettings({update_notifications_enabled:false,scheduled_notifications_enabled:false,upcoming_reminders_enabled:true,upcoming_reminder_mode:'before',upcoming_reminder_minutes:90},42)
  vi.stubGlobal('Notification',{permission:'granted'})
  vi.stubGlobal('PushManager',class {})
  const subscription={toJSON:()=>({endpoint:'https://fcm.googleapis.com/test'})}
  class Channel {
    constructor() { this.port1={close:vi.fn()}; this.port2={deliver:()=>this.port1.onmessage({data:{saved:true,upcoming:true}})} }
  }
  vi.stubGlobal('MessageChannel',Channel)
  const registration={active:{postMessage:(message,ports)=>ports[0].deliver()},pushManager:{getSubscription:vi.fn(async()=>subscription)}}
  vi.stubGlobal('navigator',{serviceWorker:{register:vi.fn(async()=>registration),ready:Promise.resolve(registration)}})
  vi.stubGlobal('fetch',vi.fn(async()=>({ok:true,json:async()=>({browser:true,public_key:'test'})})))
  api.mockImplementation(async(path,options)=>options?.method==='PUT' ? {enabled:true,upcoming:true} : {id:42})
  await syncUpdatePush(false)
  const [,options]=api.mock.calls.find(([path,options])=>path==='/api/app-updates/push-device'&&options?.method==='PUT')
  expect(JSON.parse(options.body)).toMatchObject({updates:false,scheduled:false,upcoming:{enabled:true,mode:'before',minutes:90}})
  expect(upcomingPushActive(42)).toBe(true)
})
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
