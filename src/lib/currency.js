import data from '../../currencies.json'

export const currencyCodes=data.codes
export const validCurrency=code=>currencyCodes.includes(code)
export const currencyDigits=code=>data.fractionDigits[code]??2
export const currencyStep=code=>String(10**-currencyDigits(code))
export const currencyPlaceholder=code=>Number(0).toFixed(currencyDigits(code))
let names
try{names=new Intl.DisplayNames(undefined,{type:'currency'})}catch{ /* Codes remain usable on older devices. */ }
export const currencyLabel=code=>`${code} - ${names?.of(code)||code}`
