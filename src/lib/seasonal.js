export const seasons = {
 halloween:{name:'Halloween',colour:'#d98527',art:[0,1,2,3,4,5],detail:'Ghosts, pumpkins, spiders and playful little frights.'},
 rain:{name:'Rainy day',colour:'#658ca9',art:[],detail:'Glass droplets, flowing trails and misty light.'},
 winter:{name:'Winter',colour:'#89b9ca',art:[12,13,14,15,16,17],detail:'Six crystalline snowflakes and soft, layered snowfall.'},
 summer:{name:'Summer',colour:'#e3b449',art:[18,19,20],detail:'Sunshine, palm fronds and warm golden glimmers.'},
 autumn:{name:'Autumn',colour:'#bc794d',art:[6,7,8,9,10,11],detail:'Six leaf shapes in copper, amber and crimson.'},
 spring:{name:'Spring',colour:'#91b69a',art:[21,22,23],detail:'Cherry blossoms, daisies and fluttering butterflies.'},
}
export function seasonalPreferences(value={}) {
 return {seasonal_mode:['off','automatic','manual'].includes(value.seasonal_mode)?value.seasonal_mode:'off',seasonal_theme:Object.hasOwn(seasons,value.seasonal_theme)?value.seasonal_theme:'winter',seasonal_hemisphere:value.seasonal_hemisphere==='south'?'south':'north',seasonal_effects:['off','subtle','full'].includes(value.seasonal_effects)?value.seasonal_effects:'subtle',seasonal_tint:Number.isInteger(value.seasonal_tint)&&value.seasonal_tint>=0&&value.seasonal_tint<=18?value.seasonal_tint:7,seasonal_speed:['slow','normal','lively'].includes(value.seasonal_speed)?value.seasonal_speed:'normal'}
}
export function resolveSeason(value,date=new Date()) {
 const prefs=seasonalPreferences(value)
 if(prefs.seasonal_mode==='off')return null
 if(prefs.seasonal_mode==='manual')return prefs.seasonal_theme
 const month=date.getMonth()
 if(month===9)return 'halloween'
 return (prefs.seasonal_hemisphere==='south'?['summer','autumn','winter','spring']:['winter','spring','summer','autumn'])[Math.floor(((month+1)%12)/3)]
}

export const seasonalSpeeds = {slow:.65,normal:1,lively:1.35}
// Same area, same density in both the applied scene and its preview.
export function seasonalParticleCount(theme,effects,width,height) {
 if (!theme || effects==='off') return 0
 const base=theme==='rain'?(effects==='full'?90:38):(effects==='full'?34:14)
 const area=Math.max(.08,Math.min(1.8,width*height/(1024*800)))
 return Math.max(3,Math.round(base*area))
}
