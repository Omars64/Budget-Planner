import { readFileSync } from 'node:fs'
import { runInNewContext } from 'node:vm'
import { resolve } from 'node:path'
import { expect, it, vi } from 'vitest'

function worker() {
  const listeners = {}, store = new Map()
  const registration = {getNotifications:vi.fn(async()=>[]),showNotification:vi.fn(),pushManager:{}}
  const self = {registration,addEventListener:(name,callback)=>{listeners[name]=callback},caches:{open:async()=>({put:async(key,value)=>store.set(key,value),match:async key=>store.get(key)})},clients:{matchAll:async()=>[],openWindow:vi.fn()},skipWaiting:vi.fn()}
  class Response { constructor(value) { this.value=value } async text() { return this.value } }
  runInNewContext(readFileSync(resolve('public/budgetly-push-sw.js'),'utf8'),{self,Response,URL})
  const emit = async (name, data) => { let task; listeners[name]({...data,waitUntil:value=>{task=value}}); await task }
  return {emit,registration,self}
}
it('shows the upcoming subject independently of update alerts and opens Upcoming', async () => {
  const {emit,registration,self} = worker()
  await emit('message',{data:{type:'budgetly-update-preference',enabled:false,scheduled:false,upcoming:true},ports:[]})
  await emit('push',{data:{json:()=>({kind:'upcoming',event:'a'.repeat(64),version:'6.3.0',body:'Rent - due tomorrow'})}})
  expect(registration.showNotification).toHaveBeenCalledWith('Upcoming expense',expect.objectContaining({body:'Rent - due tomorrow',data:{scheduled:true}}))
  await emit('notificationclick',{notification:{close:vi.fn(),data:{scheduled:true}}})
  expect(self.clients.openWindow).toHaveBeenCalledWith('/#/upcoming')
})
it('suppresses upcoming notifications after opt-out', async () => {
  const {emit,registration} = worker()
  await emit('message',{data:{type:'budgetly-update-preference',enabled:true,upcoming:false},ports:[]})
  await emit('push',{data:{json:()=>({kind:'upcoming',event:'b'.repeat(64),body:'Rent'})}})
  expect(registration.showNotification).not.toHaveBeenCalled()
})
