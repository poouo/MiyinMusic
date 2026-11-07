import { useCallback, useEffect, useState } from 'react'

export interface RouteLocation {
  path: string
  query: URLSearchParams
}

function parseHash(): RouteLocation {
  const raw = window.location.hash.replace(/^#/, '') || '/'
  const [path, search] = raw.split('?')
  return { path: path || '/', query: new URLSearchParams(search ?? '') }
}

export function navigate(to: string, options: { replace?: boolean } = {}): void {
  const target = '#' + (to.startsWith('/') ? to : '/' + to)
  if (window.location.hash === target) return
  if (options.replace) {
    const url = window.location.pathname + window.location.search + target
    window.history.replaceState(null, '', url)
    window.dispatchEvent(new HashChangeEvent('hashchange'))
  } else {
    window.location.hash = target
  }
}

export function useRoute(): RouteLocation {
  const [route, setRoute] = useState<RouteLocation>(parseHash)
  useEffect(() => {
    const handler = () => setRoute(parseHash())
    window.addEventListener('hashchange', handler)
    return () => window.removeEventListener('hashchange', handler)
  }, [])
  return route
}

export function useScrollTopOnRouteKey(key: string): void {
  useEffect(() => {
    const el = document.querySelector('.content')
    if (el) el.scrollTop = 0
  }, [key])
}

export function useNavigate() {
  return useCallback((to: string, options?: { replace?: boolean }) => navigate(to, options), [])
}
