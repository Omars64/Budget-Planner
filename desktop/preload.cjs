const { contextBridge, ipcRenderer } = require('electron')
contextBridge.exposeInMainWorld('budgetlyDesktop', Object.freeze({
  ...ipcRenderer.sendSync('budgetly:desktop-info'),
  setPaletteIcon: palette => ipcRenderer.send('budgetly:palette-icon', palette),
  canInstallUpdate: () => ipcRenderer.invoke('budgetly:can-install-update'),
  installUpdate: version => ipcRenderer.invoke('budgetly:install-update', version),
  onUpdateProgress: callback => {
    const listener = (_event, progress) => callback(progress)
    ipcRenderer.on('budgetly:update-progress', listener)
    return () => ipcRenderer.removeListener('budgetly:update-progress', listener)
  },
}))
