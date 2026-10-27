import { useEffect, useSyncExternalStore } from 'react'

/**
 * Light / dark theme (docs/DESIGN.md). The choice: light, dark, or the
 * system's setting (default), kept in this browser. public/theme-init.js
 * applies the same rule before the first paint.
 */
export type ThemeChoice = 'system' | 'light' | 'dark'

const KEY = 'etp-theme'
const media = () => window.matchMedia('(prefers-color-scheme: dark)')
const listeners = new Set<() => void>()

export function readChoice(): ThemeChoice {
  try {
    const value = localStorage.getItem(KEY)
    return value === 'light' || value === 'dark' ? value : 'system'
  } catch {
    return 'system'
  }
}

/** Dark or not, for a choice (the system's setting for "system"). */
export function isDark(choice: ThemeChoice, systemDark: boolean): boolean {
  return choice === 'dark' || (choice === 'system' && systemDark)
}

function apply(choice: ThemeChoice) {
  const dark = isDark(choice, media().matches)
  document.documentElement.classList.toggle('dark', dark)
  // The phone's status bar follows the header colour.
  document.querySelector('meta[name="theme-color"]')?.setAttribute('content', dark ? '#161128' : '#ffffff')
}

export function setChoice(choice: ThemeChoice) {
  try {
    if (choice === 'system') localStorage.removeItem(KEY)
    else localStorage.setItem(KEY, choice)
  } catch {
    // Storage blocked: the choice lasts for this page only.
  }
  apply(choice)
  listeners.forEach((notify) => notify())
}

/** The current choice; keeps the page in step with the system while it is "system". */
export function useTheme(): [ThemeChoice, (choice: ThemeChoice) => void] {
  const choice = useSyncExternalStore(
    (notify) => {
      listeners.add(notify)
      return () => listeners.delete(notify)
    },
    readChoice,
    () => 'system' as ThemeChoice,
  )
  useEffect(() => {
    apply(choice)
    const query = media()
    const onChange = () => {
      if (readChoice() === 'system') apply('system')
    }
    query.addEventListener('change', onChange)
    return () => query.removeEventListener('change', onChange)
  }, [choice])
  return [choice, setChoice]
}

/** Light → dark → system → light: one button, the next choice is in its label. */
export const NEXT_CHOICE: Record<ThemeChoice, ThemeChoice> = { light: 'dark', dark: 'system', system: 'light' }
export const CHOICE_LABEL: Record<ThemeChoice, string> = { light: 'Sáng', dark: 'Tối', system: 'Theo máy' }
