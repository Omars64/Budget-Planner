import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { createHash } from 'node:crypto'
import { readdir, writeFile } from 'node:fs/promises'

async function shellFiles(folder, prefix = '') {
  const entries = await readdir(folder, { withFileTypes: true })
  const nested = await Promise.all(entries.map(entry => entry.isDirectory()
    ? shellFiles(`${folder}/${entry.name}`, `${prefix}${entry.name}/`)
    : Promise.resolve([`${prefix}${entry.name}`])))
  return nested.flat().filter(path => /\.(?:html|js|css|png|svg|webp|ico|woff2?)$/.test(path))
}

const offlineShell = () => ({
  name: 'budgetly-offline-shell',
  apply: 'build',
  async closeBundle() {
    const files = await shellFiles('dist')
    const revision = createHash('sha256').update(files.sort().join('|')).digest('hex').slice(0, 12)
    const script = `const CACHE = 'budgetly-shell-${revision}';
const FILES = ${JSON.stringify(files.map(file => `/${file}`))};
self.addEventListener('install', event => event.waitUntil(caches.open(CACHE).then(cache => cache.addAll(FILES)).then(() => self.skipWaiting())));
self.addEventListener('activate', event => event.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(key => key.startsWith('budgetly-shell-') && key !== CACHE).slice(0, -1).map(key => caches.delete(key)))).then(() => self.clients.claim())));
self.addEventListener('fetch', event => {
  const request = event.request;
  const url = new URL(request.url);
  if (request.method !== 'GET' || url.origin !== self.location.origin || url.pathname.startsWith('/api/')) return;
  if (request.mode === 'navigate') {
    event.respondWith(fetch(request).then(response => response.ok ? response : caches.match('/index.html')).catch(() => caches.match('/index.html')));
    return;
  }
  event.respondWith(caches.match(request).then(cached => cached || fetch(request)));
});
`
    await writeFile('dist/sw.js', script)
  },
})

export default defineConfig({
  plugins: [react(), offlineShell()],
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
    environment: 'jsdom',
    setupFiles: './src/testSetup.js',
    css: true,
  },
})
