import postcss from 'postcss'
import { afterEach, expect, test } from 'vitest'
import motionCss from '../motion.css?raw'

const stylesheet = postcss.parse(motionCss)
const entrances = []
stylesheet.walkRules(rule => {
  if (rule.nodes.some(node => node.prop === 'animation' && node.value.includes('budgetly-lateral'))) entrances.push(rule)
})
const moving = () => [...new Set(entrances.flatMap(rule => [...document.querySelectorAll(rule.selector)]))]
afterEach(() => { document.body.innerHTML = ''; delete document.documentElement.dataset.motion })

test('page entrances target safe content, never wrappers or fixed/sticky controls, and never nest', () => {
  document.body.innerHTML = `<main class="budgetly-v2"><div class="page-wrap">
    <div class="overview-page"><section class="overview-balance"></section><div class="overview-columns"><section class="overview-section"></section></div></div>
    <div class="workspace notes-workspace"><section class="workspace-list"><header class="notes-library-header"></header><div class="note-collection"><button class="message-row note-row"></button></div></section><section class="workspace-reader"><div class="reader-empty"></div></section><button class="notes-new-note" style="position:fixed"></button></div>
    <section class="ai-workspace"><div class="ai-messages"><article class="ai-turn"><div class="ai-answer"></div></article></div><form class="ai-composer"></form></section>
    <section class="upcoming-page"><header class="upcoming-toolbar"></header><div class="upcoming-records"><article class="upcoming-record"></article></div></section>
    <div class="calendar-layout"><section class="panel calendar-panel"></section><aside class="day-panel" style="position:sticky"><div class="stack"><div class="day-tx"></div></div></aside></div>
    <section class="ledger-page"><header class="ledger-toolbar" style="position:fixed"></header><div class="ledger-list"><article class="ledger-entry"></article></div></section>
    <section class="settings-workspace"><section class="settings-section"><div class="panel"></div></section></section>
  </div></main>`
  const targets = moving()
  for (const selector of ['.overview-balance', '.overview-section', '.note-row', '.reader-empty', '.ai-turn', '.upcoming-record', '.calendar-panel', '.day-tx', '.ledger-entry']) {
    expect(targets).toContain(document.querySelector(selector))
  }
  for (const target of targets) {
    expect(target.querySelector('[style*="position:fixed"], [style*="position:sticky"]')).toBeNull()
    expect(target.closest('.settings-workspace')).toBeNull()
    expect(targets.some(other => other !== target && target.contains(other))).toBe(false)
  }
  expect(targets).not.toContain(document.querySelector('.page-wrap'))
})

test('repeated rows stop at four and app reduced/off select no moving surfaces', () => {
  document.body.innerHTML = `<div class="budgetly-v2"><div class="page-wrap"><div class="upcoming-records">${Array.from({ length: 8 }, () => '<article class="upcoming-record"></article>').join('')}</div></div></div>`
  expect(moving()).toHaveLength(4)
  for (const mode of ['reduced', 'off']) {
    document.documentElement.dataset.motion = mode
    expect(moving()).toHaveLength(0)
  }
  for (const rule of entrances) {
    expect(rule.parent.params).toBe('(prefers-reduced-motion:no-preference)')
    const animation = rule.nodes.find(node => node.prop === 'animation').value
    expect(animation).not.toMatch(/\b(forwards|both|infinite)\b/)
  }
})
