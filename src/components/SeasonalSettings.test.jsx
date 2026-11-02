import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import SeasonalSettings from './SeasonalSettings'
const mocks=vi.hoisted(()=>({api:vi.fn(),setSettings:vi.fn(),notify:vi.fn()}))
vi.mock('../App',()=>({useApp:()=>({settings:{},setSettings:mocks.setSettings,notify:mocks.notify})}))
vi.mock('../lib/api',()=>({api:mocks.api,jsonBody:value=>({body:JSON.stringify(value)})}))
vi.mock('./SeasonalAtmosphere',()=>({SeasonalScene:({theme})=><div data-testid="scene">{theme}</div>,SeasonalSticker:()=>null}))
beforeEach(()=>vi.clearAllMocks())
afterEach(cleanup)
it('previews without writing and saves only seasonal preferences',async()=>{
 mocks.api.mockResolvedValue({seasonal_mode:'manual',seasonal_theme:'rain'})
 render(<SeasonalSettings/>);fireEvent.click(screen.getByText('Seasonal appearance'))
 fireEvent.click(screen.getByLabelText('Choose manually'));fireEvent.click(screen.getByRole('button',{name:/Rainy day/}))
 fireEvent.change(screen.getByLabelText(/Surface tint/),{target:{value:'12'}})
 fireEvent.change(screen.getByLabelText('Animation speed'),{target:{value:'slow'}})
 expect(mocks.api).not.toHaveBeenCalled();expect(screen.getByTestId('scene')).toHaveTextContent('rain')
 fireEvent.click(screen.getByRole('button',{name:'Apply seasonal appearance'}))
 await waitFor(()=>expect(mocks.setSettings).toHaveBeenCalled())
 const body=JSON.parse(mocks.api.mock.calls[0][1].body)
 expect(body).toMatchObject({seasonal_tint:12,seasonal_speed:'slow'})
 expect(Object.keys(body).sort()).toEqual(['seasonal_effects','seasonal_hemisphere','seasonal_mode','seasonal_speed','seasonal_theme','seasonal_tint'])
})
it('keeps the preview after save failure',async()=>{
 mocks.api.mockRejectedValue(new Error('Offline'))
 render(<SeasonalSettings/>);fireEvent.click(screen.getByText('Seasonal appearance'));fireEvent.click(screen.getByLabelText('Choose manually'))
 fireEvent.click(screen.getByRole('button',{name:'Apply seasonal appearance'}))
 await screen.findByText('Could not save. Your preview is still here.')
 expect(mocks.setSettings).not.toHaveBeenCalled()
})
