export type VariableMove = 'up' | 'down' | 'top' | 'bottom'

/** Keep previously known names while appending newly discovered ones predictably. */
export function mergeVariableOrder(order: readonly string[], visibleNames: readonly string[]): string[] {
  const merged = [...new Set(order)]
  const known = new Set(merged)
  const discovered = [...new Set(visibleNames)]
    .filter((name) => !known.has(name))
    .sort((a, b) => a < b ? -1 : a > b ? 1 : 0)
  return [...merged, ...discovered]
}

/** Moves a visible row without disturbing the relative order of the other names. */
export function moveVariable(order: readonly string[], name: string, move: VariableMove): string[] {
  const currentIndex = order.indexOf(name)
  if (currentIndex < 0 || (move === 'up' && currentIndex === 0) || (move === 'down' && currentIndex === order.length - 1)) {
    return [...order]
  }
  const next = [...order]
  next.splice(currentIndex, 1)
  if (move === 'top') next.unshift(name)
  else if (move === 'bottom') next.push(name)
  else next.splice(currentIndex + (move === 'up' ? -1 : 1), 0, name)
  return next
}

/** Places a dragged visible row immediately before its drop target. */
export function moveVariableBefore(order: readonly string[], dragged: string, target: string): string[] {
  if (dragged === target || !order.includes(dragged) || !order.includes(target)) return [...order]
  const next = order.filter((name) => name !== dragged)
  next.splice(next.indexOf(target), 0, dragged)
  return next
}

/** Reorders visible entries in-place while leaving hidden, previously known names in their slots. */
export function replaceVisibleVariableOrder(
  knownOrder: readonly string[],
  visibleOrder: readonly string[],
  visibleNames: readonly string[],
): string[] {
  const visible = new Set(visibleNames)
  const next = [...knownOrder]
  const replacements = visibleOrder[Symbol.iterator]()
  for (let index = 0; index < next.length; index++) {
    if (visible.has(next[index]!)) {
      const replacement = replacements.next()
      if (!replacement.done) next[index] = replacement.value
    }
  }
  for (const name of visibleOrder) if (!next.includes(name)) next.push(name)
  return next
}
