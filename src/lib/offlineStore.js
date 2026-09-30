const DB_NAME = 'budgetly-offline-v1'
const STORE = 'records'
let connection

function database() {
  if (!globalThis.indexedDB) return Promise.reject(new Error('Device storage is unavailable. Keep this form open and try again online.'))
  if (!connection) connection = new Promise((resolve, reject) => {
    const request = globalThis.indexedDB.open(DB_NAME, 1)
    request.onupgradeneeded = () => request.result.createObjectStore(STORE)
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error)
  }).catch(error => { connection = null; throw error })
  return connection
}

async function access(mode, operation) {
  const db = await database()
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, mode)
    const request = operation(tx.objectStore(STORE))
    let result
    request.onsuccess = () => { result = request.result }
    request.onerror = () => reject(request.error)
    tx.oncomplete = () => resolve(result)
    tx.onabort = () => reject(tx.error || new Error('Device storage failed.'))
    tx.onerror = () => reject(tx.error || new Error('Device storage failed.'))
  })
}

export const readOffline = key => access('readonly', store => store.get(key))
export const writeOffline = (key, value) => access('readwrite', store => store.put(value, key))
export const deleteOffline = key => access('readwrite', store => store.delete(key))
export const listOffline = async prefix => {
  const db = await database()
  return new Promise((resolve, reject) => {
    const rows = []
    const tx = db.transaction(STORE, 'readonly')
    const request = tx.objectStore(STORE).openCursor(globalThis.IDBKeyRange.bound(prefix, `${prefix}\uffff`))
    request.onsuccess = () => {
      const cursor = request.result
      if (cursor) { rows.push({ key: cursor.key, value: cursor.value }); cursor.continue() }
      else resolve(rows)
    }
    request.onerror = () => reject(request.error)
    tx.onabort = () => reject(tx.error || new Error('Device storage failed.'))
  })
}

export async function clearOfflineCache(userId) {
  const rows = await listOffline(`cache:${userId}:`)
  await Promise.all(rows.map(row => deleteOffline(row.key)))
  await deleteOffline(`session:${userId}`)
}
