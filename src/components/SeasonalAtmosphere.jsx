import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { resolveSeason, seasonalParticleCount, seasonalPreferences, seasonalSpeeds, seasons } from '../lib/seasonal'
import { seasonalSpriteStyle } from '../lib/seasonalArt'
import { useAppMotion } from '../lib/appMotion'
import './SeasonalAppearance.css'

export function SeasonalSticker({ index }) {
  return <span className="seasonal-sticker" data-sprite={index} style={seasonalSpriteStyle(index)} aria-hidden="true"/>
}

function useSceneSize(ref, enabled) {
  const [size, setSize] = useState(() => ({ width: window.innerWidth || 1024, height: window.innerHeight || 800 }))
  useLayoutEffect(() => {
    if (!enabled || !ref.current) return
    const update = () => {
      const rect = ref.current?.getBoundingClientRect()
      if (!rect?.width || !rect?.height) return
      const width = Math.round(rect.width), height = Math.round(rect.height)
      setSize(old => old.width === width && old.height === height ? old : { width, height })
    }
    update()
    const observer = typeof window.ResizeObserver === 'function' ? new window.ResizeObserver(update) : null
    observer?.observe(ref.current)
    window.addEventListener('resize', update)
    return () => { observer?.disconnect(); window.removeEventListener('resize', update) }
  }, [ref, enabled])
  return size
}

export function SeasonalScene({ theme, effects = 'subtle', preview = false, paused = false, tint = 7, speed = 'normal' }) {
  const motion = useAppMotion()
  const element = useRef(null)
  const [hidden, setHidden] = useState(() => document.hidden)
  const valid = Boolean(theme && seasons[theme])
  const size = useSceneSize(element, valid)
  useEffect(() => {
    const update = () => setHidden(document.hidden)
    document.addEventListener('visibilitychange', update)
    return () => document.removeEventListener('visibilitychange', update)
  }, [])
  if (!valid) return null
  const moving = motion === 'full' && effects !== 'off' && !paused && !hidden
  const count = seasonalParticleCount(theme, effects, size.width, size.height)
  const baseDuration = {halloween:22,autumn:20,winter:25,rain:7,summer:30,spring:27}[theme]
  return <div ref={element} className={`seasonal-scene ${preview ? 'seasonal-preview' : 'seasonal-global'}`} data-season={theme} data-moving={moving} data-static={motion !== 'full'} style={{'--season-colour':seasons[theme].colour,'--season-tint':tint/100,'--season-speed':seasonalSpeeds[speed] || 1}} aria-hidden="true">
    <div className="seasonal-backdrop"><div className="seasonal-glow"/><div className="seasonal-orb"/></div>
    <div className="seasonal-particles">{Array.from({length:count}, (_,i) => {
      const rain = theme === 'rain'
      const id = rain ? null : seasons[theme].art[i % seasons[theme].art.length]
      const kind = rain ? (i % 4 === 0 ? 'bead' : 'droplet') : theme === 'summer' && i % 3 === 2 ? 'glimmer' : id === 0 ? 'ghost' : id === 2 ? 'spider' : id === 3 ? 'bat' : id === 23 ? 'butterfly' : 'sticker'
      const particleSize = rain ? 5 + i * 7 % 18 : theme === 'winter' ? 20 + i * 13 % 26 : kind === 'glimmer' ? 3 + i % 4 : 28 + i * 11 % 24
      return <span key={i} className={`seasonal-particle${rain ? ' seasonal-raindrop' : ''}${kind === 'bead' ? ' seasonal-bead' : ''}`} data-kind={kind} style={{'--x':`${(i*43.7+7.1)%98}%`,'--size':`${particleSize}px`,'--duration':`${baseDuration+i*7%15}s`,'--delay':`${-(i*2.37+3.8)}s`,'--opacity':rain ? .4+i%4*.12 : .38+i%5*.085,'--sway':`${i%2 ? -25 : 34}px`,'--tilt':`${i*23%90-45}deg`,'--rock':`${3+i%4}s`,'--trail':`${35+i*13%100}px`,'--rest-y':`${i*23%95}%`}}>{!rain && kind !== 'glimmer' && <SeasonalSticker index={id}/>}</span>
    })}</div>
  </div>
}

export default function SeasonalAtmosphere({ settings }) {
  const prefs = seasonalPreferences(settings)
  const [now, setNow] = useState(() => new Date())
  const theme = resolveSeason(prefs, now)
  useEffect(() => {
    if (prefs.seasonal_mode !== 'automatic') return
    const update = () => { if (!document.hidden) setNow(new Date()) }
    update()
    const timer = window.setInterval(update, 60000)
    document.addEventListener('visibilitychange', update)
    return () => { clearInterval(timer); document.removeEventListener('visibilitychange', update) }
  }, [prefs.seasonal_mode])
  useLayoutEffect(() => {
    const body = document.body
    if (theme) {
      body.dataset.seasonal = theme
      body.style.setProperty('--season-tint', String(prefs.seasonal_tint/100))
      body.style.setProperty('--season-speed', String(seasonalSpeeds[prefs.seasonal_speed]))
    }
    return () => {
      delete body.dataset.seasonal
      body.style.removeProperty('--season-tint')
      body.style.removeProperty('--season-speed')
    }
  }, [theme,prefs.seasonal_tint,prefs.seasonal_speed])
  return <SeasonalScene theme={theme} effects={prefs.seasonal_effects} tint={prefs.seasonal_tint} speed={prefs.seasonal_speed}/>
}
