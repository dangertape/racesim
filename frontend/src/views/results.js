import { api } from '../api.js'
import { navigate } from '../router.js'

const SLOT_LABELS = {
  engine:      'Engine',
  tires:       'Tires',
  suspension:  'Suspension',
  aero:        'Aero',
  fuel:        'Fuel',
  electronics: 'Electronics',
}

const EVENT_LABELS = {
  sprint:       'Sprint',
  endurance:    'Endurance',
  time_trial:   'Time Trial',
  wet_track:    'Wet Track',
  night_race:   'Night Race',
  altitude:     'Altitude',
  spec_class:   'Spec Class',
  weight_limit: 'Weight Limit',
}

function bar(value, max = 100, colorClass = 'bg-track-accent') {
  const pct = Math.max(0, Math.min(100, (value / max) * 100))
  return `<div class="readiness-bar-bg"><div class="readiness-bar ${colorClass}" style="width:${pct}%"></div></div>`
}

function posOrdinal(n) {
  const s = ['th','st','nd','rd']
  const v = n % 100
  return n + (s[(v-20)%10] || s[v] || s[0])
}

export async function renderResults(container, raceId) {
  container.innerHTML = `<p class="text-track-muted text-sm">Loading results…</p>`

  let race
  try {
    race = await api.race(raceId)
  } catch (err) {
    container.innerHTML = `<p class="text-red-400">Failed to load race: ${err.message}</p>`
    return
  }

  if (race.status !== 'finished') {
    container.innerHTML = `<p class="text-track-muted">Race not yet finished.</p>
      <button class="btn-ghost text-xs mt-4" onclick="navigate('/race/${raceId}')">Watch Live</button>`
    return
  }

  const results = race.results || []

  // Fetch current player to highlight their result
  let myId = null
  try {
    const me = await api.me()
    myId = me.id
  } catch {}

  let html = `
    <div class="space-y-6">
      <div class="flex items-center justify-between">
        <div>
          <h2 class="text-lg font-bold">Results</h2>
          <p class="text-track-muted text-xs mt-0.5">
            <span class="badge-${race.event_type}">${EVENT_LABELS[race.event_type] || race.event_type}</span>
            &nbsp;${raceId}
          </p>
        </div>
        <button class="btn-ghost text-xs" id="back-btn">← Schedule</button>
      </div>

      <!-- Podium / leaderboard -->
      <div class="card space-y-3">
        <h3 class="text-sm font-bold text-track-muted uppercase tracking-widest">Leaderboard</h3>
        ${results.length === 0
          ? '<p class="text-track-muted text-sm">No entrants</p>'
          : results.map(r => `
          <div class="flex items-center gap-3 py-2 border-b border-track-border last:border-0
            ${r.player_id === myId ? 'text-track-accent' : ''}">
            <span class="w-10 text-lg font-bold ${r.position <= 3 ? 'text-track-accent' : 'text-track-muted'}">${posOrdinal(r.position)}</span>
            <div class="flex-1">
              <div class="flex items-center gap-2">
                <span class="font-semibold text-sm">${r.username}</span>
                ${r.player_id === myId ? '<span class="badge bg-track-accent/20 text-track-accent">You</span>' : ''}
                ${r.dnf ? '<span class="badge bg-red-900/50 text-red-400">DNF</span>' : ''}
              </div>
              <div class="flex items-center gap-2 mt-1">
                <div class="w-32">${bar(r.result_score)}</div>
                <span class="text-xs text-track-muted">${r.result_score.toFixed(1)} pts</span>
              </div>
            </div>
            <button class="btn-ghost text-xs breakdown-btn" data-pid="${r.player_id}">
              Breakdown
            </button>
          </div>`).join('')}
      </div>

      <!-- Per-player breakdowns (collapsible) -->
      <div id="breakdowns" class="space-y-4"></div>
    </div>`

  container.innerHTML = html

  document.getElementById('back-btn').onclick = () => navigate('/schedule')

  // Breakdown toggle
  const breakdownsEl = document.getElementById('breakdowns')

  container.querySelectorAll('.breakdown-btn').forEach(btn => {
    btn.onclick = () => {
      const pid = btn.dataset.pid
      const existing = document.getElementById(`bd-${pid}`)
      if (existing) { existing.remove(); return }
      const result = results.find(r => r.player_id === pid)
      if (!result) return
      const el = document.createElement('div')
      el.id = `bd-${pid}`
      el.innerHTML = renderBreakdown(result, race.event_type)
      breakdownsEl.appendChild(el)
    }
  })

  // Auto-open breakdown for current player
  if (myId) {
    const myResult = results.find(r => r.player_id === myId)
    if (myResult) {
      const el = document.createElement('div')
      el.id = `bd-${myId}`
      el.innerHTML = renderBreakdown(myResult, race.event_type)
      breakdownsEl.appendChild(el)
    }
  }
}

