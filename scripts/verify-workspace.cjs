const { chromium } = require(process.env.FLOWBUDGET_PLAYWRIGHT || 'playwright')
const assert = require('node:assert/strict')
const fs = require('node:fs')

async function main() {
  const base = process.env.FLOWBUDGET_TEST_URL || 'http://127.0.0.1:5173'
  if (!new URL(base).hostname.match(/^(127\.0\.0\.1|localhost)$/)) throw new Error('This script is restricted to a local verification database.')
  const password = process.env.FLOWBUDGET_TEST_PASSWORD
  if (!password) throw new Error('Set FLOWBUDGET_TEST_PASSWORD')
  const request = async (path, token, method = 'GET', body) => {
    const res = await fetch(base + path, { method, headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) }, ...(body ? { body: JSON.stringify(body) } : {}) })
    if (!res.ok) throw new Error(`${method} ${path}: ${res.status}`)
    return res.status === 204 ? null : res.json()
  }
  const owner = await request('/api/auth/login', null, 'POST', { email: 'omarsolanki46@gmail.com', password })
  const email = `ui-member-${Date.now()}@example.com`
  const subject = `Mobile feedback verification ${Date.now()}`
  const member = await request('/api/admin/users', owner.token, 'POST', { username: 'UI collaborator', email, password })
  const memberAuth = await request('/api/auth/login', null, 'POST', { email, password })
  const wallet = (await request('/api/wallets', owner.token))[0]
  const walletShare = await request(`/api/shared/wallets/${wallet.id}/shares`, owner.token, 'POST', { email, permission: 'edit' })
  await request('/api/feedback', memberAuth.token, 'POST', { subject, content: 'The new Notes screen is useful. Please keep the balance visible on mobile.', category: 'suggestion' })
  fs.mkdirSync('.verification', { recursive: true })
  let browser
  const errors = []
  let noteId, folderId
  try {
    browser = await chromium.launch({ headless: true, channel: process.env.FLOWBUDGET_BROWSER_CHANNEL || 'msedge' })
    const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } })
    page.on('pageerror', e => errors.push(e.message))
    await page.goto(base)
    await page.getByRole('textbox', { name: 'Email', exact: true }).fill('omarsolanki46@gmail.com')
    await page.getByRole('textbox', { name: 'Password', exact: true }).fill(password)
    await page.getByRole('button', { name: 'Sign in', exact: true }).click()
    await page.getByRole('link', { name: 'Notes', exact: true }).click()
    await page.getByRole('button', { name: 'New folder', exact: true }).click()
    await page.getByLabel('Folder name').fill('Project notes')
    await page.getByRole('button', { name: 'Save folder', exact: true }).click()
    await page.getByRole('button', { name: 'Project notes', exact: true }).click()
    folderId = (await request('/api/note-folders', owner.token)).find(f => f.name === 'Project notes').id
    await page.getByRole('button', { name: 'New note', exact: true }).click()
    await page.getByLabel('Note title', { exact: true }).fill('September planning')
    await page.getByLabel('Note content', { exact: true }).fill('Plan shared expenses.\nReview monthly goals together.')
    await page.getByRole('button', { name: 'Save', exact: true }).click()
    await page.getByText('Note saved', { exact: true }).waitFor()
    noteId = (await request('/api/notes', owner.token)).find(n => n.title === 'September planning').id
    await page.getByRole('button', { name: 'Share note', exact: true }).click()
    await page.getByLabel('Account email', { exact: true }).fill(email)
    await page.locator('.modal select').selectOption('edit')
    await page.locator('form').getByRole('button', { name: 'Share note', exact: true }).click()
    await page.getByText('Note access updated', { exact: true }).waitFor()
    await page.locator('.modal-head .icon-button').click()
    await page.locator('.modal-backdrop').waitFor({ state: 'hidden' })
    await page.screenshot({ path: '.verification/notes-desktop.png', fullPage: true })
    const mobile = await browser.newPage({ viewport: { width: 390, height: 844 }, isMobile: true, deviceScaleFactor: 1 })
    mobile.on('pageerror', e => errors.push(e.message))
    await mobile.goto(base)
    await mobile.getByRole('textbox', { name: 'Email', exact: true }).fill(email)
    await mobile.getByRole('textbox', { name: 'Password', exact: true }).fill(password)
    await mobile.getByRole('button', { name: 'Sign in', exact: true }).click()
    await mobile.locator('.signout-button').waitFor({ state: 'visible' })
    await mobile.goto(base + '/#/notes')
    await mobile.getByRole('button', { name: 'Shared notes', exact: true }).click()
    await mobile.getByRole('button', { name: /September planning/ }).click()
    await mobile.getByLabel('Note content', { exact: true }).fill('Updated by collaborator from a mobile browser.')
    await mobile.getByRole('button', { name: 'Save', exact: true }).click()
    await mobile.getByText('Note saved', { exact: true }).waitFor()
    assert.equal((await request('/api/notes', owner.token)).find(n => n.id === noteId).content, 'Updated by collaborator from a mobile browser.')
    await mobile.screenshot({ path: '.verification/notes-mobile.png', fullPage: true })
    assert(await mobile.evaluate(() => document.documentElement.scrollWidth <= innerWidth), 'Notes horizontal overflow')
    await mobile.goto(base + '/#/shared-transactions')
    const balance = mobile.locator('.shared-wallet-meta').first()
    await balance.getByText('Remaining', { exact: true }).waitFor({ state: 'visible' })
    assert(await balance.locator('strong').isVisible())
    await mobile.screenshot({ path: '.verification/shared-mobile.png', fullPage: true })
    await page.goto(base + '/#/feedback')
    await page.getByRole('button', { name: new RegExp(subject) }).click()
    await page.getByLabel('Reply to user', { exact: true }).fill('Thanks! We have kept the balance visible.')
    await page.locator('.feedback-reply select').selectOption('resolved')
    await page.getByRole('button', { name: 'Save reply & status', exact: true }).click()
    await page.getByText('Feedback updated', { exact: true }).waitFor()
    await page.screenshot({ path: '.verification/feedback-desktop.png', fullPage: true })
    await mobile.goto(base + '/#/feedback')
    await mobile.getByRole('button', { name: new RegExp(subject) }).click()
    await mobile.getByText('Thanks! We have kept the balance visible.', { exact: true }).waitFor()
    await mobile.screenshot({ path: '.verification/feedback-mobile.png', fullPage: true })
    assert(await mobile.evaluate(() => document.documentElement.scrollWidth <= innerWidth), 'Feedback horizontal overflow')
    await mobile.locator('.signout-button').click()
    await mobile.getByRole('heading', { name: 'Sign in to FlowBudget' }).waitFor()
    assert(await mobile.locator('.brand-logo').evaluate(img => img.complete && img.naturalWidth > 0), 'Logo missing')
    assert.deepEqual(errors, [])
    console.log('PASS: folder creation, notes, edit sharing, mobile balance/logout, feedback reply, responsive layouts, logo, no browser errors.')
  } catch (error) {
    for (const [index, page] of (browser?.contexts().flatMap(c => c.pages()) || []).entries()) {
      await page.screenshot({ path: `.verification/failure-${index}.png`, fullPage: true })
    }
    throw error
  } finally {
    await browser?.close()
    if (noteId) await request(`/api/notes/${noteId}`, owner.token, 'DELETE')
    if (folderId) await request(`/api/note-folders/${folderId}`, owner.token, 'DELETE')
    await request(`/api/shared/shares/${walletShare.id}`, owner.token, 'DELETE')
    await request(`/api/admin/users/${member.id}`, owner.token, 'DELETE')
  }
}
main().catch(e => { console.error(e); process.exitCode = 1 })
