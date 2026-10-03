import { Fragment, useEffect, useRef, useState } from 'react'
import type { KeyboardEvent } from 'react'

import type { Team } from '@/lib/teams'

interface TeamPickerProps {
  teams: Team[]
  value: string | null
  onChange?: (teamId: string) => void
}

function teamAccessLabel(team: Team): string {
  return team.isMember ? `${team.role[0]!.toUpperCase()}${team.role.slice(1)}` : 'Admin access'
}

export function TeamPicker({ teams, value, onChange }: TeamPickerProps) {
  const [open, setOpen] = useState(false)
  const pickerRef = useRef<HTMLDivElement>(null)
  const triggerRef = useRef<HTMLButtonElement>(null)
  const optionRefs = useRef<Array<HTMLButtonElement | null>>([])
  const selected = teams.find(({ id }) => id === value)
  const orderedTeams = [...teams.filter((team) => team.isMember), ...teams.filter((team) => !team.isMember)]
  const firstAdminAccessIndex = orderedTeams.findIndex((team) => !team.isMember)

  useEffect(() => {
    if (!open) return
    const selectedIndex = Math.max(0, orderedTeams.findIndex(({ id }) => id === value))
    optionRefs.current[selectedIndex]?.focus()

    function closeOnOutsideClick(event: PointerEvent) {
      if (event.target instanceof Node && !pickerRef.current?.contains(event.target)) setOpen(false)
    }

    document.addEventListener('pointerdown', closeOnOutsideClick)
    return () => document.removeEventListener('pointerdown', closeOnOutsideClick)
  }, [open, teams, value]) // eslint-disable-line react-hooks/exhaustive-deps

  function close(restoreFocus = false) {
    setOpen(false)
    if (restoreFocus) triggerRef.current?.focus()
  }

  function handleOptionKeyDown(event: KeyboardEvent<HTMLButtonElement>, index: number) {
    if (event.key === 'ArrowDown') {
      event.preventDefault()
      optionRefs.current[(index + 1) % orderedTeams.length]?.focus()
    } else if (event.key === 'ArrowUp') {
      event.preventDefault()
      optionRefs.current[(index - 1 + orderedTeams.length) % orderedTeams.length]?.focus()
    } else if (event.key === 'Escape') {
      event.preventDefault()
      close(true)
    }
  }

  return (
    <div className={`team-picker ${open ? 'open' : ''}`} ref={pickerRef}>
      <button
        className="team-picker-trigger"
        type="button"
        role="combobox"
        aria-label="Team"
        aria-valuetext={selected?.name ?? ''}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls="team-options"
        ref={triggerRef}
        onClick={() => setOpen((current) => !current)}
        onKeyDown={(event) => {
          if (event.key !== 'ArrowDown' && event.key !== 'ArrowUp') return
          event.preventDefault()
          setOpen(true)
        }}
      >
        <span className="team-picker-label">Team</span>
        <span className="team-picker-value">{selected?.name ?? ''}</span>
        <svg className="env-picker-chevron" viewBox="0 0 16 16" aria-hidden="true">
          <path d="m4 6 4 4 4-4" />
        </svg>
      </button>
      {open && (
        <div className="env-picker-popover team-picker-popover">
          <div className="env-picker-list" role="listbox" id="team-options" aria-label="Teams">
            {orderedTeams.map((team, index) => (
              <Fragment key={team.id}>
                {index === firstAdminAccessIndex && index > 0 && <div className="team-picker-separator" role="separator" />}
              <button
                ref={(element) => { optionRefs.current[index] = element }}
                type="button"
                role="option"
                aria-selected={team.id === value}
                className={`env-picker-option ${team.id === value ? 'selected' : ''}`}
                onClick={() => {
                  if (team.id !== value) onChange?.(team.id)
                  close(true)
                }}
                onKeyDown={(event) => handleOptionKeyDown(event, index)}
              >
                <span className="env-picker-check" aria-hidden="true">{team.id === value ? '✓' : ''}</span>
                <span className="env-picker-option-copy">
                  <span className="env-picker-option-name">{team.name}</span>
                  <span className="env-picker-option-meta">{teamAccessLabel(team)}</span>
                </span>
              </button>
              </Fragment>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}
