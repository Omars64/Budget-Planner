import { calculateSnapshot } from './workbookCalc'

globalThis.onmessage = ({ data }) => {
  try {
    globalThis.postMessage(calculateSnapshot(data))
  } catch (error) {
    globalThis.postMessage({ error: error.message || 'Calculation failed.' })
  }
}
