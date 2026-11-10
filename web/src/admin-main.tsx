import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { AdminPage } from './pages/AdminPage'
import { SettingsProvider } from './state/settings'
import { ToastProvider } from './state/toast'
import { AuthProvider } from './state/auth'
import { AppConfigProvider } from './state/appConfig'
import './styles/global.css'
import './styles/admin.css'

createRoot(document.getElementById('root')!).render(
  <StrictMode><SettingsProvider><ToastProvider><AuthProvider><AppConfigProvider>
    <main className="admin-standalone"><AdminPage /></main>
  </AppConfigProvider></AuthProvider></ToastProvider></SettingsProvider></StrictMode>,
)
