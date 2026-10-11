import postcss from 'postcss'
import { afterEach, expect, it } from 'vitest'
import shellLayout from '../shell-layout.css?raw'
import overviewLayout from '../overview-layout.css?raw'
import layoutPolish from '../layout-polish.css?raw'

afterEach(() => { document.head.innerHTML = ''; document.body.innerHTML = '' })

function applyLayout(width) {
  const css = [shellLayout, overviewLayout, layoutPolish].join('\n')
  const root = postcss.parse(css)
  root.walkAtRules('media', rule => {
    const boundary = rule.params.match(/(min|max)-width:(\d+)px/)
    const matches = boundary && (boundary[1] === 'min' ? width >= Number(boundary[2]) : width <= Number(boundary[2]))
    if (matches) rule.replaceWith(...rule.nodes)
    else rule.remove()
  })
  const style = document.createElement('style')
  // JSDOM does not resolve custom properties or media queries in computed styles.
  style.textContent = root.toString().replaceAll(/var\(--overview-inset(?:,24px)?\)/g, width <= 820 ? '16px' : '24px')
  document.head.append(style)
  document.body.innerHTML = '<div class="budgetly-v2 sidebar-collapsed"><aside class="sidebar"><a class="nav-item"></a></aside><main class="main-area page-wrap"><section class="overview-page"><details class="overview-disclosure"><summary>Details</summary></details><div class="weekly-summary"><div class="weekly-totals"></div></div></section></main><footer class="app-footer"></footer></div>'
  return selector => getComputedStyle(document.querySelector(selector))
}

it('preserves desktop collapsed shell geometry and Overview padding and radius', () => {
  const style = applyLayout(1280)
  expect(style('.sidebar').width).toBe('76px')
  expect(style('.sidebar').padding).toBe('14px 10px')
  expect(style('.main-area').marginLeft).toBe('76px')
  expect(style('.app-footer').left).toBe('76px')
  expect(style('summary').padding).toBe('16px 24px')
  expect(style('.weekly-totals').padding).toBe('16px 24px')
  expect(style('.overview-page').borderRadius).toBe('8px')
  expect(style('.overview-page').overflow).toBe('clip')
})

it('preserves mobile shell touch targets and Overview inset', () => {
  const style = applyLayout(390)
  expect(style('.sidebar').padding).toBe('16px 12px')
  expect(style('.nav-item').minHeight).toBe('44px')
  expect(style('summary').padding).toBe('16px')
  expect(style('.weekly-totals').padding).toBe('16px')
  expect(style('.overview-page').borderRadius).toBe('8px')
})
