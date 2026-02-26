/**
 * Minimal hash-based router.
 * Routes: '#/auth', '#/schedule', '#/garage', '#/race/:id', '#/results/:id'
 */

const routes = {}

export function on(pattern, handler) {
  routes[pattern] = handler
}

export function navigate(path) {
  location.hash = path
}

export function start() {
  window.addEventListener('hashchange', dispatch)
  dispatch()
}

function dispatch() {
  const hash = location.hash.slice(1) || '/schedule'
  for (const [pattern, handler] of Object.entries(routes)) {
    const match = matchRoute(pattern, hash)
    if (match) {
      handler(match)
      return
    }
  }
  // Fallback
  const defaultHandler = routes['/schedule']
  if (defaultHandler) defaultHandler({})
}

function matchRoute(pattern, path) {
  const patParts = pattern.split('/')
  const pathParts = path.split('/')
  if (patParts.length !== pathParts.length) return null
  const params = {}
  for (let i = 0; i < patParts.length; i++) {
    if (patParts[i].startsWith(':')) {
      params[patParts[i].slice(1)] = decodeURIComponent(pathParts[i])
    } else if (patParts[i] !== pathParts[i]) {
      return null
    }
  }
  return params
}
