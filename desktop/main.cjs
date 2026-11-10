const { app, BrowserWindow, ipcMain, nativeImage, net, shell, session } = require('electron')
const fs = require('node:fs/promises')
const path = require('node:path')
const { registerWindowsUpdates } = require('./windows-update.cjs')

const origin = 'https://budget-planner-ecru-seven.vercel.app'
const assets = path.join(__dirname, '..', 'dist')
const mime = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.png': 'image/png', '.svg': 'image/svg+xml', '.ico': 'image/x-icon', '.json': 'application/json', '.webmanifest': 'application/manifest+json', '.woff2': 'font/woff2' }
let mainWindow
const paletteIcons = new Set(['navy', 'aubergine', 'burgundy', 'pine', 'graphite'])

function isBudgetlyFrame(event) {
  const frame = event.senderFrame
  if (!frame || mainWindow?.webContents !== event.sender || frame !== event.sender.mainFrame || !frame.url.startsWith(origin + '/')) return false
  return new URL(frame.url).pathname === '/'
}

async function serve(request) {
  const url = new URL(request.url)
  if (url.origin !== origin || url.pathname.startsWith('/api/')) return net.fetch(request, { bypassCustomProtocolHandlers: true })
  if (request.method !== 'GET' && request.method !== 'HEAD') return net.fetch(request, { bypassCustomProtocolHandlers: true })
  const relative = decodeURIComponent(url.pathname).replace(/^\/+/, '') || 'index.html'
  const file = path.resolve(assets, relative)
  if (file !== assets && !file.startsWith(assets + path.sep)) return new Response('Forbidden', { status: 403 })
  try {
    const body = await fs.readFile(file)
    return new Response(request.method === 'HEAD' ? null : body, { headers: { 'Content-Type': mime[path.extname(file)] || 'application/octet-stream', 'Cache-Control': 'no-store' } })
  } catch {
    if (path.extname(relative)) return new Response('Not found', { status: 404 })
    const body = await fs.readFile(path.join(assets, 'index.html'))
    return new Response(request.method === 'HEAD' ? null : body, { headers: { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' } })
  }
}

function createWindow() {
  const win = new BrowserWindow({ width: 1280, height: 820, minWidth: 920, minHeight: 620, title: 'Budgetly', icon: path.join(__dirname, 'icon.ico'), webPreferences: { nodeIntegration: false, contextIsolation: true, sandbox: true, preload: path.join(__dirname, 'preload.cjs') } })
  mainWindow = win
  win.on('closed', () => { if (mainWindow === win) mainWindow = null })
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (url === 'about:blank' || url.startsWith('https://accounts.google.com/')) return { action: 'allow', overrideBrowserWindowOptions: { webPreferences: { nodeIntegration: false, contextIsolation: true, sandbox: true } } }
    if (url.startsWith('https://')) void shell.openExternal(url)
    return { action: 'deny' }
  })
  win.webContents.on('will-navigate', (event, url) => {
    if (!url.startsWith(origin + '/')) { event.preventDefault(); if (url.startsWith('https://')) void shell.openExternal(url) }
  })
  void win.loadURL(origin + '/')
}

if (!app.requestSingleInstanceLock()) app.quit()
else app.whenReady().then(() => {
  ipcMain.on('budgetly:version', event => { event.returnValue = app.getVersion() })
  registerWindowsUpdates(origin, isBudgetlyFrame)
  ipcMain.on('budgetly:palette-icon', (event, palette) => {
    if (!isBudgetlyFrame(event) || !paletteIcons.has(palette)) return
    const icon = nativeImage.createFromPath(path.join(__dirname, 'brand', palette + '.png'))
    if (!icon.isEmpty()) mainWindow.setIcon(icon)
  })
  session.defaultSession.protocol.handle('https', serve)
  createWindow()
  app.on('second-instance', () => {
    if (!mainWindow) return
    if (mainWindow.isMinimized()) mainWindow.restore()
    mainWindow.focus()
  })
  app.on('activate', () => { if (BrowserWindow.getAllWindows().length === 0) createWindow() })
})
app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit() })
