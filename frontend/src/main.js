/**
 * App entry point — bootstraps auth check and wires up routing.
 */
import { api } from './api.js'
import { on, start, navigate } from './router.js'
import { renderAuth } from './views/auth.js'
import { renderSchedule } from './views/schedule.js'
import { renderGarage } from './views/garage.js'
import { renderResults } from './views/results.js'

const app  = document.getElementById('app')
const nav  = document.getElementById('nav')

let currentPlayer = null

// ── Auth state ────────────────────────────────────────────────────────────────

let _authPromise = null

async function checkAuth() {
  if (!_authPromise) {
    _authPromise = api.me()
      .then(p => { currentPlayer = p; return true })
      .catch(() => { _authPromise = null; return false })
  }
  return _authPromise
}

function updateNav() {
  if (!currentPlayer) return
  nav.classList.remove('hidden')
  nav.classList.add('flex')
  const credits = document.getElementById('nav-credits')
  if (credits) credits.textContent = `${currentPlayer.credits} cr`
}

document.getElementById('nav-logout').addEventListener('click', async () => {
  await api.logout().catch(() => {})
  currentPlayer = null
  _authPromise = null
  nav.classList.add('hidden')
  nav.classList.remove('flex')
  navigate('/auth')
})

// ── Routes ────────────────────────────────────────────────────────────────────

async function requireAuth(fn) {
  const ok = await checkAuth()
  if (!ok) { navigate('/auth'); return }
  updateNav()
  fn()
}

on('/auth', () => {
  renderAuth(app, async (player) => {
    currentPlayer = player
    updateNav()
    navigate('/schedule')
  })
})

on('/schedule', () => requireAuth(() => renderSchedule(app)))

on('/garage', () => requireAuth(() => renderGarage(app)))

on('/race/:id', ({ id }) => requireAuth(async () => {
  const race = await api.race(id).catch(() => null)
  if (race && race.status === 'finished') {
    navigate(`/results/${id}`)
    return
  }
  const { renderRace } = await import('./views/race.js')
  renderRace(app, id)
}))

on('/results/:id', ({ id }) => requireAuth(() => renderResults(app, id)))

// ── Boot ──────────────────────────────────────────────────────────────────────

// Start router immediately — requireAuth() handles per-route gating.
// Auth check fires in parallel via the first requireAuth() call.
start()
