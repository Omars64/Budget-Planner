import { Capacitor } from '@capacitor/core'
import { Directory, Filesystem } from '@capacitor/filesystem'
import { Share } from '@capacitor/share'

export async function saveDownload(blob, filename) {
  if (Capacitor.isNativePlatform()) {
    const bytes = new Uint8Array(await blob.arrayBuffer())
    const chunks = []
    for (let offset = 0; offset < bytes.length; offset += 8192) {
      chunks.push(String.fromCharCode(...bytes.subarray(offset, offset + 8192)))
    }
    const path = `${Date.now()}-${filename}`
    await Filesystem.writeFile({ path, data: btoa(chunks.join('')), directory: Directory.Cache })
    const { uri } = await Filesystem.getUri({ path, directory: Directory.Cache })
    await Share.share({ title: filename, files: [uri], dialogTitle: 'Save or share Budgetly file' })
    return
  }
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = filename
  document.body.appendChild(link)
  link.click()
  link.remove()
  setTimeout(() => URL.revokeObjectURL(url), 60000)
}
