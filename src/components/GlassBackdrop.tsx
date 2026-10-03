import { useId } from 'react'

export function GlassBackdrop() {
  const id = useId()
  return (
    <div className="glass-backdrop" aria-hidden="true">
      <svg viewBox="0 0 1200 800" preserveAspectRatio="xMidYMid slice">
        <defs>
          <radialGradient id={`${id}-glow`} cx=".5" cy=".5" r=".6">
            <stop offset="0" stopColor="#fbb02d" stopOpacity=".35" />
            <stop offset="1" stopColor="#fbb02d" stopOpacity="0" />
          </radialGradient>
          <pattern id={`${id}-grid`} width="40" height="40" patternUnits="userSpaceOnUse">
            <path className="glass-grid-line" d="M40 0H0V40" fill="none" />
          </pattern>
        </defs>
        <rect width="1200" height="800" fill={`url(#${id}-grid)`} />
        <rect width="1200" height="800" fill={`url(#${id}-glow)`} />
        <g className="glass-x"><polygon className="glass-x-shape" points="120,160 330,160 500,400 330,640 120,640 290,400" /></g>
        <g className="glass-blob glass-blob-1"><circle cx="450" cy="300" r="140" fill="#fbb02d" opacity=".6" /></g>
        <g className="glass-blob glass-blob-2"><circle cx="780" cy="520" r="170" fill="#f58a1f" opacity=".45" /></g>
        <g className="glass-blob glass-blob-3"><circle className="glass-blob-accent" cx="640" cy="180" r="90" /></g>
      </svg>
    </div>
  )
}
