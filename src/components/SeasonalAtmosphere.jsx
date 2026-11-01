import { useEffect, useState } from 'react'
import { resolveSeason, seasonalPreferences, seasons } from '../lib/seasonal'
import { useAppMotion } from '../lib/appMotion'
import './SeasonalAppearance.css'
export function SeasonalScene({theme,effects='subtle',preview=false,paused=false}) {
 const motion=useAppMotion()
 if(!theme||!seasons[theme])return null
 const count=effects==='full'?18:effects==='subtle'?7:0
 return <div className={`seasonal-scene ${preview?'seasonal-preview':'seasonal-global'}`} data-season={theme} data-moving={motion==='full'&&effects!=='off'&&!paused} style={{'--season-colour':seasons[theme].colour}} aria-hidden="true"><div className="seasonal-glow"/><span className="seasonal-emblem">{seasons[theme].symbol}</span>{Array.from({length:count},(_,i)=><i className="seasonal-particle" key={i} style={{'--x':`${(i*37+11)%100}%`,'--delay':`${-i*1.7}s`,'--duration':`${theme==='rain'?2+i%3:12+i%9}s`}}>{theme==='winter'?'❄':['autumn','halloween'].includes(theme)?'🍂':theme==='spring'?'✿':''}</i>)}</div>
}
export default function SeasonalAtmosphere({settings}) {
 const [now,setNow]=useState(()=>new Date()),[hidden,setHidden]=useState(()=>document.hidden)
 useEffect(()=>{const update=()=>{setHidden(document.hidden);if(!document.hidden)setNow(new Date())};const timer=setInterval(()=>{if(!document.hidden)setNow(new Date())},60000);document.addEventListener('visibilitychange',update);return()=>{clearInterval(timer);document.removeEventListener('visibilitychange',update)}},[])
 const prefs=seasonalPreferences(settings)
 return <SeasonalScene theme={resolveSeason(prefs,now)} effects={prefs.seasonal_effects} paused={hidden}/>
}
