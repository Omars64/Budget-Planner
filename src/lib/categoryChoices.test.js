import { expect, it } from 'vitest'
import { categoryChoices } from './categoryChoices'

const rows = [
  { id: 1, name: 'Bills', kind: 'expense', space_id: null },
  { id: 2, name: ' Bills ', kind: 'expense', space_id: 7 },
  { id: 3, name: 'Bills', kind: 'income', space_id: 7 },
  { id: 4, name: 'Food  & Dining', kind: 'expense', space_id: null },
  { id: 5, name: 'food & dining', kind: 'expense', space_id: 7 },
]
it('deduplicates Space choices by name and kind, preferring Space-owned IDs', () => {
  expect(categoryChoices(rows, 7).map(row => row.id)).toEqual([2, 3, 5])
  expect(rows).toHaveLength(5)
})
it('preserves an existing legacy selection rather than rewriting its category', () => {
  expect(categoryChoices(rows, '7', '1').map(row => row.id)).toEqual([1, 3, 5])
})
it('leaves Personal categories unchanged', () => {
  expect(categoryChoices(rows, null)).toBe(rows)
})
