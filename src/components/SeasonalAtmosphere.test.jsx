import { act, cleanup, render } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import SeasonalAtmosphere, { SeasonalScene } from './SeasonalAtmosphere'
import { seasonalParticleCount } from '../lib/seasonal'
const motion=vi.hoisted(()=>({value:'full'}))
vi.mock('../lib/appMotion',()=>({useAppMotion:()=>motion.value}))
afterEach(()=>{cleanup();vi.restoreAllMocks();motion.value='full'})
it('shares measured density and real sprite artwork with the preview',()=>{
 const {container,rerender}=render(<SeasonalScene theme="halloween" effects="full" preview/>)
 expect(container.querySelectorAll('.seasonal-particle')).toHaveLength(seasonalParticleCount('halloween','full',window.innerWidth,window.innerHeight))
 expect([...container.querySelectorAll('[data-sprite]')].map(e=>Number(e.dataset.sprite))).toContain(0)
 expect(container.querySelector('[data-sprite="6"]')).toBeNull()
 rerender(<SeasonalScene theme="rain" effects="full"/>)
 expect(container.firstChild).toHaveClass('seasonal-global')
 expect(container.querySelectorAll('.seasonal-raindrop')).toHaveLength(seasonalParticleCount('rain','full',window.innerWidth,window.innerHeight))
})
it('respects static mode, hidden tabs and reduced motion',()=>{
 const {container,rerender}=render(<SeasonalScene theme="rain" effects="subtle" paused/>)
 expect(container.firstChild).toHaveAttribute('data-moving','false')
 rerender(<SeasonalScene theme="rain" effects="off"/>)
 expect(container.querySelectorAll('.seasonal-particle')).toHaveLength(0)
 motion.value='reduced'
 rerender(<SeasonalScene theme="rain" effects="full"/>)
 expect(container.firstChild).toHaveAttribute('data-moving','false')
 motion.value='full'
 const hidden=vi.spyOn(document,'hidden','get').mockReturnValue(true)
 act(()=>document.dispatchEvent(new Event('visibilitychange')))
 expect(container.firstChild).toHaveAttribute('data-moving','false')
 hidden.mockReturnValue(false)
 act(()=>document.dispatchEvent(new Event('visibilitychange')))
 expect(container.firstChild).toHaveAttribute('data-moving','true')
})
it('clears seasonal surfaces on Off and unmount without changing wallpaper or accent',()=>{
 document.body.style.backgroundImage='url("kept-wallpaper.png")'
 const {rerender,unmount}=render(<SeasonalAtmosphere settings={{seasonal_mode:'manual',seasonal_theme:'winter',seasonal_tint:12}}/>)
 expect(document.body.dataset.seasonal).toBe('winter')
 expect(document.body.style.getPropertyValue('--season-tint')).toBe('0.12')
 rerender(<SeasonalAtmosphere settings={{seasonal_mode:'off'}}/>)
 expect(document.body.dataset.seasonal).toBeUndefined()
 expect(document.body.style.backgroundImage).toContain('kept-wallpaper.png')
 unmount()
 expect(document.body.style.getPropertyValue('--season-tint')).toBe('')
 document.body.style.backgroundImage=''
})
