import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import App from './App'
import './styles/global.css'

const container = document.getElementById('root')
if (!container) throw new Error('找不到 #root 挂载点')

if (window.location.hash.startsWith('#/admin')) {
  window.location.replace('/admin/')
} else createRoot(container).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
