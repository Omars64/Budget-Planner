import palettes from './colorPalettes.json'

export const defaultPalette = 'navy'
export const colorPalettes = palettes

export const paletteKey = value => Object.hasOwn(colorPalettes, value) ? value : defaultPalette
