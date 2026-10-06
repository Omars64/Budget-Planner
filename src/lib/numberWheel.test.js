import {expect,test} from 'vitest'
import {installNumberWheelGuard} from './numberWheel'
import {installMoneyInputDefaults} from './moneyInputs'

test('wheel preserves the amount and allows normal page scrolling',()=>{
  document.body.innerHTML='<input type="number" step="0.001" value="12.345"><input type="text">'
  const stop=installNumberWheelGuard(document),input=document.querySelector('input')
  input.focus()
  const wheel=new window.WheelEvent('wheel',{bubbles:true,cancelable:true,deltaY:120})
  input.dispatchEvent(wheel)
  expect(input.value).toBe('12.345')
  expect(document.activeElement).not.toBe(input)
  expect(wheel.defaultPrevented).toBe(false)
  stop();document.body.innerHTML=''
})
test('money inputs adapt decimals without altering values or imposing currency rounding',()=>{
  document.body.innerHTML='<input type="number" step="0.001" placeholder="0.000" value="12.345">'
  let stop=installMoneyInputDefaults(document,'USD')
  expect(document.querySelector('input').placeholder).toBe('0.00')
  expect(document.querySelector('input').step).toBe('any')
  stop();stop=installMoneyInputDefaults(document,'JPY')
  expect(document.querySelector('input').placeholder).toBe('0')
  expect(document.querySelector('input').value).toBe('12.345')
  stop();document.body.innerHTML=''
})
