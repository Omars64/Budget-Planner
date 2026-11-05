const { contextBridge, ipcRenderer } = require('electron')
contextBridge.exposeInMainWorld('budgetlyDesktop', Object.freeze({ version: ipcRenderer.sendSync('budgetly:version') }))
