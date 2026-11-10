const { contextBridge, ipcRenderer } = require('electron')
contextBridge.exposeInMainWorld('budgetlyDesktop', Object.freeze({
  version: ipcRenderer.sendSync('budgetly:version'),
  setPaletteIcon: palette => ipcRenderer.send('budgetly:palette-icon', palette),
  canInstallUpdate: () => ipcRenderer.invoke('budgetly:can-install-update'),
  installUpdate: version => ipcRenderer.invoke('budgetly:install-update', version),
}))
