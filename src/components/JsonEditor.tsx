import { autocompletion, type Completion, type CompletionContext } from '@codemirror/autocomplete'
import { json } from '@codemirror/lang-json'
import { EditorState, RangeSetBuilder, StateEffect } from '@codemirror/state'
import { Decoration, EditorView, ViewPlugin, hoverTooltip, lineNumbers, type DecorationSet, type ViewUpdate } from '@codemirror/view'
import { useContext, useEffect, useRef } from 'react'

import { describeVariable, type VariableLookup } from '@/components/VariableInput'
import { VariableCreationContext, type VariableCreationContextValue } from '@/components/VariableAutocomplete'
import { findCompletionContext, originLabel, previewValue, suggestVariables } from '@/lib/variable-completion'
import { describeOrigin, validateVariableName, VARIABLE_PRECEDENCE } from '@/lib/variable-scopes'
import { tokenizeTemplate } from '@/lib/variable-tokens'

interface JsonEditorProps {
  value: string
  onChange: (value: string) => void
  variables?: VariableLookup
  readOnly?: boolean
}

const refreshVariables = StateEffect.define<null>()
const foundMark = Decoration.mark({ class: 'cm-var-token cm-var-found' })
const missingMark = Decoration.mark({ class: 'cm-var-token cm-var-missing' })

function variableHighlighter(lookup: () => VariableLookup) {
  const build = (view: EditorView): DecorationSet => {
    const builder = new RangeSetBuilder<Decoration>()
    const variables = lookup()
    for (const { from, to } of view.visibleRanges) {
      for (const segment of tokenizeTemplate(view.state.doc.sliceString(from, to))) {
        if (segment.kind !== 'variable') continue
        const start = from + segment.from
        builder.add(start, start + segment.text.length, variables[segment.name] ? foundMark : missingMark)
      }
    }
    return builder.finish()
  }
  return [
    ViewPlugin.fromClass(class {
      decorations: DecorationSet
      constructor(view: EditorView) { this.decorations = build(view) }
      update(update: ViewUpdate) {
        if (update.docChanged || update.viewportChanged || update.transactions.some((tr) => tr.effects.some((effect) => effect.is(refreshVariables)))) {
          this.decorations = build(update.view)
        }
      }
    }, { decorations: (plugin) => plugin.decorations }),
    hoverTooltip((view, pos) => {
      const line = view.state.doc.lineAt(pos)
      const segment = tokenizeTemplate(line.text).find((entry) =>
        entry.kind === 'variable' && pos >= line.from + entry.from && pos <= line.from + entry.from + entry.text.length)
      if (!segment || segment.kind !== 'variable') return null
      const variables = lookup()
      return {
        pos: line.from + segment.from,
        end: line.from + segment.from + segment.text.length,
        above: true,
        create: () => {
          const dom = document.createElement('div')
          dom.className = variables[segment.name] ? 'cm-var-tooltip found' : 'cm-var-tooltip missing'
          dom.textContent = describeVariable(segment.name, variables)
          return { dom }
        },
      }
    }),
  ]
}

