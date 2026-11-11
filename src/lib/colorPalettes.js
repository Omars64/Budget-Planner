export const defaultPalette = 'navy'

export const colorPalettes = {
  navy: { name: 'Midnight Navy & Glacier Blue', deep: '#101e33', light: '#f1f8fc', action: '#195c7a', bright: '#8fd8f5' },
  // Keep the saved key so existing users automatically receive the revised palette.
  aubergine: { name: 'Midnight Blue & Mint', deep: '#0b1830', light: '#f2f7fc', action: '#176447', bright: '#43f4b3' },
  burgundy: { name: 'Burgundy, Cream & Soft Gold', deep: '#321622', light: '#fff5e7', action: '#742c48', bright: '#e7be79' },
  pine: { name: 'Pine Green & Copper', deep: '#132b25', light: '#f7f3e9', action: '#285a49', bright: '#e5ac86' },
  graphite: { name: 'Graphite & Lavender', deep: '#20232c', light: '#f5f4f8', action: '#62468e', bright: '#c5b5fa' },
}

export const paletteKey = value => Object.hasOwn(colorPalettes, value) ? value : defaultPalette
