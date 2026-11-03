import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, expect, test, vi } from 'vitest'
import AndroidReleaseDownload from './AndroidReleaseDownload'
import AndroidAppSettings from './AndroidAppSettings'
import SettingsWorkspace from './SettingsWorkspace'
import SettingsSection from './SettingsSection'
import { fetchRelease, RELEASES_URL } from '../lib/appUpdates'

vi.mock('../lib/appUpdates', () => ({ fetchRelease: vi.fn(), RELEASES_URL: 'https://github.com/Omars64/Budget-Planner/releases' }))
vi.mock('../lib/appMotion', () => ({ useAppMotion: () => 'off' }))
const release = (version = '6.13.0') => ({version,size:9489172,url:`${RELEASES_URL}/download/v${version}/Budgetly-${version}.apk`})
beforeEach(() => { vi.clearAllMocks(); fetchRelease.mockResolvedValue(release()); vi.stubGlobal('matchMedia', vi.fn(() => ({matches:false,addEventListener:vi.fn(),removeEventListener:vi.fn()}))) })
afterEach(() => { cleanup(); vi.useRealTimers(); vi.unstubAllGlobals() })

test('uses the published manifest for version, real size and version-specific links', async () => {
  render(<AndroidReleaseDownload/>)
  expect(await screen.findByText('Latest Android release: v6.13.0')).toBeVisible()
  expect(screen.getByText('9.5 MB · APK for Android')).toBeVisible()
  expect(screen.getByRole('link',{name:'Download Budgetly APK'})).toHaveAttribute('href',release().url)
  expect(screen.getByRole('link',{name:'Release notes'})).toHaveAttribute('href',`${RELEASES_URL}/tag/v6.13.0`)
})

test('refresh updates the available version and download without a frontend release', async () => {
  render(<AndroidReleaseDownload/>)
  await screen.findByText('Latest Android release: v6.13.0')
  fetchRelease.mockResolvedValueOnce(release('6.14.0'))
  fireEvent.click(screen.getByRole('button',{name:'Check latest version'}))
  expect(await screen.findByText('Latest Android release: v6.14.0')).toBeVisible()
  expect(screen.getByRole('link',{name:'Download Budgetly APK'})).toHaveAttribute('href',release('6.14.0').url)
})

test('does not invent a version or download when no release is published', async () => {
  fetchRelease.mockResolvedValue(null)
  render(<AndroidReleaseDownload/>)
  expect(await screen.findByText('No Android release is currently published.')).toBeVisible()
  expect(screen.queryByRole('link',{name:'Download Budgetly APK'})).not.toBeInTheDocument()
  expect(screen.getByRole('link',{name:'Browse releases'})).toHaveAttribute('href',RELEASES_URL)
})

test('a failed check is retryable and exposes no stale download as latest', async () => {
  fetchRelease.mockRejectedValueOnce(new Error('Provider failure'))
  render(<AndroidReleaseDownload/>)
  expect(await screen.findByText(/Unable to check the latest Android version/)).toBeVisible()
  expect(screen.queryByRole('link',{name:'Download Budgetly APK'})).not.toBeInTheDocument()
  fireEvent.click(screen.getByRole('button',{name:'Check latest version'}))
  expect(await screen.findByRole('link',{name:'Download Budgetly APK'})).toBeVisible()
})

test('only checks on opening its own Settings category and refreshes on reopening', async () => {
  render(<SettingsWorkspace><SettingsSection title="Guest workspace">Account</SettingsSection><AndroidAppSettings settingsId="android"/></SettingsWorkspace>)
  expect(fetchRelease).not.toHaveBeenCalled()
  fireEvent.click(screen.getByRole('button',{name:/Android app Download/}))
  expect(await screen.findByRole('link',{name:'Download Budgetly APK'})).toBeVisible()
  expect(screen.getByText('Official Android download')).toBeVisible()
  fireEvent.click(screen.getByRole('button',{name:/Account & security/}))
  const firstSignal=fetchRelease.mock.calls[0][0]
  expect(firstSignal.aborted).toBe(true)
  fetchRelease.mockResolvedValue(release('6.14.0'))
  fireEvent.click(screen.getByRole('button',{name:/Android app Download/}))
  expect(await screen.findByText('Latest Android release: v6.14.0')).toBeVisible()
  await waitFor(()=>expect(fetchRelease).toHaveBeenCalledTimes(2))
})

test('a stalled request times out and a late result cannot show a download', async () => {
  vi.useFakeTimers()
  let resolve
  fetchRelease.mockImplementation(()=>new Promise(done=>{resolve=done}))
  render(<AndroidReleaseDownload/>)
  await act(async()=>{vi.advanceTimersByTime(15000)})
  expect(screen.getByText(/Unable to check the latest Android version/)).toBeVisible()
  expect(fetchRelease.mock.calls[0][0].aborted).toBe(true)
  await act(async()=>{resolve(release())})
  expect(screen.queryByRole('link',{name:'Download Budgetly APK'})).not.toBeInTheDocument()
})
