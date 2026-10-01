export const avatarColors = {
  violet: { background: '#eeeaff', foreground: '#5144b3' },
  blue: { background: '#e6f0ff', foreground: '#2855a6' },
  green: { background: '#dff5e9', foreground: '#21644b' },
  orange: { background: '#ffeadb', foreground: '#8a4d22' },
  rose: { background: '#ffe5ec', foreground: '#9c3555' },
  teal: { background: '#dcf4f3', foreground: '#176965' },
} as const

export type AvatarColor = keyof typeof avatarColors

export function isAvatarColor(value: string | null | undefined): value is AvatarColor {
  return !!value && Object.hasOwn(avatarColors, value)
}

export function avatarColorFor(value: string | null | undefined): AvatarColor {
  if (isAvatarColor(value)) return value
  const source = value ?? ''
  let hash = 0
  for (const char of source) hash = (hash * 31 + char.charCodeAt(0)) >>> 0
  const colors = Object.keys(avatarColors) as AvatarColor[]
  return colors[hash % colors.length] ?? 'violet'
}
