import './overlay.css'
import type { TypingStatus } from '@shared/types'

const $ = (id: string) => document.getElementById(id)!

$('stop').addEventListener('click', () => window.autotyper.overlayAction('stop'))
$('pause').addEventListener('click', () => window.autotyper.overlayAction('pauseResume'))

const LABEL: Record<TypingStatus['state'], string> = {
  idle: 'Idle',
  countdown: 'Getting ready',
  typing: 'Typing',
  paused: 'Paused',
  stopped: 'Stopped',
  completed: 'Built',
  error: 'Error'
}

window.autotyper.typing.onStatus((s) => {
  $('pill').dataset.state = s.state
  $('state').textContent = s.state === 'countdown' && s.countdown ? `Starting in ${s.countdown}` : LABEL[s.state]
  $('target').textContent = s.target ? `into ${s.target.appName}` : ''
  const pct = s.totalChars ? Math.round((s.typedChars / s.totalChars) * 100) : 0
  $('meta').textContent =
    s.state === 'paused' || s.state === 'error' || s.state === 'stopped'
      ? (s.detail ?? '')
      : `${pct}% · line ${s.currentLine} of ${s.totalLines}`
  $('fill').style.width = `${pct}%`
  $('pause').textContent = s.state === 'paused' ? 'Resume' : 'Pause'
})
