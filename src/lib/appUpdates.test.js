import { afterEach, expect, test, vi } from 'vitest'
import { fetchRelease, validateRelease, MANIFEST_URL } from './appUpdates'

const valid = { schema: 1, packageId: 'com.flowbudget.app', version: '5.8.0', versionCode: 43, size: 1024,
  sha256: 'a'.repeat(64), url: 'https://github.com/Omars64/Budget-Planner/releases/download/v5.8.0/Budgetly-5.8.0.apk' }
afterEach(() => vi.unstubAllGlobals())
test('accepts the official release and strips unrelated fields', () => {
  expect(validateRelease({ ...valid, token: 'not-used' })).toEqual(valid)
})
test.each([
  ['schema', 2], ['packageId', 'other.app'], ['versionCode', -1], ['version', 'next'], ['size', 268435457],
  ['sha256', 'bad'], ['url', 'https://evil.example/update.apk'], ['url', valid.url.replace('https:', 'http:')],
  ['url', valid.url.replace('Omars64', 'somebody')], ['url', `${valid.url}?token=secret`],
  ['url', valid.url.replace('github.com', 'github.com.evil.example')], ['url', valid.url.replace('.apk', '.aab')],
])('rejects invalid %s', (field, value) => expect(() => validateRelease({ ...valid, [field]: value })).toThrow())
test('no release is a normal first-publish state', async () => {
  const fetch = vi.fn().mockResolvedValue({status:404})
  vi.stubGlobal('fetch', fetch)
  expect(await fetchRelease()).toBeNull()
  expect(fetch).toHaveBeenCalledWith(MANIFEST_URL, expect.objectContaining({credentials:'omit',cache:'no-store'}))
})
test('rejects network errors and oversized metadata', async () => {
  vi.stubGlobal('fetch', vi.fn().mockResolvedValueOnce({status:500,ok:false}).mockResolvedValueOnce({ok:true,text:async()=> 'x'.repeat(16385)}))
  await expect(fetchRelease()).rejects.toThrow('Could not check')
  await expect(fetchRelease()).rejects.toThrow('too large')
})
