import { beforeEach, expect, test, vi } from 'vitest'
import { LocalNotifications } from '@capacitor/local-notifications'
import { cancelUpdateNotification, notifyAppUpdate } from './updateNotifications'
import { saveUpdateNotifications } from './notificationSettings'

const mock = vi.hoisted(()=>({native:true}))
vi.mock('./appUpdates',()=>({androidUpdatesAvailable:()=>mock.native}))
vi.mock('@capacitor/local-notifications',()=>({LocalNotifications:{checkPermissions:vi.fn(),createChannel:vi.fn(),schedule:vi.fn(),cancel:vi.fn()}}))
beforeEach(()=>{localStorage.clear();vi.clearAllMocks();mock.native=true;LocalNotifications.checkPermissions.mockResolvedValue({display:'granted'});LocalNotifications.schedule.mockResolvedValue();LocalNotifications.cancel.mockResolvedValue()})
test('notifies once per version and includes only update metadata',async()=>{
  const release={version:'99.0.0'}
  await notifyAppUpdate(release,vi.fn());await notifyAppUpdate(release,vi.fn())
  expect(LocalNotifications.schedule).toHaveBeenCalledTimes(1)
  expect(LocalNotifications.schedule.mock.calls[0][0].notifications[0]).toMatchObject({id:1500,title:'Budgetly 99.0.0 is available',extra:{budgetlyUpdate:true,version:'99.0.0'}})
})
test('opt out and blocked permission do not send or mark a release delivered',async()=>{
  saveUpdateNotifications(false);await notifyAppUpdate({version:'99.0.0'},vi.fn())
  expect(LocalNotifications.schedule).not.toHaveBeenCalled()
  saveUpdateNotifications(true);LocalNotifications.checkPermissions.mockResolvedValue({display:'denied'})
  await notifyAppUpdate({version:'99.0.0'},vi.fn());expect(LocalNotifications.schedule).not.toHaveBeenCalled()
})
test('cancels only the update notification, not financial reminders',async()=>{
  await cancelUpdateNotification();expect(LocalNotifications.cancel).toHaveBeenCalledWith({notifications:[{id:1500}]})
})
