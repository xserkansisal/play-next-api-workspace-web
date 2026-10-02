import { createContext, useContext, useEffect, useId, useLayoutEffect, useState, type KeyboardEvent, type ReactNode, type RefObject } from 'react'
import { createPortal } from 'react-dom'

import { describeOrigin, validateVariableName, type VariableOrigin, type VariableResolution } from '@/lib/variable-scopes'
import {
  applyCompletion,
  findCompletionContext,
  originLabel,
  previewValue,
  suggestVariables,
  type VariableSuggestion,
} from '@/lib/variable-completion'

type TextControl = HTMLInputElement | HTMLTextAreaElement

const POPUP_WIDTH = 420
const POPUP_MAX_HEIGHT = 340

export interface VariableCreationOption {
  origin: VariableOrigin
  label: string
}

export interface VariableCreationContextValue {
  options: VariableCreationOption[]
  onCreate: (name: string, origin: VariableOrigin) => void
}

export const VariableCreationContext = createContext<VariableCreationContextValue | null>(null)

const MIRRORED_STYLES = [
  'boxSizing', 'width', 'height', 'overflowX', 'overflowY',
  'borderTopWidth', 'borderRightWidth', 'borderBottomWidth', 'borderLeftWidth', 'borderStyle',
  'paddingTop', 'paddingRight', 'paddingBottom', 'paddingLeft',
  'fontStyle', 'fontVariant', 'fontWeight', 'fontStretch', 'fontSize', 'lineHeight', 'fontFamily',
  'textAlign', 'textTransform', 'textIndent', 'letterSpacing', 'wordSpacing', 'tabSize',
] as const

/**
 * Viewport coordinates of `position` inside a text control. Native controls do not expose caret
 * geometry, so an off-screen div with the same box and font is laid out and measured instead.
 */
function caretCoordinates(element: TextControl, position: number): { left: number; top: number; height: number } {
  const rect = element.getBoundingClientRect()
  const style = window.getComputedStyle(element)
  const mirror = document.createElement('div')
  for (const property of MIRRORED_STYLES) mirror.style[property] = style[property]
  const isInput = element instanceof HTMLInputElement
  mirror.style.position = 'absolute'
  mirror.style.visibility = 'hidden'
  mirror.style.top = '0'
  mirror.style.left = '-9999px'
  mirror.style.whiteSpace = isInput ? 'pre' : 'pre-wrap'
  mirror.style.overflowWrap = isInput ? 'normal' : 'break-word'
  mirror.textContent = element.value.slice(0, position)
  const marker = document.createElement('span')
  marker.textContent = element.value.slice(position) || '.'
  mirror.appendChild(marker)
  document.body.appendChild(mirror)
  const lineHeight = Number.parseFloat(style.lineHeight) || Number.parseFloat(style.fontSize) * 1.3 || 16
  const coordinates = {
    left: rect.left + marker.offsetLeft - element.scrollLeft,
    top: rect.top + marker.offsetTop - element.scrollTop,
    height: lineHeight,
  }
  mirror.remove()
  if (isInput) {
    coordinates.top = rect.top
    coordinates.height = rect.height
  }
  return coordinates
}

/**
 * Prefers `insertText` so the completion is a single native edit the browser can undo; falls back
 * to setting the value and dispatching `input`, which React's onChange also observes.
 */
function replaceRange(element: TextControl, from: number, to: number, insert: string, expected: string, caret: number) {
  element.focus()
  element.setSelectionRange(from, to)
  let inserted = false
  try {
    inserted = typeof document.execCommand === 'function' && document.execCommand('insertText', false, insert)
  } catch {
    inserted = false
  }
  if (!inserted || element.value !== expected) {
    const prototype = element instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype
    Object.getOwnPropertyDescriptor(prototype, 'value')?.set?.call(element, expected)
    element.dispatchEvent(new Event('input', { bubbles: true }))
  }
  element.setSelectionRange(caret, caret)
}

const ORIGIN_ICON: Record<VariableOrigin, string> = { user: 'U', environment: 'E', global: 'G' }

function HighlightedName({ suggestion, query }: { suggestion: VariableSuggestion; query: string }) {
  const length = query.trim().length
  if (suggestion.matchIndex < 0 || !length) return <>{suggestion.name}</>
  const { name, matchIndex } = suggestion
  return <>{name.slice(0, matchIndex)}<mark>{name.slice(matchIndex, matchIndex + length)}</mark>{name.slice(matchIndex + length)}</>
}

interface PopupProps {
  id: string
  query: string
  suggestions: VariableSuggestion[]
  active: number
  hasVariables: boolean
  creationOptions: VariableCreationOption[]
  position: { left: number; top: number; placement: 'below' | 'above' }
  onHover: (index: number) => void
  onPick: (suggestion: VariableSuggestion) => void
  onCreate: (origin: VariableOrigin) => void
}

