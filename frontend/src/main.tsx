import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
// Be Vietnam Pro from this site (the CSP allows no font host): the same face as the PDF tickets.
import '@fontsource/be-vietnam-pro/400.css'
import '@fontsource/be-vietnam-pro/500.css'
import '@fontsource/be-vietnam-pro/600.css'
import '@fontsource/be-vietnam-pro/700.css'
import './index.css'
import App from './App.tsx'
import { installErrorReporting } from './utils/clientErrors'

// Phase 23: JavaScript errors nobody caught go to the API (the admin "Tình trạng hệ thống" page).
installErrorReporting()

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