/** Same `{{` picker as `VariableInput`, built on CodeMirror's own completion UI. */
export function variableCompletionSource(lookup: () => VariableLookup, creation?: VariableCreationContextValue) {
  return (context: CompletionContext) => {
    const line = context.state.doc.lineAt(context.pos)
    const found = findCompletionContext(line.text, context.pos - line.from)
    if (!found) return null
    const from = line.from + found.from
    const after = context.state.sliceDoc(context.pos, Math.min(line.to, context.pos + 200))
    const tail = /^[^{}\s]*\s*\}\}/.exec(after)
    const to = context.pos + (tail ? tail[0].length : 0)
    const suggestions = suggestVariables(lookup(), found.query)
    const options: Completion[] = suggestions.map((suggestion, index) => ({
      label: `{{${suggestion.name}}}`,
      displayLabel: suggestion.name,
      detail: previewValue(suggestion.name, suggestion.value),
      info: `from ${describeOrigin(suggestion.origin)}${suggestion.shadowed.length ? ` · overrides ${suggestion.shadowed.map(describeOrigin).join(', ')}` : ''}`,
      type: `variable ${suggestion.origin}`,
      section: found.query.trim() ? undefined : { name: originLabel(suggestion.origin), rank: VARIABLE_PRECEDENCE.indexOf(suggestion.origin) },
      boost: -index,
      apply: (view, _completion, applyFrom) => {
        const insert = `{{${suggestion.name}}}`
        view.dispatch({ changes: { from: applyFrom, to, insert }, selection: { anchor: applyFrom + insert.length }, userEvent: 'input.complete' })
      },
    }))
    const validatedName = validateVariableName(found.query)
    if (!suggestions.length && creation && validatedName.ok) {
      for (const { origin, label } of creation.options) {
        options.push({
          label: `Create "${validatedName.name}" in ${label}…`,
          displayLabel: `Create ${validatedName.name} in ${label}`,
          type: 'variable-create',
          apply: (view, _completion, applyFrom) => {
            const insert = `{{${validatedName.name}}}`
            view.dispatch({ changes: { from: applyFrom, to, insert }, selection: { anchor: applyFrom + insert.length }, userEvent: 'input.complete' })
            creation.onCreate(validatedName.name, origin)
          },
        })
      }
    }
    // Ordering and filtering are already done by suggestVariables; CodeMirror must not re-filter.
    return { from, to, options, filter: false }
  }
}

const NO_VARIABLES: VariableLookup = {}

export function JsonEditor({ value, onChange, variables = NO_VARIABLES, readOnly = false }: JsonEditorProps) {
  const host = useRef<HTMLDivElement>(null)
  const view = useRef<EditorView | null>(null)
  const onChangeRef = useRef(onChange)
  onChangeRef.current = onChange
  const variablesRef = useRef(variables)
  variablesRef.current = variables
  const onCreateVariable = useContext(VariableCreationContext)
  const onCreateVariableRef = useRef(onCreateVariable)
  onCreateVariableRef.current = onCreateVariable

  useEffect(() => {
    if (!host.current) return
    const editor = new EditorView({
      state: EditorState.create({
        doc: value,
        extensions: [
          lineNumbers(),
          json(),
          EditorState.readOnly.of(readOnly),
          EditorView.editable.of(!readOnly),
          EditorView.lineWrapping,
          variableHighlighter(() => variablesRef.current),
          autocompletion({
            override: [variableCompletionSource(() => variablesRef.current, onCreateVariableRef.current ?? undefined)],
            activateOnTyping: true,
            icons: false,
          }),
          EditorView.updateListener.of((update) => {
            if (update.docChanged) onChangeRef.current(update.state.doc.toString())
          }),
          EditorView.theme({
            '&': { minHeight: '220px', fontSize: '13px', color: 'var(--foreground)', backgroundColor: 'var(--editor-bg)' },
            '.cm-content': { fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace' },
            '.cm-gutters': { backgroundColor: 'var(--editor-gutter-bg)', borderRight: '1px solid var(--editor-gutter-border)', color: 'var(--editor-gutter-text)' },
            '&.cm-focused': { outline: '2px solid #fbb02d', outlineOffset: '1px' },
          }),
        ],
      }),
      parent: host.current,
    })
    view.current = editor
    return () => {
      editor.destroy()
      view.current = null
    }
  }, [readOnly])

  useEffect(() => {
    const editor = view.current
    if (editor && editor.state.doc.toString() !== value) {
      editor.dispatch({
        changes: { from: 0, to: editor.state.doc.length, insert: value },
      })
    }
  }, [value])

  useEffect(() => {
    view.current?.dispatch({ effects: refreshVariables.of(null) })
  }, [variables])

  return <div className="json-editor" ref={host} aria-label="JSON request body" />
}