function SuggestionPopup({ id, query, suggestions, active, hasVariables, creationOptions, position, onHover, onPick, onCreate }: PopupProps) {
  const current = suggestions[active]
  useEffect(() => {
    document.getElementById(`${id}-option-${active}`)?.scrollIntoView?.({ block: 'nearest' })
  }, [id, active])

  return createPortal(
    <div
      className="var-suggest"
      data-placement={position.placement}
      style={{ left: position.left, top: position.top, width: POPUP_WIDTH }}
      // Keeps focus (and the caret) in the field while the list is clicked.
      onMouseDown={(event) => event.preventDefault()}
    >
      <div className="var-suggest-head">
        <span>Variables</span>
        <code>{`{{${query}`}</code>
      </div>
      {suggestions.length > 0 ? (
        <div className="var-suggest-list" id={id} role="listbox" aria-label="Variable suggestions">
          {suggestions.map((suggestion, index) => {
            const showGroup = !query.trim() && (index === 0 || suggestions[index - 1].origin !== suggestion.origin)
            return (
              <div key={suggestion.name} role="presentation">
                {showGroup && <div className="var-suggest-group" role="presentation">{originLabel(suggestion.origin)}</div>}
                <div
                  id={`${id}-option-${index}`}
                  role="option"
                  aria-selected={index === active}
                  className={index === active ? 'var-suggest-option active' : 'var-suggest-option'}
                  onMouseEnter={() => onHover(index)}
                  onClick={() => onPick(suggestion)}
                >
                  <span className="var-suggest-icon" aria-hidden="true">{ORIGIN_ICON[suggestion.origin]}</span>
                  <span className="var-suggest-main">
                    <span className="var-suggest-name"><HighlightedName suggestion={suggestion} query={query} /></span>
                    <span className="var-suggest-value">{previewValue(suggestion.name, suggestion.value)}</span>
                  </span>
                  <span className="var-suggest-meta">
                    <span className={`var-suggest-badge ${suggestion.origin}`}>{originLabel(suggestion.origin)}</span>
                    {suggestion.shadowed.length > 0 && <span className="var-suggest-shadow">overrides {originLabel(suggestion.shadowed[0])}</span>}
                  </span>
                </div>
              </div>
            )
          })}
        </div>
      ) : (
        <>
          <div className="var-suggest-empty" role="status">
            {query.trim()
              ? <><strong>{`{{${query.trim()}}}`}</strong>{' '}is not defined in the selected environment, your variables or global variables.</>
              : hasVariables ? 'No matching variables.' : 'No variables defined yet. Add them from the Variables menu or an environment.'}
          </div>
          {creationOptions.length > 0 && (
            <div className="var-suggest-list" id={id} role="listbox" aria-label="Variable suggestions">
              {creationOptions.map(({ origin, label }, index) => (
                <button
                  id={`${id}-option-${index}`}
                  type="button"
                  role="option"
                  aria-selected={active === index}
                  className={`var-suggest-option var-suggest-create${active === index ? ' active' : ''}`}
                  key={origin}
                  onMouseEnter={() => onHover(index)}
                  onClick={() => onCreate(origin)}
                >
                  <span className="var-suggest-icon" aria-hidden="true">+</span>
                  <span className="var-suggest-main">
                    <span className="var-suggest-name">Create “{query.trim()}” in {label}…</span>
                  </span>
                </button>
              ))}
            </div>
          )}
        </>
      )}
      {current && (
        <div className="var-suggest-detail">
          <strong>{current.name}</strong> · from {describeOrigin(current.origin)}
          {current.shadowed.length > 0 && <> · overrides {current.shadowed.map(describeOrigin).join(', ')}</>}
        </div>
      )}
      <div className="var-suggest-foot" aria-hidden="true">
        <span><kbd>↑</kbd> <kbd>↓</kbd> navigate</span>
        <span><kbd>Enter</kbd> / <kbd>Tab</kbd> {creationOptions.length > 0 && !suggestions.length ? 'create' : 'insert'}</span>
        <span><kbd>Esc</kbd> close</span>
      </div>
    </div>,
    document.body,
  )
}

export interface VariableAutocompleteHandlers<T extends TextControl> {
  onKeyDown: (event: KeyboardEvent<T>) => void
  onSelect: () => void
  onClick: () => void
  onFocus: () => void
  onBlur: () => void
  /** Call from the control's onChange so the caret is tracked together with the new value. */
  onValueChange: () => void
}

/**
 * Opens a variable picker when the user types `{{` in a text control. Shared by `VariableInput`
 * and the raw body textarea; the CodeMirror body editor uses `@codemirror/autocomplete` instead.
 */
