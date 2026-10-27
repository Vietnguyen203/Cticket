// Before the app paints: the dark theme class, so a dark page never flashes white.
// Same rule as src/theme/theme.ts (kept tiny; a file, since the CSP allows no inline script).
;(function () {
  var choice = 'system'
  try {
    choice = localStorage.getItem('etp-theme') || 'system'
  } catch {
    /* storage blocked: follow the system */
  }
  var dark = choice === 'dark' || (choice !== 'light' && window.matchMedia('(prefers-color-scheme: dark)').matches)
  if (dark) document.documentElement.classList.add('dark')
})()
