import { cleanup, render } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import { SeasonalScene } from './SeasonalAtmosphere'
vi.mock('../lib/appMotion',()=>({useAppMotion:()=> 'full'}))
afterEach(cleanup)
it('uses the same rainfall density in preview and the applied scene',()=>{
 const {container,rerender}=render(<SeasonalScene theme="rain" effects="full" preview/>)
 expect(container.querySelectorAll('.seasonal-particle')).toHaveLength(96)
 rerender(<SeasonalScene theme="rain" effects="full"/>)
 expect(container.querySelectorAll('.seasonal-particle')).toHaveLength(96)
 expect(container.firstChild).toHaveClass('seasonal-global')
})
it('supports subtle rain, static effects and hidden-app pausing',()=>{
 const {container,rerender}=render(<SeasonalScene theme="rain" effects="subtle" paused/>)
 expect(container.querySelectorAll('.seasonal-particle')).toHaveLength(40)
 expect(container.firstChild).toHaveAttribute('data-moving','false')
 rerender(<SeasonalScene theme="rain" effects="off"/>)
 expect(container.querySelectorAll('.seasonal-particle')).toHaveLength(0)
})
