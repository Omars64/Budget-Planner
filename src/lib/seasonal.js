export const seasons = {
 halloween:{name:'Halloween',colour:'#d98527',symbol:'🎃',detail:'Amber twilight, pumpkins and drifting leaves.'},
 rain:{name:'Rainy day',colour:'#658ca9',symbol:'☂',detail:'Misty blue light and gentle rainfall.'},
 winter:{name:'Winter',colour:'#89b9ca',symbol:'❄',detail:'Frosted light and softly falling snow.'},
 summer:{name:'Summer',colour:'#e3b449',symbol:'☀',detail:'Sunlit warmth and slow golden glimmers.'},
 autumn:{name:'Autumn',colour:'#bc794d',symbol:'🍂',detail:'Copper light and floating autumn leaves.'},
 spring:{name:'Spring',colour:'#91b69a',symbol:'✿',detail:'Fresh greens and drifting petals.'},
}
export function seasonalPreferences(value={}) {
 return {seasonal_mode:['off','automatic','manual'].includes(value.seasonal_mode)?value.seasonal_mode:'off',seasonal_theme:Object.hasOwn(seasons,value.seasonal_theme)?value.seasonal_theme:'winter',seasonal_hemisphere:value.seasonal_hemisphere==='south'?'south':'north',seasonal_effects:['off','subtle','full'].includes(value.seasonal_effects)?value.seasonal_effects:'subtle'}
}
export function resolveSeason(value,date=new Date()) {
 const prefs=seasonalPreferences(value)
 if(prefs.seasonal_mode==='off')return null
 if(prefs.seasonal_mode==='manual')return prefs.seasonal_theme
 const month=date.getMonth()
 if(month===9)return 'halloween'
 return (prefs.seasonal_hemisphere==='south'?['summer','autumn','winter','spring']:['winter','spring','summer','autumn'])[Math.floor(((month+1)%12)/3)]
}
