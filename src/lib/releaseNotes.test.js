import { expect, test } from 'vitest'
import { hasSeenRelease, markReleaseSeen, releaseNotes, validateReleaseNotes } from './releaseNotes'

test('validates bounded plain-text release notes', () => {
  expect(validateReleaseNotes([{ title:'Fix', detail:'A change', extra:'ignored' }, {title:'Bad'}])).toEqual([{title:'Fix',detail:'A change'}])
  expect(validateReleaseNotes(Array(13).fill({title:'a',detail:'b'}))).toEqual([])
  expect(validateReleaseNotes([{title:'a',detail:'x'.repeat(351)}])).toEqual([])
  expect(releaseNotes('0.0.0')).toEqual([])
})
test('acknowledgement is per user and per installed version', () => {
  localStorage.clear()
  expect(hasSeenRelease(1,'5.12.5')).toBe(false)
  markReleaseSeen(1,'5.12.5')
  expect(hasSeenRelease(1,'5.12.5')).toBe(true)
  expect(hasSeenRelease(2,'5.12.5')).toBe(false)
  expect(hasSeenRelease(1,'5.12.6')).toBe(false)
})

test('users see only shared changes; admins see the complete validated release', () => {
  const items = [{title:'Fix',detail:'For everyone'}, {title:'Operations',detail:'Admin details',audience:'admin'}]
  expect(releaseNotes('99.0.0', items)).toEqual([items[0]])
  expect(releaseNotes('99.0.0', items, 'admin')).toEqual(items)
  expect(releaseNotes('99.0.0', items, 'owner')).toEqual([items[0]])
  expect(releaseNotes('99.0.0', [items[1]])[0].title).toBe('Reliability improvements')
  expect(validateReleaseNotes([{title:'Wrong',detail:'Unknown audience',audience:'other'}])).toEqual([])
})
