import type { EnvironmentResource } from '@/lib/workspace-types'

/**
 * Explains *why* each `{{variable}}` in a request could not be resolved.
 *
 * Every unresolved variable used to produce the same "define it in the selected environment"
 * sentence, which is actively misleading when no environment is selected, and unhelpful when the
 * variable does exist but is switched off or lives in a different environment. With dozens of
 * variables across several environments, "it is not defined" is not enough to act on.
 */
export interface VariableDiagnosis {
  name: string
  reason: 'no-environment' | 'disabled-here' | 'in-other-environment' | 'undefined'
  /** Environments (by name) that define this variable, for the reasons that name one. */
  definedIn: string[]
}

export function diagnoseMissingVariables(
  missing: readonly string[],
  environments: readonly EnvironmentResource[],
  selectedEnvironmentId: string,
): VariableDiagnosis[] {
  const selected = environments.find((environment) => environment.id === selectedEnvironmentId)
  return missing.map((name) => {
    const disabledHere = selected?.variables.some((variable) => variable.key === name && !variable.enabled) ?? false
    if (disabledHere) return { name, reason: 'disabled-here', definedIn: [selected!.name] }

    const definedIn = environments
      .filter((environment) => environment.id !== selectedEnvironmentId &&
        environment.variables.some((variable) => variable.key === name && variable.enabled))
      .map((environment) => environment.name)

    if (definedIn.length > 0) {
      return { name, reason: selected ? 'in-other-environment' : 'no-environment', definedIn }
    }
    return { name, reason: 'undefined', definedIn: [] }
  })
}

function list(names: readonly string[]): string {
  return names.map((name) => `{{${name}}}`).join(', ')
}

function quoted(names: readonly string[]): string {
  return names.map((name) => `"${name}"`).join(', ')
}

/** Builds the sentence shown when a request is blocked because variables did not resolve. */
export function describeMissingVariables(diagnoses: readonly VariableDiagnosis[]): string {
  const parts: string[] = []

  const undefinedAnywhere = diagnoses.filter((entry) => entry.reason === 'undefined')
  const disabled = diagnoses.filter((entry) => entry.reason === 'disabled-here')
  const elsewhere = diagnoses.filter((entry) => entry.reason === 'in-other-environment')
  const noEnvironment = diagnoses.filter((entry) => entry.reason === 'no-environment')

  if (noEnvironment.length > 0) {
    const names = [...new Set(noEnvironment.flatMap((entry) => entry.definedIn))]
    parts.push(`${list(noEnvironment.map((entry) => entry.name))} ${noEnvironment.length > 1 ? 'are' : 'is'} defined in ${quoted(names)}, but no environment is selected. Choose one in the environment picker.`)
  }

  if (elsewhere.length > 0) {
    const names = [...new Set(elsewhere.flatMap((entry) => entry.definedIn))]
    parts.push(`${list(elsewhere.map((entry) => entry.name))} ${elsewhere.length > 1 ? 'are' : 'is'} not in the selected environment, but ${elsewhere.length > 1 ? 'are' : 'is'} defined in ${quoted(names)}. Switch environment, or add ${elsewhere.length > 1 ? 'them' : 'it'} here.`)
  }

  if (disabled.length > 0) {
    parts.push(`${list(disabled.map((entry) => entry.name))} ${disabled.length > 1 ? 'are' : 'is'} defined in the selected environment but switched off. Enable ${disabled.length > 1 ? 'them' : 'it'} in Environments.`)
  }

  if (undefinedAnywhere.length > 0) {
    const names = undefinedAnywhere.map((entry) => entry.name)
    parts.push(`${list(names)} ${names.length > 1 ? 'are' : 'is'} not defined in any environment. Add ${names.length > 1 ? 'them' : 'it'} in Environments, or capture ${names.length > 1 ? 'them' : 'it'} from a response with "Save a value as a variable".`)
  }

  return `${parts.join(' ')} Request was not sent.`
}
