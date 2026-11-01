import { describe, it, expect } from 'vitest'
import { resolveSeason, seasonalPreferences } from './seasonal'
describe('seasonal calendar',()=>{
 it('is opt-in and sanitizes unknown settings',()=>{expect(resolveSeason({})).toBeNull();expect(seasonalPreferences({seasonal_theme:'invalid'}).seasonal_theme).toBe('winter')})
 it('maps all months for both hemispheres and Halloween',()=>{const north=['winter','winter','spring','spring','spring','summer','summer','summer','autumn','halloween','autumn','winter'];const south=['summer','summer','autumn','autumn','autumn','winter','winter','winter','spring','halloween','spring','summer'];for(let month=0;month<12;month++){expect(resolveSeason({seasonal_mode:'automatic'},new Date(2026,month,1))).toBe(north[month]);expect(resolveSeason({seasonal_mode:'automatic',seasonal_hemisphere:'south'},new Date(2026,month,1))).toBe(south[month])}})
 it('keeps manual moods regardless of the calendar',()=>{expect(resolveSeason({seasonal_mode:'manual',seasonal_theme:'rain'},new Date(2026,6,1))).toBe('rain')})
})
