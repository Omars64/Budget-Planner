import { expect, test } from 'vitest'
import { backupPreview } from './backupPreview'

test('summarizes supported backups without changing records', () => {
  const data = {version:1,wallets:[{id:1}],transactions:[{id:2}]}
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
