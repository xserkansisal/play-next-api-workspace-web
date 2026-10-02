import { CompletionContext, type Completion } from '@codemirror/autocomplete'
import { EditorState } from '@codemirror/state'
import { EditorView } from '@codemirror/view'
import { describe, expect, it } from 'vitest'

import { variableCompletionSource } from '@/components/JsonEditor'
import type { VariableLookup } from '@/components/VariableInput'

const variables: VariableLookup = {
  userId: { value: '42', origin: 'user', shadowed: [] },
  tenantId: { value: 'acme', origin: 'environment', shadowed: [] },
}

function complete(doc: string, pos = doc.length) {
  const state = EditorState.create({ doc })
  return { state, result: variableCompletionSource(() => variables)(new CompletionContext(state, pos, false)) }
}

describe('variableCompletionSource', () => {
  it('offers variables after {{ and filters by what was typed', () => {
    expect(complete('{"a": "x"}').result).toBeNull()
    expect(complete('{"a": "{{').result?.options.map((option) => option.displayLabel)).toEqual(['userId', 'tenantId'])
    expect(complete('{"a": "{{ten').result?.options.map((option) => option.displayLabel)).toEqual(['tenantId'])
  })

  it('inserts a closed reference without doubling existing braces', () => {
    const doc = '{"a": "{{ten}}"}'
    const { state, result } = complete(doc, 12)
    const view = new EditorView({ state })
    const option = result!.options[0] as Completion & { apply: (view: EditorView, completion: Completion, from: number, to: number) => void }
    option.apply(view, option, result!.from, result!.to ?? 12)
    expect(view.state.doc.toString()).toBe('{"a": "{{tenantId}}"}')
    view.destroy()
  })
})
