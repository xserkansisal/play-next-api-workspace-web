import { CompletionContext, type Completion } from '@codemirror/autocomplete'
import { EditorState } from '@codemirror/state'
import { EditorView } from '@codemirror/view'
import { describe, expect, it, vi } from 'vitest'

import type { VariableCreationContextValue } from '@/components/VariableAutocomplete'
import { variableCompletionSource } from '@/components/JsonEditor'
import type { VariableLookup } from '@/components/VariableInput'

const variables: VariableLookup = {
  userId: { value: '42', origin: 'user', shadowed: [] },
  tenantId: { value: 'acme', origin: 'environment', shadowed: [] },
}

function complete(doc: string, pos = doc.length, creation?: VariableCreationContextValue) {
  const state = EditorState.create({ doc })
  return { state, result: variableCompletionSource(() => variables, creation)(new CompletionContext(state, pos, false)) }
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

  it('offers a create action for an unmatched variable', () => {
    const onCreate = vi.fn()
    const creation: VariableCreationContextValue = {
      options: [
        { origin: 'user', label: 'Only me' },
        { origin: 'environment', label: 'Development' },
        { origin: 'global', label: 'Everyone' },
      ],
      onCreate,
    }
    const { state, result } = complete('{"a": "{{newToken', undefined, creation)
    expect(result!.options.map((option) => option.displayLabel)).toEqual([
      'Create newToken in Only me',
      'Create newToken in Development',
      'Create newToken in Everyone',
    ])
    const option = result!.options[1] as Completion & { apply: (view: EditorView, completion: Completion, from: number, to: number) => void }
    const view = new EditorView({ state })
    option.apply(view, option, result!.from, result!.to ?? 0)
    expect(onCreate).toHaveBeenCalledWith('newToken', 'environment')
    expect(view.state.doc.toString()).toBe('{"a": "{{newToken}}')
    view.destroy()
  })

  it('matches and replaces the full closed variable name when the caret is inside it', () => {
    const creation: VariableCreationContextValue = {
      options: [{ origin: 'user', label: 'Only me' }],
      onCreate: vi.fn(),
    }
    const doc = '{"a": "{{next-url}}"}'
    const caret = doc.indexOf('url') + 1
    const { state, result } = complete(doc, caret, creation)
    expect(result!.options.map((option) => option.displayLabel)).toEqual(['Create next-url in Only me'])
    const option = result!.options[0] as Completion & { apply: (view: EditorView, completion: Completion, from: number, to: number) => void }
    const view = new EditorView({ state })
    option.apply(view, option, result!.from, result!.to ?? caret)
    expect(view.state.doc.toString()).toBe('{"a": "{{next-url}}"}')
    view.destroy()
  })
})
