import { expect, it } from 'vitest'
import { mergeSettingsDraft } from './settingsDraft'

it('keeps unsaved preferences when an independent setting is saved', () => {
  expect(mergeSettingsDraft({theme:'dark',currency:'KWD'}, {theme:'light',currency:'KWD'}, {theme:'light',currency:'USD'})).toEqual({theme:'dark',currency:'USD'})
})
it('accepts incoming changes for clean fields, including structured settings', () => {
  expect(mergeSettingsDraft({topics:['daily'],theme:'light'}, {topics:['daily'],theme:'light'}, {topics:['daily','bills'],theme:'dark'})).toEqual({topics:['daily','bills'],theme:'dark'})
})
