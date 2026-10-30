import { StrictMode, type ReactNode } from 'react'
import { createRoot } from 'react-dom/client'
import { BrowserRouter } from 'react-router-dom'
import { MotionConfig } from 'motion/react'
import { initMotionPref, useReducedMotion } from './motion-pref'
import './index.css'
import App from './App.tsx'

initMotionPref()

/* Motion obedece a la misma preferencia que el CSS (motion-pref.ts), como en la v1. */
function MotionRoot({ children }: { children: ReactNode }) {
  return <MotionConfig reducedMotion={useReducedMotion() ? 'always' : 'never'}>{children}</MotionConfig>
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <MotionRoot>
      <BrowserRouter>
        <App />
      </BrowserRouter>
    </MotionRoot>
  </StrictMode>,
)
