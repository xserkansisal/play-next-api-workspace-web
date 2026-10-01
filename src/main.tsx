import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'

import { AuthGate } from './AuthGate.tsx'
import { initializeTheme } from './lib/theme-storage'
import './index.css'

initializeTheme()

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <AuthGate />
  </StrictMode>,
)
