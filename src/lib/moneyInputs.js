import {currencyPlaceholder} from './currency'

export function installMoneyInputDefaults(root,code){
  const apply=()=>root.querySelectorAll('input[type="number"][step="0.001"],input[data-money-input]').forEach(input=>{
    input.dataset.moneyInput='true'
    input.step='any'
    input.inputMode='decimal'
    if(!input.placeholder || /^0(?:\.0+)?$/.test(input.placeholder))input.placeholder=currencyPlaceholder(code)
  })
  apply()
  const observer=new window.MutationObserver(apply)
  observer.observe(root.documentElement,{childList:true,subtree:true})
  return ()=>observer.disconnect()
}
