export function categoryChoices(categories, spaceId, selectedId) {
  if (spaceId == null) return categories
  const choices = new Map()
  const priority = category => String(category.id) === String(selectedId) ? 2
    : String(category.space_id) === String(spaceId) ? 1 : 0
  for (const category of categories) {
    const name = category.name.normalize('NFKC').trim().replace(/\s+/g, ' ').toLowerCase()
    const key = `${category.kind}:${name}`
    const previous = choices.get(key)
    // Keep historical selections intact; new entries prefer the Space's own category.
    if (!previous || priority(category) > priority(previous)) choices.set(key, category)
  }
  return [...choices.values()]
}
