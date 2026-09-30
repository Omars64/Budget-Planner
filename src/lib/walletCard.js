export function walletCardStyle(value) {
  const color = /^#[\da-f]{6}$/i.test(value || '') ? value : '#3158aa'
  const channels = color.slice(1).match(/../g).map(channel => parseInt(channel, 16) / 255)
  const luminance = channels.map(channel => channel <= .04045 ? channel / 12.92 : ((channel + .055) / 1.055) ** 2.4)
  const light = luminance[0] * .2126 + luminance[1] * .7152 + luminance[2] * .0722 > .179
  return { '--wallet-card-color': color, '--wallet-card-ink': light ? '#172c38' : '#ffffff', '--wallet-card-tint': light ? '#ffffff' : '#000000' }
}
