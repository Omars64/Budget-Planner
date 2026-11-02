import { describe, it, expect } from 'vitest'
import { resolveSeason, seasonalPreferences, seasonalParticleCount, seasons } from './seasonal'
describe('seasonal calendar',()=>{
 it('is opt-in and sanitizes unknown settings',()=>{expect(resolveSeason({})).toBeNull();expect(seasonalPreferences({seasonal_theme:'invalid'}).seasonal_theme).toBe('winter')})
 it('maps all months for both hemispheres and Halloween',()=>{const north=['winter','winter','spring','spring','spring','summer','summer','summer','autumn','halloween','autumn','winter'];const south=['summer','summer','autumn','autumn','autumn','winter','winter','winter','spring','halloween','spring','summer'];for(let month=0;month<12;month++){expect(resolveSeason({seasonal_mode:'automatic'},new Date(2026,month,1))).toBe(north[month]);expect(resolveSeason({seasonal_mode:'automatic',seasonal_hemisphere:'south'},new Date(2026,month,1))).toBe(south[month])}})
 it('keeps manual moods regardless of the calendar',()=>{expect(resolveSeason({seasonal_mode:'manual',seasonal_theme:'rain'},new Date(2026,6,1))).toBe('rain')})
 it('bounds tint and speed without changing legacy preferences',()=>{
  expect(seasonalPreferences({seasonal_mode:'manual',seasonal_theme:'rain',seasonal_tint:100,seasonal_speed:'broken'})).toMatchObject({seasonal_mode:'manual',seasonal_theme:'rain',seasonal_tint:7,seasonal_speed:'normal'})
 })
 it('shares area-based density between full scenes and previews, with a safe ceiling',()=>{
  expect(seasonalParticleCount('rain','full',1024,800)).toBe(90)
  expect(seasonalParticleCount('rain','full',512,400)).toBe(23)
  expect(seasonalParticleCount('rain','full',8000,8000)).toBe(162)
  expect(seasonalParticleCount('rain','off',1024,800)).toBe(0)
  expect(seasons.halloween.art).not.toEqual(seasons.autumn.art)
  expect(new Set(seasons.winter.art).size).toBe(6)
 })
})
