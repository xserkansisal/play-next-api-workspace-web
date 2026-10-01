import { json } from '@codemirror/lang-json'
import { EditorState, RangeSetBuilder, StateEffect } from '@codemirror/state'
import { Decoration, EditorView, ViewPlugin, hoverTooltip, lineNumbers, type DecorationSet, type ViewUpdate } from '@codemirror/view'
import { useEffect, useRef } from 'react'

import { describeVariable, type VariableLookup } from '@/components/VariableInput'
import { tokenizeTemplate } from '@/lib/variable-tokens'

interface JsonEditorProps {
  value: string
  onChange: (value: string) => void
  variables?: VariableLookup
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

const NO_VARIABLES: VariableLookup = {}

export function JsonEditor({ value, onChange, variables = NO_VARIABLES }: JsonEditorProps) {
  const host = useRef<HTMLDivElement>(null)
  const view = useRef<EditorView | null>(null)
  const onChangeRef = useRef(onChange)
  onChangeRef.current = onChange
  const variablesRef = useRef(variables)
  variablesRef.current = variables

  useEffect(() => {
    if (!host.current) return
    const editor = new EditorView({
      state: EditorState.create({
        doc: value,
        extensions: [
          lineNumbers(),
          json(),
          EditorView.lineWrapping,
          variableHighlighter(() => variablesRef.current),
          EditorView.updateListener.of((update) => {
            if (update.docChanged) onChangeRef.current(update.state.doc.toString())
          }),
          EditorView.theme({
            '&': { minHeight: '220px', fontSize: '13px', color: 'var(--foreground)', backgroundColor: 'var(--editor-bg)' },
            '.cm-content': { fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace' },
            '.cm-gutters': { backgroundColor: 'var(--editor-gutter-bg)', borderRight: '1px solid var(--editor-gutter-border)', color: 'var(--editor-gutter-text)' },
            '&.cm-focused': { outline: '2px solid #c4b5fd', outlineOffset: '1px' },
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
  }, [])

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
