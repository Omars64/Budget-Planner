import { dateInput } from './time'

export function phraseSearch(text, categories = [], now = dateInput().slice(0,10)) {
  let search = text.trim().slice(0,160)
  const filters = {search,month:'',category:'',type:'all',date_from:'',date_to:'',reporting_from:'',reporting_to:''}
  const monthPhrase = /\b(last month|this month)\b/i.exec(search)
  if (monthPhrase) {
    const date = new Date(`${now.slice(0,7)}-01T12:00:00Z`)
    if (monthPhrase[0].toLowerCase() === 'last month') date.setUTCMonth(date.getUTCMonth()-1)
    filters.month = date.toISOString().slice(0,7)
    search = search.replace(monthPhrase[0],'').trim()
  }
  const typePhrase = /\b(expenses?|income|transfers?)\b/i.exec(search)
  if (typePhrase) {
    filters.type = typePhrase[0].toLowerCase().startsWith('expense') ? 'expense' : typePhrase[0].toLowerCase().startsWith('transfer') ? 'transfer' : 'income'
    search = search.replace(typePhrase[0],'').trim()
  }
  const matches=categories.filter(category=>category.name.toLowerCase()===search.toLowerCase() && (filters.type==='all'||category.kind===filters.type))
  if(matches.length===1){filters.category=String(matches[0].id);search='';filters.type=matches[0].kind}
  filters.search=search
  return filters
}

const key=(userId,scope)=>`budgetly:saved-searches:v1:${userId}:${scope}`
export function savedSearches(userId,scope){
  try{return (JSON.parse(localStorage.getItem(key(userId,scope))) || []).filter(item=>typeof item.name==='string' && item.filters && typeof item.filters==='object' && !Array.isArray(item.filters)).slice(0,10)}catch{return []}
}
export function saveSearch(userId,scope,name,filters){
  const label=name.trim().slice(0,60)
  if(!label)throw new Error('Give this search a name.')
  const entries=[{name:label,filters},...savedSearches(userId,scope).filter(item=>item.name!==label)].slice(0,10)
  localStorage.setItem(key(userId,scope),JSON.stringify(entries));return entries
}
export function removeSearch(userId,scope,name){
  const entries=savedSearches(userId,scope).filter(item=>item.name!==name)
  localStorage.setItem(key(userId,scope),JSON.stringify(entries));return entries
}