function renderBreakdown(result, eventType) {
  const {
    username, position, result_score, build_quality, event_fit,
    readiness_score, luck_delta, counterfactual_position, per_slot,
    luck_tag, dnf, dnf_slot,
  } = result

  const luckColor = luck_delta > 5 ? 'text-green-400' : luck_delta < -5 ? 'text-red-400' : 'text-track-muted'

  return `
    <div class="card space-y-5">
      <div class="flex items-center justify-between">
        <h3 class="font-bold">${username} — ${posOrdinal(position)} place</h3>
        ${dnf ? `<span class="badge bg-red-900/50 text-red-400">DNF (${dnf_slot})</span>` : ''}
      </div>

      <!-- Score formula -->
      <div class="text-xs space-y-2">
        <p class="text-track-muted uppercase tracking-widest text-xs font-semibold">Score formula</p>
        <div class="grid grid-cols-2 sm:grid-cols-4 gap-3">
          <div class="card text-center">
            <p class="text-track-muted text-xs">Build Quality</p>
            <p class="text-xl font-bold">${build_quality.toFixed(1)}</p>
            <p class="text-track-muted text-xs">× 0.40</p>
          </div>
          <div class="card text-center">
            <p class="text-track-muted text-xs">Event Fit</p>
            <p class="text-xl font-bold">${event_fit.toFixed(1)}</p>
            <p class="text-track-muted text-xs">× 0.35</p>
          </div>
          <div class="card text-center">
            <p class="text-track-muted text-xs">Readiness</p>
            <p class="text-xl font-bold">${readiness_score.toFixed(1)}</p>
            <p class="text-track-muted text-xs">× 0.25</p>
          </div>
          <div class="card text-center">
            <p class="text-track-muted text-xs">Luck</p>
            <p class="text-xl font-bold ${luckColor}">${luck_delta > 0 ? '+' : ''}${luck_delta.toFixed(1)}</p>
            <p class="text-track-muted text-xs">± varies</p>
          </div>
        </div>
        <div class="flex items-center gap-2 pt-1">
          <span class="text-track-muted">Total:</span>
          <span class="font-bold text-track-accent text-lg">${result_score.toFixed(1)}</span>
          <span class="text-track-muted">/ 100</span>
        </div>
      </div>

      <!-- Luck narrative -->
      <div class="text-sm">
        <p class="text-track-muted text-xs uppercase tracking-widest mb-1">Luck event</p>
        <p class="${luckColor}">${luck_tag}</p>
      </div>

      <!-- Counterfactual -->
      <div class="text-sm card bg-track-bg">
        <p class="text-track-muted text-xs mb-1">What if luck was neutral?</p>
        <p>You would have finished <span class="font-bold text-track-accent">${posOrdinal(counterfactual_position)}</span>
          ${counterfactual_position === position
            ? ' <span class="text-track-muted">(same position — luck didn\'t change the outcome)</span>'
            : ` <span class="text-track-muted">(luck ${luck_delta >= 0 ? 'helped' : 'hurt'} you ${Math.abs(position - counterfactual_position)} position${Math.abs(position - counterfactual_position) !== 1 ? 's' : ''})</span>`}
        </p>
      </div>

      <!-- Per-slot contributions -->
      <div>
        <p class="text-track-muted text-xs uppercase tracking-widest mb-2">Per-slot contribution</p>
        <div class="space-y-2">
          ${Object.entries(per_slot).map(([slotName, s]) => `
            <div class="flex items-center gap-3 text-xs">
              <span class="w-24 text-track-muted">${SLOT_LABELS[slotName] || slotName}</span>
              <span class="w-20 capitalize">${s.tier}</span>
              <span class="w-8 text-right">${s.tier_score}</span>
              <span class="text-track-muted mx-1">×</span>
              <span class="w-8">${s.event_weight.toFixed(1)}</span>
              <div class="flex-1">
                ${bar(s.weighted_score, 100, s.readiness < 50 ? 'bg-yellow-500' : 'bg-track-accent')}
              </div>
              <span class="w-20 text-right">
                ${s.readiness.toFixed(0)}% ready
                ${s.readiness_penalty > 0 ? `<span class="text-red-400"> −${s.readiness_penalty.toFixed(0)}</span>` : ''}
              </span>
            </div>`).join('')}
        </div>
      </div>
    </div>`
}
