import { api } from '../api.js'

export function renderAuth(container, onSuccess) {
  let mode = 'login'

  function render() {
    container.innerHTML = `
      <div class="min-h-[60vh] flex items-center justify-center">
        <div class="card w-full max-w-sm space-y-6">
          <h1 class="text-track-accent text-xl font-bold tracking-widest text-center uppercase">
            CarRacingSim
          </h1>
          <div class="flex rounded overflow-hidden border border-track-border">
            <button id="tab-login"    class="flex-1 py-2 text-sm ${mode === 'login'    ? 'bg-track-accent text-black font-bold' : 'text-track-muted hover:text-white'}">Login</button>
            <button id="tab-register" class="flex-1 py-2 text-sm ${mode === 'register' ? 'bg-track-accent text-black font-bold' : 'text-track-muted hover:text-white'}">Register</button>
          </div>
          <form id="auth-form" class="space-y-4">
            <div>
              <label class="block text-xs text-track-muted mb-1">Username</label>
              <input id="username" type="text" autocomplete="username"
                class="w-full bg-track-bg border border-track-border rounded px-3 py-2 text-sm focus:outline-none focus:border-track-accent" />
            </div>
            <div>
              <label class="block text-xs text-track-muted mb-1">Password</label>
              <input id="password" type="password" autocomplete="${mode === 'login' ? 'current-password' : 'new-password'}"
                class="w-full bg-track-bg border border-track-border rounded px-3 py-2 text-sm focus:outline-none focus:border-track-accent" />
            </div>
            <p id="auth-error" class="text-red-400 text-xs hidden"></p>
            <button type="submit" class="btn-primary w-full">
              ${mode === 'login' ? 'Log In' : 'Create Account'}
            </button>
          </form>
        </div>
      </div>`

    document.getElementById('tab-login').onclick    = () => { mode = 'login';    render() }
    document.getElementById('tab-register').onclick = () => { mode = 'register'; render() }

    document.getElementById('auth-form').onsubmit = async (e) => {
      e.preventDefault()
      const u = document.getElementById('username').value.trim()
      const p = document.getElementById('password').value
      const errEl = document.getElementById('auth-error')
      errEl.classList.add('hidden')
      try {
        const player = mode === 'login'
          ? await api.login(u, p)
          : await api.register(u, p)
        onSuccess(player)
      } catch (err) {
        errEl.textContent = err.message
        errEl.classList.remove('hidden')
      }
    }
  }

  render()
}
