import { api } from '../api.js'
import { navigate } from '../router.js'

let _isAdmin = false

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

const EVENT_TIPS = {
  sprint:       'Acceleration-focused. Engine tier is the primary lever.',
  endurance:    'Fuel & Tires readiness critical. High wear event.',
  time_trial:   'Solo run — pure build quality. Luck only ±5.',
  wet_track:    'Tires dominate. Standard tires cost −15 event_fit.',
  night_race:   'Electronics bonus. Standard electronics cost −10 event_fit.',
  altitude:     'Suspension & Aero matter. Engine is partially wasted.',
  spec_class:   'Electronics compliance checked. Electronics bonus.',
  weight_limit: 'Over 70 weight units? Aero & Fuel penalized −20 event_fit.',
}

function fmtTime(iso) {
  const d = new Date(iso)
  return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
}

function fmtDate(iso) {
  const d = new Date(iso)
  return d.toLocaleDateString([], { weekday: 'short', month: 'short', day: 'numeric' })
}

export async function renderSchedule(container) {
  container.innerHTML = `<p class="text-track-muted text-sm">Loading schedule…</p>`

  let races, me
  try {
    [races, me] = await Promise.all([api.schedule(), api.me()])
  } catch (err) {
    container.innerHTML = `<p class="text-red-400">Failed to load schedule: ${err.message}</p>`
    return
  }
  _isAdmin = me.username === 'admin'

  const now = new Date()

  // Group by date
  const byDate = {}
  for (const r of races) {
    const date = fmtDate(r.scheduled_time)
    if (!byDate[date]) byDate[date] = []
    byDate[date].push(r)
  }

  let html = `
    <div class="space-y-8">
      <div class="flex items-center justify-between">
        <h2 class="text-lg font-bold">Race Schedule</h2>
        <div class="flex items-center gap-3">
          ${_isAdmin ? '<button class="btn-danger text-xs reset-schedule-btn">Reset Schedule</button>' : ''}
          <span class="text-xs text-track-muted">All times local</span>
        </div>
      </div>`

  for (const [date, dayRaces] of Object.entries(byDate)) {
    html += `<div>
      <h3 class="text-track-muted text-xs uppercase tracking-widest mb-3">${date}</h3>
      <div class="space-y-2">`

    for (const r of dayRaces) {
      const isPast = new Date(r.scheduled_time) < now
      const isOpen = r.status === 'open'
      const canWatch = ['running', 'finished'].includes(r.status)
      const tip = EVENT_TIPS[r.event_type] || ''

      html += `
        <div class="card flex flex-col sm:flex-row sm:items-center gap-3 ${isPast ? 'opacity-50' : ''}">
          <div class="w-20 text-track-accent font-bold text-sm shrink-0">${fmtTime(r.scheduled_time)}</div>
          <div class="flex-1 min-w-0">
            <div class="flex items-center gap-2 flex-wrap">
              <span class="badge-${r.event_type}">${EVENT_LABELS[r.event_type] || r.event_type}</span>
              <span class="badge-${r.status}">${r.status}</span>
              ${r.entered ? '<span class="badge bg-green-900/50 text-green-300">Entered</span>' : ''}
            </div>
            <p class="text-xs text-track-muted mt-1">${tip}</p>
            <p class="text-xs text-track-muted">${r.entrant_count} entrant${r.entrant_count !== 1 ? 's' : ''} · ${r.entry_fee} cr entry</p>
          </div>
          <div class="flex gap-2 shrink-0">
            ${isOpen && !r.entered
              ? `<button class="btn-primary text-xs enter-btn" data-id="${r.id}">Enter — ${r.entry_fee} cr</button>`
              : ''}
            ${isOpen && r.entered
              ? `<button class="btn-danger text-xs withdraw-btn" data-id="${r.id}">Withdraw</button>`
              : ''}
            ${canWatch
              ? `<button class="btn-ghost text-xs watch-btn" data-id="${r.id}">Watch</button>`
              : ''}
            ${r.status === 'finished'
              ? `<button class="btn-ghost text-xs results-btn" data-id="${r.id}">Results</button>`
              : ''}
            ${_isAdmin && ['open', 'locked', 'upcoming'].includes(r.status)
              ? `<button class="btn-danger text-xs admin-start-btn" data-id="${r.id}">▶ Start now</button>`
              : ''}
          </div>
        </div>`
    }
    html += `</div></div>`
  }

  html += `</div>`
  container.innerHTML = html

  // Bind buttons
  container.querySelectorAll('.enter-btn').forEach(btn => {
    btn.onclick = async () => {
      btn.disabled = true
      try {
        await api.enterRace(btn.dataset.id)
        renderSchedule(container)
      } catch (err) {
        alert(err.message)
        btn.disabled = false
      }
    }
  })

  container.querySelectorAll('.withdraw-btn').forEach(btn => {
    btn.onclick = async () => {
      if (!confirm('Withdraw? You\'ll receive a 50% refund of the entry fee.')) return
      btn.disabled = true
      try {
        await api.withdrawRace(btn.dataset.id)
        renderSchedule(container)
      } catch (err) {
        alert(err.message)
        btn.disabled = false
      }
    }
  })

  container.querySelectorAll('.watch-btn').forEach(btn => {
    btn.onclick = () => navigate(`/race/${btn.dataset.id}`)
  })

  container.querySelectorAll('.results-btn').forEach(btn => {
    btn.onclick = () => navigate(`/results/${btn.dataset.id}`)
  })

  container.querySelectorAll('.admin-start-btn').forEach(btn => {
    btn.onclick = async () => {
      if (!confirm(`Start race ${btn.dataset.id} immediately?`)) return
      btn.disabled = true
      try {
        await api.adminStartRace(btn.dataset.id)
        navigate(`/race/${btn.dataset.id}`)
      } catch (err) {
        alert(err.message)
        btn.disabled = false
      }
    }
  })

  const resetBtn = container.querySelector('.reset-schedule-btn')
  if (resetBtn) {
    resetBtn.onclick = async () => {
      if (!confirm('Reset schedule? This will delete ALL existing races and generate 30 fresh ones with new tracks.')) return
      resetBtn.disabled = true
      resetBtn.textContent = 'Resetting…'
      try {
        await api.adminResetSchedule()
        renderSchedule(container)
      } catch (err) {
        alert(err.message)
        resetBtn.disabled = false
        resetBtn.textContent = 'Reset Schedule'
      }
    }
  }
}
