import { useLayoutEffect, useRef, type InputHTMLAttributes } from 'react'

import { describeOrigin, type VariableResolution } from '@/lib/variable-scopes'
import { tokenizeTemplate, variableNames } from '@/lib/variable-tokens'

export type VariableLookup = Record<string, VariableResolution>

export function describeVariable(name: string, variables: VariableLookup): string {
  const entry = variables[name]
  if (!entry) return `{{${name}}} is not defined in the selected environment, your variables or global variables.`
  return `{{${name}}} = ${entry.value === '' ? '(empty)' : entry.value}  ·  from ${describeOrigin(entry.origin)}`
}

/**
 * A text input whose `{{variable}}` references are coloured: defined ones in the accent colour,
 * undefined ones in red. A native input cannot style part of its value, so the input's own text is
 * made transparent and an identically laid-out mirror behind it renders the coloured copy.
 */
export function VariableInput({ value, variables, className = '', onScroll, ...props }: Omit<InputHTMLAttributes<HTMLInputElement>, 'value'> & {
  value: string
  variables: VariableLookup
}) {
  const input = useRef<HTMLInputElement>(null)
  const mirror = useRef<HTMLSpanElement>(null)
  const sync = () => {
    if (input.current && mirror.current) mirror.current.scrollLeft = input.current.scrollLeft
  }
  useLayoutEffect(sync)

  const names = variableNames(value)
  const missing = [...new Set(names.filter((name) => !variables[name]))]
  const title = names.length
    ? [...new Set(names)].map((name) => describeVariable(name, variables)).join('\n')
    : undefined

  return (
    <span className={`var-field ${className}`} data-missing={missing.length > 0 || undefined}>
      <span className="var-field-inner">
      <span ref={mirror} className="var-field-mirror" aria-hidden="true">
        {tokenizeTemplate(value).map((segment) => segment.kind === 'text'
          ? <span key={segment.from}>{segment.text}</span>
          : <span key={segment.from} className={variables[segment.name] ? 'var-token found' : 'var-token missing'}>{segment.text}</span>)}
        {/* Keeps a trailing space measurable so the caret and mirror stay aligned. */}
        <span>{'\u200b'}</span>
      </span>
      <input
        ref={input}
        {...props}
        value={value}
        title={title ?? props.title}
        aria-invalid={missing.length > 0 || undefined}
        onScroll={(event) => { sync(); onScroll?.(event) }}
        onSelect={sync}
        onKeyUp={sync}
        className="var-field-input"
      />
      </span>
    </span>
  )
}
