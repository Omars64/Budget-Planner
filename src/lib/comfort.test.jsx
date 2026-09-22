import { act, cleanup, render, renderHook, screen } from '@testing-library/react'
import { afterEach, beforeEach, expect, test, vi } from 'vitest'
import { MotionConfigContext } from 'framer-motion'
import { useContext } from 'react'
import { balanceAfter } from '../components/BalancePreview'
import { useViewState } from './viewState'
import { effectiveMotion, saveComfort } from './comfort'
import MotionPreferences from '../components/MotionPreferences'
import { ledgerQuery } from './useLedger'

beforeEach(() => { sessionStorage.clear(); localStorage.clear(); vi.stubGlobal('matchMedia',()=>({matches:false,addEventListener:vi.fn(),removeEventListener:vi.fn()})) })
afterEach(() => { cleanup(); vi.unstubAllGlobals() })
test('edit previews undo the old effect and apply the new effect to the correct wallet', () => {
  const old = {type:'expense',amount:10,wallet_id:1}
  expect(balanceAfter(90,1,{...old,amount:15},old)).toBe(85)
  expect(balanceAfter(200,2,{...old,wallet_id:2,amount:15},old)).toBe(185)
  expect(balanceAfter(110,1,{type:'income',amount:20,wallet_id:1},{type:'transfer',amount:10,wallet_id:2,transfer_wallet_id:1})).toBe(120)
})
test('view preferences survive remount and remain isolated per account', () => {
  const first = renderHook(()=>useViewState('personal:1:filters',{wallet:''}))
  act(()=>first.result.current[1]({wallet:'12'})); first.unmount()
  const restored = renderHook(()=>useViewState('personal:1:filters',{wallet:''}))
  expect(restored.result.current[0].wallet).toBe('12')
  const other = renderHook(()=>useViewState('personal:2:filters',{wallet:''}))
  expect(other.result.current[0].wallet).toBe('')
})
test('motion off disables JS animations as well as setting the CSS preference', () => {
  function Value() { const context = useContext(MotionConfigContext); return <p>{String(context.skipAnimations)}</p> }
  render(<MotionPreferences><Value/></MotionPreferences>)
  act(()=>saveComfort({motion:'off',haptics:false}))
  expect(screen.getByText('true')).toBeInTheDocument()
  expect(document.documentElement.dataset.motion).toBe('off')
  expect(effectiveMotion()).toBe('off')
})
test('drill-down filters preserve category zero, period boundaries and opening exclusions', () => {
  const query = new URLSearchParams(ledgerQuery({search:'',type:'expense',sort:'newest',category:'0',date_from:'2026-09-01T00:00:00',date_to:'2026-09-07T23:59:59',exclude_opening:true}))
  expect(query.get('category_id')).toBe('0')
  expect(query.get('exclude_opening')).toBe('true')
  expect(query.get('date_to')).toBe('2026-09-07T23:59:59')
})
