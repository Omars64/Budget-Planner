export function mergeSettingsDraft(draft, previous, incoming) {
  const next = { ...incoming }
  for (const [key, value] of Object.entries(draft)) {
    if (JSON.stringify(value) !== JSON.stringify(previous[key])) next[key] = value
  }
  return next
}
