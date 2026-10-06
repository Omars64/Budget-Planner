import { beforeEach, expect, test } from 'vitest'
import { phraseSearch, savedSearches, saveSearch, removeSearch } from './phraseSearch'
beforeEach(()=>localStorage.clear())
test('resolves category and last month across a year boundary',()=>{
  expect(phraseSearch('Groceries last month',[{id:4,name:'Groceries',kind:'expense'}],'2026-01-02')).toMatchObject({category:'4',month:'2025-12',type:'expense',search:''})
  expect(phraseSearch('Coffee expenses this month',[],'2026-10-06')).toMatchObject({search:'Coffee',type:'expense',month:'2026-10'})
})
test('ambiguous categories stay text and saved searches stay account scoped',()=>{
  expect(phraseSearch('Food',[{id:1,name:'Food',kind:'expense'},{id:2,name:'Food',kind:'expense'}]).category).toBe('')
  saveSearch(1,'personal','Coffee',{search:'coffee'})
  expect(savedSearches(2,'personal')).toEqual([])
  expect(savedSearches(1,'shared')).toEqual([])
  expect(removeSearch(1,'personal','Coffee')).toEqual([])
})
