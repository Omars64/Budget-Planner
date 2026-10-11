import { expect, test } from 'vitest'
import { backupPreview } from './backupPreview'
const core = {version:1,settings:{},wallets:[],categories:[],transactions:[],budgets:[],goals:[],debts:[]}

test('summarizes supported backups without changing records', () => {
  const data = {...core,wallets:[{id:1}],transactions:[{id:2}]}
  const original = JSON.stringify(data)
  expect(backupPreview(data).find(row => row.key === 'wallets').count).toBe(1)
  expect(backupPreview(data).find(row => row.key === 'notes').count).toBe(0)
  expect(JSON.stringify(data)).toBe(original)
})
test('rejects unsupported versions and malformed collections', () => {
  for (const data of [null, [], {version:2}, {version:1,wallets:{}}, {version:1,notes:null}, {version:1,notes:[null]}]) {
    expect(() => backupPreview(data)).toThrow()
  }
})

test('rejects malformed Space memberships before previewing access', () => {
  expect(() => backupPreview({...core,spaces:[{name:'Home',members:'invalid'}]})).toThrow()
  expect(() => backupPreview({...core,spaces:[{name:'Home',members:[null]}]})).toThrow()
  expect(backupPreview({...core,spaces:[{name:'Home',members:[]}]}).find(row => row.key==='spaces').count).toBe(1)
})
