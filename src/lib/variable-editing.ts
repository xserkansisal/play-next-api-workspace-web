// Edits applied from the Variables menu to an environment's variable list.
//
// The menu only shows the *effective* environment definition of a name: the last enabled row
// (see `resolveVariables`). Disabled rows are invisible there, so they are never touched here;
// other enabled rows with the same key were already dead (shadowed by the last one) and are
// dropped, otherwise renaming or deleting the winner would silently resurrect an older value.

import type { EnvironmentVariable } from '@/lib/workspace-types'

export type VariableEditResult = { ok: true; variables: EnvironmentVariable[] } | { ok: false; error: string }

export function editEnvironmentVariable(
  variables: readonly EnvironmentVariable[],
  oldKey: string,
  newKey: string,
  value: string,
): VariableEditResult {
  const winner = findLastIndex(variables, (row) => row.enabled && row.key === oldKey)
  if (winner === -1) return { ok: false, error: `"${oldKey}" is no longer defined in this environment.` }
  if (newKey !== oldKey && variables.some((row) => row.enabled && row.key === newKey)) {
    return { ok: false, error: `"${newKey}" already exists in this environment.` }
  }
  const next: EnvironmentVariable[] = []
  variables.forEach((row, index) => {
    if (index === winner) next.push({ ...row, key: newKey, value })
    else if (!(row.enabled && row.key === oldKey)) next.push(row)
  })
  return { ok: true, variables: next }
}

export function removeEnvironmentVariable(variables: readonly EnvironmentVariable[], key: string): VariableEditResult {
  if (!variables.some((row) => row.enabled && row.key === key)) {
    return { ok: false, error: `"${key}" is no longer defined in this environment.` }
  }
  return { ok: true, variables: variables.filter((row) => !(row.enabled && row.key === key)) }
}

function findLastIndex<T>(items: readonly T[], predicate: (item: T) => boolean): number {
  for (let index = items.length - 1; index >= 0; index -= 1) if (predicate(items[index]!)) return index
  return -1
}
