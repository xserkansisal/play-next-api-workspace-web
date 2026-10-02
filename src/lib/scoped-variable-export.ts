import type { ScopedVariable, VariableScope } from '@/lib/variable-scopes'

export const SCOPED_VARIABLE_EXPORT_FORMAT = 'play-next-api-workspace-variables'
export const SCOPED_VARIABLE_EXPORT_VERSION = 1

/**
 * Serializes one personal or global scope in the app's own portable JSON format.
 *
 * Values are intentionally included as plain text, just like environment exports.
 */
export function exportScopedVariables(
  scope: VariableScope,
  variables: readonly ScopedVariable[],
): Record<string, unknown> {
  return {
    format: SCOPED_VARIABLE_EXPORT_FORMAT,
    version: SCOPED_VARIABLE_EXPORT_VERSION,
    scope,
    variables: variables
      .filter((variable) => variable.scope === scope)
      .map(({ key, value }) => ({ key, value })),
  }
}
