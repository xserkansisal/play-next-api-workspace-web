export type DiffLine =
  | { type: 'same'; left: string; right: string; leftNo: number; rightNo: number }
  | { type: 'removed'; left: string; leftNo: number }
  | { type: 'added'; right: string; rightNo: number }

/**
 * Line diff (LCS) of two texts, in document order. Removals are listed before the additions that
 * replace them, so a changed line reads as "old, then new".
 */
export function diffLines(before: string, after: string): DiffLine[] {
  const a = before.split('\n')
  const b = after.split('\n')
  const rows = a.length + 1
  const cols = b.length + 1
  const lcs = new Uint32Array(rows * cols)
  for (let i = a.length - 1; i >= 0; i--) {
    for (let j = b.length - 1; j >= 0; j--) {
      lcs[i * cols + j] = a[i] === b[j]
        ? lcs[(i + 1) * cols + j + 1] + 1
        : Math.max(lcs[(i + 1) * cols + j], lcs[i * cols + j + 1])
    }
  }
  const out: DiffLine[] = []
  let i = 0
  let j = 0
  while (i < a.length && j < b.length) {
    if (a[i] === b[j]) {
      out.push({ type: 'same', left: a[i], right: b[j], leftNo: i + 1, rightNo: j + 1 })
      i++
      j++
    } else if (lcs[(i + 1) * cols + j] >= lcs[i * cols + j + 1]) {
      out.push({ type: 'removed', left: a[i], leftNo: i + 1 })
      i++
    } else {
      out.push({ type: 'added', right: b[j], rightNo: j + 1 })
      j++
    }
  }
  for (; i < a.length; i++) out.push({ type: 'removed', left: a[i], leftNo: i + 1 })
  for (; j < b.length; j++) out.push({ type: 'added', right: b[j], rightNo: j + 1 })
  return out
}

export function countChanges(lines: readonly DiffLine[]): { added: number; removed: number } {
  let added = 0
  let removed = 0
  for (const line of lines) {
    if (line.type === 'added') added++
    else if (line.type === 'removed') removed++
  }
  return { added, removed }
}
