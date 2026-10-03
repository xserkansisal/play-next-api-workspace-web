import { useEffect, useRef, useState, type CSSProperties, type KeyboardEvent } from 'react'
import { createPortal } from 'react-dom'

export interface RequestLocationOption {
  value: string
  label: string
  collectionId: string
  parentId?: string
}

interface RequestLocationPickerProps {
  options: RequestLocationOption[]
  value: string
  onChange: (option: RequestLocationOption) => void
  disabled?: boolean
}

export function RequestLocationPicker({ options, value, onChange, disabled = false }: RequestLocationPickerProps) {
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  const [popoverStyle, setPopoverStyle] = useState<CSSProperties>({})
  const pickerRef = useRef<HTMLDivElement>(null)
  const popoverRef = useRef<HTMLDivElement>(null)
  const triggerRef = useRef<HTMLButtonElement>(null)
  const searchRef = useRef<HTMLInputElement>(null)
  const optionRefs = useRef<Array<HTMLButtonElement | null>>([])
  const selected = options.find((option) => option.value === value)
  const filteredOptions = options.filter(({ label }) => label.toLowerCase().includes(query.trim().toLowerCase()))

  useEffect(() => {
    if (!open) return
    searchRef.current?.focus()

    const positionPopover = () => {
      const trigger = triggerRef.current
      if (!trigger) return
      const bounds = trigger.getBoundingClientRect()
      const viewportPadding = 12
      const width = Math.min(440, window.innerWidth - viewportPadding * 2)
      const left = Math.max(viewportPadding, Math.min(bounds.left, window.innerWidth - width - viewportPadding))
      const below = window.innerHeight - bounds.bottom - viewportPadding
      const above = bounds.top - viewportPadding
      const placeBelow = below >= Math.min(300, above) || below >= above
      const availableHeight = Math.max(120, Math.min(360, placeBelow ? below : above))
      setPopoverStyle({
        position: 'fixed',
        left,
        width,
        maxHeight: availableHeight,
        ...(placeBelow
          ? { top: bounds.bottom + 6 }
          : { bottom: window.innerHeight - bounds.top + 6 }),
      })
    }
    positionPopover()
    window.addEventListener('resize', positionPopover)
    window.addEventListener('scroll', positionPopover, true)

    function closeOnOutsideClick(event: PointerEvent) {
      if (
        event.target instanceof Node
        && !pickerRef.current?.contains(event.target)
        && !popoverRef.current?.contains(event.target)
      ) closePicker()
    }

    document.addEventListener('pointerdown', closeOnOutsideClick)
    return () => {
      window.removeEventListener('resize', positionPopover)
      window.removeEventListener('scroll', positionPopover, true)
      document.removeEventListener('pointerdown', closeOnOutsideClick)
    }
  }, [open])

  function closePicker(restoreFocus = false) {
    setOpen(false)
    setQuery('')
    if (restoreFocus) triggerRef.current?.focus()
  }

  function focusOption(index: number) {
    if (filteredOptions.length === 0) return
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
    <div className={`request-location-picker ${open ? 'open' : ''}`} ref={pickerRef}>
      <button
        className="request-location-trigger"
        type="button"
        role="combobox"
        aria-label="Request location"
        aria-valuetext={selected?.label ?? 'Choose a location'}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls="request-location-options"
        title={selected?.label}
        disabled={disabled}
        onClick={() => open ? closePicker() : setOpen(true)}
        onKeyDown={handleTriggerKeyDown}
        ref={triggerRef}
      >
        <span className="request-location-value">{selected?.label ?? 'Choose a location'}</span>
        <svg className="request-location-chevron" viewBox="0 0 16 16" aria-hidden="true">
          <path d="m4 6 4 4 4-4" />
        </svg>
      </button>
      {open && (
        createPortal(<div className="request-location-popover" style={popoverStyle} ref={popoverRef}>
          <label className="request-location-search">
            <svg viewBox="0 0 16 16" aria-hidden="true">
              <circle cx="7" cy="7" r="4.5" />
              <path d="m10.5 10.5 3 3" />
            </svg>
            <input
              ref={searchRef}
              type="search"
              aria-label="Search locations"
              placeholder="Search collections and folders…"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              onKeyDown={handleSearchKeyDown}
            />
            <kbd>ESC</kbd>
          </label>
          <div className="request-location-list" role="listbox" id="request-location-options" aria-label="Request locations">
            {filteredOptions.map((option, index) => (
              <button
                key={option.value}
                ref={(element) => { optionRefs.current[index] = element }}
                type="button"
                role="option"
                aria-selected={value === option.value}
                className={`request-location-option ${value === option.value ? 'selected' : ''}`}
                title={option.label}
                onClick={() => {
                  onChange(option)
                  closePicker(true)
                }}
                onKeyDown={(event) => handleOptionKeyDown(event, index)}
              >
                <span className="request-location-check" aria-hidden="true">{value === option.value ? '✓' : ''}</span>
                <span className="request-location-option-label">{option.label}</span>
              </button>
            ))}
            {filteredOptions.length === 0 && <p className="request-location-empty">No locations match “{query}”.</p>}
          </div>
          <div className="request-location-footer">{options.length} {options.length === 1 ? 'location' : 'locations'}</div>
        </div>, document.body)
      )}
    </div>
  )
}