export function useVariableAutocomplete<T extends TextControl>(
  ref: RefObject<T | null>,
  value: string,
  variables: Record<string, VariableResolution>,
): { handlers: VariableAutocompleteHandlers<T>; aria: Record<string, string | undefined>; popup: ReactNode } {
  const id = useId()
  const [focused, setFocused] = useState(false)
  const [caret, setCaret] = useState<number | null>(null)
  const [dismissedAt, setDismissedAt] = useState<number | null>(null)
  const [selection, setSelection] = useState({ key: '', index: 0 })
  const [position, setPosition] = useState<PopupProps['position'] | null>(null)
  const creation = useContext(VariableCreationContext)

  const context = focused && caret !== null ? findCompletionContext(value, Math.min(caret, value.length)) : null
  const open = context !== null && context.from !== dismissedAt
  const suggestions = open ? suggestVariables(variables, context.query) : []
  const validatedName = context ? validateVariableName(context.query) : null
  const creationOptions = suggestions.length === 0 && validatedName?.ok ? creation?.options ?? [] : []
  const key = context ? `${context.from}:${context.query}` : ''
  const active = selection.key === key ? Math.min(selection.index, Math.max((suggestions.length || creationOptions.length) - 1, 0)) : 0

  const readCaret = () => {
    const element = ref.current
    if (!element) return
    setCaret(element.selectionStart === element.selectionEnd ? element.selectionStart : null)
  }

  useEffect(() => {
    if (!context && dismissedAt !== null) setDismissedAt(null)
  }, [context, dismissedAt])

  const contextFrom = open ? context.from : null
  useLayoutEffect(() => {
    const element = ref.current
    if (contextFrom === null || !element) {
      setPosition(null)
      return
    }
    const place = () => {
      const coordinates = caretCoordinates(element, contextFrom)
      const below = coordinates.top + coordinates.height + 4
      const fitsBelow = below + POPUP_MAX_HEIGHT <= window.innerHeight || coordinates.top < POPUP_MAX_HEIGHT
      const left = Math.max(8, Math.min(coordinates.left, window.innerWidth - POPUP_WIDTH - 8))
      setPosition(fitsBelow
        ? { left, top: below, placement: 'below' }
        : { left, top: Math.max(8, coordinates.top - 4), placement: 'above' })
    }
    place()
    window.addEventListener('resize', place)
    window.addEventListener('scroll', place, true)
    return () => {
      window.removeEventListener('resize', place)
      window.removeEventListener('scroll', place, true)
    }
  }, [ref, contextFrom, value])

  const pick = (suggestion: VariableSuggestion) => {
    const element = ref.current
    if (!element || !context || caret === null) return
    const result = applyCompletion(element.value, context, caret, suggestion.name)
    replaceRange(element, context.from, result.to, result.insert, result.value, result.caret)
    setCaret(result.caret)
  }

  const create = (origin: VariableOrigin) => {
    const element = ref.current
    if (!creation || !validatedName?.ok || !element || !context || caret === null) return
    const result = applyCompletion(element.value, context, caret, validatedName.name)
    replaceRange(element, context.from, result.to, result.insert, result.value, result.caret)
    setCaret(result.caret)
    creation.onCreate(validatedName.name, origin)
  }

  const handlers: VariableAutocompleteHandlers<T> = {
    onKeyDown: (event) => {
      if (!open) return
      if (event.key === 'Escape') {
        event.preventDefault()
        event.stopPropagation()
        setDismissedAt(context.from)
        return
      }
      if (!suggestions.length) {
        if (creationOptions.length && (event.key === 'ArrowDown' || event.key === 'ArrowUp')) {
          event.preventDefault()
          const step = event.key === 'ArrowDown' ? 1 : -1
          setSelection({ key, index: (active + step + creationOptions.length) % creationOptions.length })
        } else if (creationOptions.length && (event.key === 'Enter' || event.key === 'Tab') && !event.shiftKey && !event.metaKey && !event.ctrlKey && !event.altKey) {
          event.preventDefault()
          event.stopPropagation()
          create(creationOptions[active].origin)
        }
        return
      }
      if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
        event.preventDefault()
        const step = event.key === 'ArrowDown' ? 1 : -1
        setSelection({ key, index: (active + step + suggestions.length) % suggestions.length })
      } else if ((event.key === 'Enter' || event.key === 'Tab') && !event.shiftKey && !event.metaKey && !event.ctrlKey && !event.altKey) {
        event.preventDefault()
        event.stopPropagation()
        pick(suggestions[active])
      }
    },
    onSelect: readCaret,
    onClick: readCaret,
    onValueChange: readCaret,
    onFocus: () => {
      setFocused(true)
      readCaret()
    },
    onBlur: () => setFocused(false),
  }

  const aria = {
    'aria-autocomplete': 'list',
    'aria-controls': open && (suggestions.length > 0 || creationOptions.length > 0) ? id : undefined,
    'aria-activedescendant': open && (suggestions.length > 0 || creationOptions.length > 0) ? `${id}-option-${active}` : undefined,
  }

  const popup = open && position
    ? <SuggestionPopup id={id} query={context.query} suggestions={suggestions} active={active}
        hasVariables={Object.keys(variables).length > 0} creationOptions={creationOptions} position={position}
        onHover={(index) => setSelection({ key, index })} onPick={pick} onCreate={create} />
    : null

  return { handlers, aria, popup }
}
