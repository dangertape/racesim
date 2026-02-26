/**
 * Thin API client — all fetch calls go here.
 * Credentials (httpOnly cookie) are included automatically.
 */

const BASE = '/api'

async function request(method, path, body) {
  const opts = {
    method,
    credentials: 'include',
    headers: {},
  }
  if (body !== undefined) {
    opts.headers['Content-Type'] = 'application/json'
    opts.body = JSON.stringify(body)
  }
  const res = await fetch(BASE + path, opts)
  if (res.status === 204) return null
  const data = await res.json().catch(() => ({ detail: res.statusText }))
  if (!res.ok) throw new Error(data.detail || `HTTP ${res.status}`)
  return data
}

export const api = {
  // Auth
  register: (username, password) => request('POST', '/auth/register', { username, password }),
  login:    (username, password) => request('POST', '/auth/login',    { username, password }),
  logout:   ()                   => request('POST', '/auth/logout'),
  me:       ()                   => request('GET',  '/auth/me'),

  // Schedule
  schedule: () => request('GET', '/schedule'),

  // Races
  race:     (id) => request('GET', `/races/${id}`),

  // Car
  car:           ()            => request('GET',  '/car'),
  repairSlot:    (slot)        => request('POST', `/car/repair/${slot}`),
  swapSlot:      (slot, tier)  => request('POST', `/car/swap/${slot}`, { tier }),

  // Entry
  enterRace:    (id) => request('POST',   `/races/${id}/enter`),
  withdrawRace: (id) => request('DELETE', `/races/${id}/enter`),

  // Admin
  adminStartRace: (id) => request('POST', `/admin/races/${id}/start`),
  adminResetSchedule: () => request('POST', '/admin/reset-schedule'),
}

export function wsUrl(raceId) {
  const proto = location.protocol === 'https:' ? 'wss' : 'ws'
  return `${proto}://${location.host}/ws/races/${raceId}`
}
