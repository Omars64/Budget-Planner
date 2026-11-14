const fs = require('node:fs')
const path = require('node:path')
const { app, nativeImage, shell } = require('electron')
const palettes = require('../src/lib/colorPalettes.json')

const appId = 'com.flowbudget.desktop'
const windows = process.platform === 'win32'
const iconDirectory = app.isPackaged ? path.join(process.resourcesPath, 'palette-icons') : path.join(__dirname, 'brand')
const shortcutName = 'Budgetly.lnk'
let palette

function preferenceFile() {
  return path.join(app.getPath('userData'), 'launcher-palette')
}

function restorePalette() {
  try {
    const saved = fs.readFileSync(preferenceFile(), 'utf8').trim()
    if (Object.hasOwn(palettes, saved)) palette = saved
  } catch { /* The renderer can restore an existing preference on upgrade. */ }
  return palette
}

function imageForPalette(value) {
  return nativeImage.createFromPath(path.join(__dirname, 'brand', (value || 'navy') + '.png'))
}

function updateWindowsShortcuts(icon) {
  const roaming = app.getPath('appData')
  const shortcuts = [
    path.join(app.getPath('desktop'), shortcutName),
    path.join(roaming, 'Microsoft', 'Windows', 'Start Menu', 'Programs', shortcutName),
    path.join(roaming, 'Microsoft', 'Internet Explorer', 'Quick Launch', 'User Pinned', 'TaskBar', shortcutName),
  ]
  for (const shortcut of shortcuts) {
    try {
      const current = shell.readShortcutLink(shortcut)
      if (path.resolve(current.target).toLowerCase() !== process.execPath.toLowerCase() || current.icon === icon) continue
      shell.writeShortcutLink(shortcut, 'update', { icon, iconIndex: 0 })
    } catch { /* Shortcuts are optional and can be protected by Windows. */ }
  }
}

function applyPalette(win, value) {
  if (typeof value !== 'string' || !Object.hasOwn(palettes, value)) return false
  const image = imageForPalette(value)
  if (image.isEmpty()) return false
  win.setIcon(image)
  if (windows && !process.windowsStore) {
    const icon = path.join(iconDirectory, value + '.ico')
    if (fs.existsSync(icon)) {
      win.setAppDetails({ appId, appIconPath: icon, appIconIndex: 0, relaunchCommand: `"${process.execPath}"`, relaunchDisplayName: 'Budgetly' })
      if (app.isPackaged) updateWindowsShortcuts(icon)
    }
  }
  if (value !== palette) {
    palette = value
    try {
      const file = preferenceFile()
      fs.writeFileSync(file + '.tmp', value)
      fs.renameSync(file + '.tmp', file)
    } catch { /* The device's renderer preference still applies. */ }
  }
  return true
}

module.exports = { appId, restorePalette, imageForPalette, applyPalette }
