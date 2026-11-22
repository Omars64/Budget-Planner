import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { createHash } from 'node:crypto'
import { readdir, readFile, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'

const offlineRoutes = ['Overview','Transactions','Wallets','Upcoming','More','Settings']

async function shellFiles(folder, prefix = '') {
  const entries = await readdir(folder, { withFileTypes: true })
  const nested = await Promise.all(entries.map(entry => entry.isDirectory()
    ? shellFiles(`${folder}/${entry.name}`, `${prefix}${entry.name}/`)
    : Promise.resolve([`${prefix}${entry.name}`])))
  return nested.flat().filter(path => /\.(?:html|webmanifest|js|css|png|svg|webp|ico|ttf|woff2?)$/.test(path))
}

const offlineShell = () => {
  let folder, publicDir
  return {
  name: 'budgetly-offline-shell',
  apply: 'build',
  configResolved(config) {
    folder = resolve(config.root, config.build.outDir)
    publicDir = config.publicDir
  },
  async closeBundle() {
    const files = (await shellFiles(folder)).sort()
    const manifest = JSON.parse(await readFile(resolve(folder, '.vite/manifest.json'), 'utf8'))
    const essentials = new Set(files.filter(file => file !== 'budgetly-push-sw.js' && !file.startsWith('assets/')))
    const visited = new Set()
    function include(key) {
      if (visited.has(key)) return
      visited.add(key)
      const item = manifest[key]
      if (!item) throw new Error('Missing offline shell dependency: '+key)
      for (const file of [item.file, ...(item.css||[]), ...(item.assets||[])]) essentials.add(file)
      for (const dependency of item.imports||[]) include(dependency)
    }
    include('index.html')
    for (const route of offlineRoutes) include(`src/pages/${route}.jsx`)
    const pushScript = await readFile(resolve(publicDir, 'budgetly-push-sw.js'), 'utf8')
    const revision = createHash('sha256').update(files.join('|')).update([...essentials].join('|')).update(pushScript).digest('hex').slice(0, 12)
    const script = `const CACHE = 'budgetly-shell-${revision}';
const ESSENTIALS = ${JSON.stringify([...essentials].map(file => `/${file}`))};
const OPTIONAL_ASSETS = new Set(${JSON.stringify(files.filter(file => file.startsWith('assets/') && !essentials.has(file)).map(file => `/${file}`))});
self.addEventListener('install', event => event.waitUntil(caches.open(CACHE).then(cache => cache.addAll(ESSENTIALS)).then(() => self.skipWaiting())));
self.addEventListener('activate', event => event.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(key => key.startsWith('budgetly-shell-') && key !== CACHE).slice(0, -1).map(key => caches.delete(key)))).then(() => self.clients.claim())));
self.addEventListener('fetch', event => {
  const request = event.request;
  const url = new URL(request.url);
  if (request.method !== 'GET' || url.origin !== self.location.origin || url.pathname.startsWith('/api/')) return;
  if (request.mode === 'navigate') {
    const shell = () => caches.open(CACHE).then(cache => cache.match('/index.html'));
    event.respondWith(fetch(request).then(response => response.ok ? response : shell()).catch(shell));
    return;
  }
  // Only versioned public build assets may be added at runtime.
  if (!ESSENTIALS.includes(url.pathname) && !OPTIONAL_ASSETS.has(url.pathname)) return;
  event.respondWith(caches.match(url.href).then(async cached => {
    if (cached) return cached;
    const response = await fetch(request);
    if (response.ok && !response.redirected && !url.search && OPTIONAL_ASSETS.has(url.pathname)) {
      const copy = response.clone();
      event.waitUntil(caches.open(CACHE).then(cache => cache.put(url.href, copy)).catch(() => {}));
    }
    return response;
  }));
});
`
    // One root-scope registration must handle both offline navigation and push.
    // Registering separate workers for the same scope replaces the prior one.
    await writeFile(resolve(folder, 'budgetly-push-sw.js'), `${pushScript}\n${script}`)
    // Older installed web bundles still register this URL. Preserve both handlers.
    await writeFile(resolve(folder, 'sw.js'), "importScripts('/budgetly-push-sw.js');\n")
  },
  }
}

export default defineConfig({
  plugins: [react(), offlineShell()],
  build: { manifest: true },
  server: {
    port: 5173,
    proxy: {
      '/api': {
        target: process.env.FLOWBUDGET_API_PROXY || 'http://127.0.0.1:8000',
        changeOrigin: true,
      },
    },
  },
  test: {
    include: ['src/**/*.test.{js,jsx,ts,tsx}'],
    maxWorkers: 2,
    environment: 'jsdom',
    setupFiles: './src/testSetup.js',
    css: true,
  },
})
