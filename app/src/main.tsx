import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.tsx'
import Muestrario from './Muestrario.tsx'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    {/* página temporal de la fase 1.1 */}
    {location.pathname === '/_muestrario' ? <Muestrario /> : <App />}
  </StrictMode>,
)
