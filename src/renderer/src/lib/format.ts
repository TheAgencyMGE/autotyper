export function formatDuration(ms: number): string {
  if (!Number.isFinite(ms) || ms <= 0) return '0s'
  const total = Math.round(ms / 1000)
  const h = Math.floor(total / 3600)
  const m = Math.floor((total % 3600) / 60)
  const s = total % 60
  if (h) return `${h}h ${m}m`
  if (m) return `${m}m ${s.toString().padStart(2, '0')}s`
  return `${s}s`
}

export const formatNumber = (n: number): string => n.toLocaleString('en-US')

export function formatTime(ts: number): string {
  return new Date(ts).toLocaleTimeString('en-GB', { hour12: false })
}

/** Initials for an app badge, e.g. "VS Code" → "VS". */
export function badgeText(appName: string): string {
  const words = appName.replace(/[^A-Za-z0-9+ ]/g, '').split(/\s+/).filter(Boolean)
  if (words.length > 1) return (words[0][0] + words[1][0]).toUpperCase()
  return (words[0] ?? '?').slice(0, 2).toUpperCase()
}

/** Human form of an Electron accelerator, e.g. "Control+Alt+Escape" → "Ctrl+Alt+Esc". */
export function prettyAccelerator(accel: string): string {
  return accel
    .replace(/CommandOrControl|CmdOrCtrl|Control/g, 'Ctrl')
    .replace(/Escape/g, 'Esc')
}
