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
