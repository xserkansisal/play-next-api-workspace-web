import { useEffect, useRef, useState } from 'react'
import type { KeyboardEvent } from 'react'

import type { EnvironmentResource } from '@/lib/workspace-types'

interface EnvironmentPickerProps {
  environments: EnvironmentResource[]
  value: string
  onChange: (environmentId: string) => void
}

export function EnvironmentPicker({ environments, value, onChange }: EnvironmentPickerProps) {
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  const pickerRef = useRef<HTMLDivElement>(null)
  const triggerRef = useRef<HTMLButtonElement>(null)
  const searchRef = useRef<HTMLInputElement>(null)
  const optionRefs = useRef<Array<HTMLButtonElement | null>>([])
  const selectedEnvironment = environments.find(({ id }) => id === value)
  const options = [
    { id: '', name: 'No environment' },
    ...environments.map(({ id, name }) => ({ id, name })),
  ]
  const filteredOptions = options.filter(({ name }) => name.toLowerCase().includes(query.trim().toLowerCase()))

  useEffect(() => {
    if (!open) return
    searchRef.current?.focus()

    function closeOnOutsideClick(event: PointerEvent) {
      if (event.target instanceof Node && !pickerRef.current?.contains(event.target)) {
        setOpen(false)
        setQuery('')
      }
    }

    document.addEventListener('pointerdown', closeOnOutsideClick)
    return () => document.removeEventListener('pointerdown', closeOnOutsideClick)
  }, [open])

  function closePicker(restoreFocus = false) {
    setOpen(false)
    setQuery('')
    if (restoreFocus) triggerRef.current?.focus()
  }

  function focusOption(index: number) {
    const boundedIndex = Math.max(0, Math.min(index, filteredOptions.length - 1))
    optionRefs.current[boundedIndex]?.focus()
  }

  function handleTriggerKeyDown(event: KeyboardEvent<HTMLButtonElement>) {
    if (event.key !== 'ArrowDown' && event.key !== 'ArrowUp') return
    event.preventDefault()
    setOpen(true)
  }

  function handleSearchKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    if (event.key === 'ArrowDown') {
      event.preventDefault()
      focusOption(0)
    } else if (event.key === 'Escape') {
      event.preventDefault()
      closePicker(true)
    }
  }

  function handleOptionKeyDown(event: KeyboardEvent<HTMLButtonElement>, index: number) {
    if (event.key === 'ArrowDown') {
      event.preventDefault()
      focusOption((index + 1) % filteredOptions.length)
    } else if (event.key === 'ArrowUp') {
      event.preventDefault()
      if (index === 0) searchRef.current?.focus()
      else focusOption(index - 1)
    } else if (event.key === 'Escape') {
      event.preventDefault()
      closePicker(true)
    }
  }

  return (
    <div className={`env-picker ${open ? 'open' : ''}`} ref={pickerRef}>
      <button
        className="env-picker-trigger"
        type="button"
        role="combobox"
        aria-label="Environment"
        aria-valuetext={selectedEnvironment?.name ?? 'No environment'}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls="environment-options"
        onClick={() => {
          if (open) closePicker()
          else setOpen(true)
        }}
        onKeyDown={handleTriggerKeyDown}
        ref={triggerRef}
      >
        <span className={`env-dot ${selectedEnvironment ? 'active' : ''}`} aria-hidden="true" />
        <span className="env-picker-value">{selectedEnvironment?.name ?? 'No environment'}</span>
        <svg className="env-picker-chevron" viewBox="0 0 16 16" aria-hidden="true">
          <path d="m4 6 4 4 4-4" />
        </svg>
      </button>
      {open && (
        <div className="env-picker-popover">
          <label className="env-picker-search">
            <svg viewBox="0 0 16 16" aria-hidden="true">
              <circle cx="7" cy="7" r="4.5" />
              <path d="m10.5 10.5 3 3" />
            </svg>
            <input
              ref={searchRef}
              type="search"
              aria-label="Search environments"
              placeholder="Search environments..."
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              onKeyDown={handleSearchKeyDown}
            />
            <kbd>ESC</kbd>
          </label>
          <div className="env-picker-list" role="listbox" id="environment-options" aria-label="Environments">
            {filteredOptions.map((option, index) => (
              <button
                key={option.id || 'none'}
                ref={(element) => { optionRefs.current[index] = element }}
                type="button"
                role="option"
                aria-selected={value === option.id}
                className={`env-picker-option ${value === option.id ? 'selected' : ''}`}
                onClick={() => {
                  onChange(option.id)
                  closePicker(true)
                }}
                onKeyDown={(event) => handleOptionKeyDown(event, index)}
              >
                <span className="env-picker-check" aria-hidden="true">{value === option.id ? '✓' : ''}</span>
                <span className="env-picker-option-copy">
                  <span className="env-picker-option-name">{option.name}</span>
                  {option.id && <span className="env-picker-option-meta">Environment</span>}
                </span>
              </button>
            ))}
            {filteredOptions.length === 0 && <p className="env-picker-empty">No environments match “{query}”.</p>}
          </div>
          <div className="env-picker-footer">{environments.length} {environments.length === 1 ? 'environment' : 'environments'}</div>
        </div>
      )}
    </div>
  )
}
