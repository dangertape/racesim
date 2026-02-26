import { api } from '../api.js'

const SLOT_LABELS = {
  engine:      'Engine',
  tires:       'Tires',
  suspension:  'Suspension',
  aero:        'Aero',
  fuel:        'Fuel',
  electronics: 'Electronics',
}

const SLOT_AFFECTS = {
  engine:      'Top speed, acceleration, wear rate',
  tires:       'Wet/surface grip, degradation',
  suspension:  'Altitude & surface handling',
  aero:        'High-speed stability, fuel efficiency',
  fuel:        'Race distance capacity, consumption rate',
  electronics: 'Spec-class compliance, data readout quality',
}

const TIERS = ['standard', 'upgraded', 'performance']

function readinessColor(r) {
  if (r >= 70) return 'bg-green-500'
  if (r >= 40) return 'bg-yellow-500'
  return 'bg-red-500'
}

export async function renderGarage(container) {
  container.innerHTML = `<p class="text-track-muted text-sm">Loading garage…</p>`

  let data
  try {
    data = await api.car()
  } catch (err) {
    container.innerHTML = `<p class="text-red-400">Failed to load garage: ${err.message}</p>`
    return
  }

  const { slots, credits, materials, races_entered, tier_unlocks } = data

  // Total build weight
  const WEIGHT_TABLE = {
    engine:      { standard: 10, upgraded: 14, performance: 18 },
    tires:       { standard: 8,  upgraded: 10, performance: 13 },
    suspension:  { standard: 6,  upgraded: 8,  performance: 11 },
    aero:        { standard: 5,  upgraded: 7,  performance: 10 },
    fuel:        { standard: 9,  upgraded: 11, performance: 15 },
    electronics: { standard: 4,  upgraded: 6,  performance:  9 },
  }
  const totalWeight = Object.entries(slots).reduce((sum, [s, d]) => sum + WEIGHT_TABLE[s][d.tier], 0)

  let html = `
    <div class="space-y-6">
      <div class="flex items-center justify-between flex-wrap gap-4">
        <h2 class="text-lg font-bold">Garage</h2>
        <div class="flex gap-6 text-sm">
          <span><span class="text-track-accent font-bold">${credits}</span> <span class="text-track-muted">cr</span></span>
          <span><span class="text-track-accent font-bold">${materials}</span> <span class="text-track-muted">materials</span></span>
          <span><span class="text-track-accent font-bold">${races_entered}</span> <span class="text-track-muted">races entered</span></span>
        </div>
      </div>

      <!-- Build weight indicator -->
      <div class="card text-sm flex items-center gap-4">
        <span class="text-track-muted">Build weight:</span>
        <span class="font-bold ${totalWeight > 70 ? 'text-red-400' : 'text-green-400'}">${totalWeight} / 70 units</span>
        ${totalWeight > 70 ? '<span class="text-red-400 text-xs">Over limit — Aero & Fuel penalized in weight_limit events</span>' : ''}
      </div>

      <!-- Tier unlock status -->
      <div class="card text-xs text-track-muted space-y-1">
        <p class="font-semibold text-white mb-2">Tier Unlocks</p>
        <p>Upgraded tier: ${tier_unlocks.upgraded ? '<span class="text-green-400">Unlocked</span>' : `<span class="text-yellow-400">Unlocks at 10 races (${races_entered}/10)</span>`}</p>
        <p>Performance tier: ${tier_unlocks.performance ? '<span class="text-green-400">Unlocked</span>' : `<span class="text-yellow-400">Unlocks at 30 races (${races_entered}/30)</span>`}</p>
      </div>

      <!-- Slot cards -->
      <div class="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4" id="slot-grid">`

  for (const [slotName, slotData] of Object.entries(slots)) {
    const { tier, readiness, tier_score, swap_cost } = slotData
    const rColor = readinessColor(readiness)

    html += `
      <div class="slot-card" data-slot="${slotName}">
        <div class="flex items-center justify-between">
          <span class="font-bold text-sm">${SLOT_LABELS[slotName]}</span>
          <span class="badge bg-track-border text-track-accent">${tier}</span>
        </div>
        <p class="text-xs text-track-muted">${SLOT_AFFECTS[slotName]}</p>

        <!-- Readiness bar -->
        <div>
          <div class="flex justify-between text-xs mb-1">
            <span class="text-track-muted">Readiness</span>
            <span class="${readiness < 50 ? 'text-red-400' : readiness < 70 ? 'text-yellow-400' : 'text-green-400'}">${readiness.toFixed(0)}%</span>
          </div>
          <div class="readiness-bar-bg">
            <div class="readiness-bar ${rColor}" style="width:${readiness}%"></div>
          </div>
          ${readiness < 20 ? '<p class="text-red-400 text-xs mt-1">⚠ DNF risk</p>' : ''}
          ${readiness < 50 && readiness >= 20 ? '<p class="text-yellow-400 text-xs mt-1">Readiness penalty active</p>' : ''}
        </div>

        <!-- Tier score -->
        <p class="text-xs text-track-muted">Tier score: <span class="text-white">${tier_score}</span> / 100</p>

        <!-- Actions -->
        <div class="flex flex-col gap-2 mt-auto pt-2 border-t border-track-border">
          <!-- Repair -->
          <button class="btn-ghost text-xs repair-btn"
            data-slot="${slotName}"
            ${readiness >= 100 ? 'disabled' : ''}
            title="Cost: 1 material, 5 min prep">
            Repair → 100% (1 material)
          </button>

          <!-- Swap tier -->
          <div class="flex gap-1">
            ${TIERS.map(t => {
              const unlocked = t === 'standard' || tier_unlocks[t]
              const current = t === tier
              const cost = swap_cost
              return `<button class="flex-1 text-xs py-1 rounded border transition-colors swap-btn
                ${current
                  ? 'border-track-accent text-track-accent cursor-default'
                  : unlocked
                    ? 'border-track-border text-track-muted hover:border-white hover:text-white'
                    : 'border-track-border text-track-border cursor-not-allowed opacity-40'}
                "
                data-slot="${slotName}"
                data-tier="${t}"
                ${current || !unlocked ? 'disabled' : ''}
                title="${t === 'standard' ? '800 cr' : ''} ${!unlocked ? 'Locked' : `${cost.credits} cr, ${cost.materials} mat`}">
                ${t.charAt(0).toUpperCase()}
              </button>`
            }).join('')}
          </div>
          <p class="text-xs text-track-muted">S=Standard · U=Upgraded · P=Performance</p>
        </div>
      </div>`
  }

  html += `</div></div>`
  container.innerHTML = html

  // Bind repair buttons
  container.querySelectorAll('.repair-btn').forEach(btn => {
    btn.onclick = async () => {
      btn.disabled = true
      try {
        await api.repairSlot(btn.dataset.slot)
        renderGarage(container)
      } catch (err) {
        alert(err.message)
        btn.disabled = false
      }
    }
  })

  // Bind swap buttons
  container.querySelectorAll('.swap-btn').forEach(btn => {
    if (btn.disabled) return
    btn.onclick = async () => {
      const slot = btn.dataset.slot
      const tier = btn.dataset.tier
      const slotData = slots[slot]
      const confirmMsg = `Swap ${SLOT_LABELS[slot]} to ${tier}?\nCost: ${slotData.swap_cost.credits} cr, ${slotData.swap_cost.materials} materials`
      if (!confirm(confirmMsg)) return
      btn.disabled = true
      try {
        await api.swapSlot(slot, tier)
        renderGarage(container)
      } catch (err) {
        alert(err.message)
        btn.disabled = false
      }
    }
  })
}
