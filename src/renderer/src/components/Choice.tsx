import { useEffect, useLayoutEffect, useRef, useState, type CSSProperties, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { Check } from 'lucide-react'

interface ChoiceProps {
  label: string
  /** Shown as an invitation (italic, accent) rather than a value. */
  unset?: boolean
  open: boolean
  onToggle: () => void
  onClose: () => void
  align?: 'left' | 'right'
  disabled?: boolean
  ariaLabel: string
  children: ReactNode
}

const EDGE = 16
const GAP = 10
const TITLE_BAR = 64

/**
 * An underlined word inside a sentence that opens a small popover. The popover
 * renders at the page level (a portal), so scrolling panels can't clip it, and
 * it places itself to stay fully inside the window.
 */
export function Choice(p: ChoiceProps) {
  const ref = useRef<HTMLSpanElement>(null)
  const popRef = useRef<HTMLDivElement>(null)
  const [place, setPlace] = useState<CSSProperties>({ visibility: 'hidden' })

  useEffect(() => {
    if (!p.open) return
    const onDown = (e: MouseEvent) => {
      const t = e.target as Node
      if (!ref.current?.contains(t) && !popRef.current?.contains(t)) p.onClose()
    }
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') p.onClose()
    }
    document.addEventListener('mousedown', onDown)
    window.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onDown)
      window.removeEventListener('keydown', onKey)
    }
  }, [p.open, p.onClose])

  useLayoutEffect(() => {
    if (!p.open) {
      setPlace({ visibility: 'hidden' })
      return
    }
    const fit = () => {
      const anchor = ref.current?.getBoundingClientRect()
      const pop = popRef.current
      if (!anchor || !pop) return
      const vw = window.innerWidth
      const vh = window.innerHeight
      const width = Math.min(pop.offsetWidth, vw - EDGE * 2)
      const preferred = p.align === 'right' ? anchor.right + 12 - width : anchor.left - 12
      const left = Math.max(EDGE, Math.min(preferred, vw - EDGE - width))
      const below = vh - anchor.bottom - GAP - EDGE
      const above = anchor.top - GAP - Math.max(EDGE, TITLE_BAR)
      const natural = pop.scrollHeight
      const up = natural > below && above > below
      const maxHeight = Math.max(160, Math.min(natural, up ? above : below))
      setPlace(up ? { left, bottom: vh - anchor.top + GAP, maxHeight } : { left, top: anchor.bottom + GAP, maxHeight })
    }
    fit()
    // Follow the anchor if anything scrolls or the window resizes.
    window.addEventListener('resize', fit)
    window.addEventListener('scroll', fit, true)
    return () => {
      window.removeEventListener('resize', fit)
      window.removeEventListener('scroll', fit, true)
    }
  }, [p.open, p.align])

  return (
    <span className="choice-wrap" ref={ref}>
      <button type="button" className={`choice ${p.unset ? 'unset' : ''}`} aria-haspopup="dialog" aria-expanded={p.open} aria-label={`${p.ariaLabel}: ${p.label}`} onClick={p.onToggle} disabled={p.disabled}>
        {p.label}
      </button>
      {p.open &&
        createPortal(
          <div ref={popRef} className="popover" style={place} role="dialog" aria-label={p.ariaLabel}>
            {p.children}
          </div>,
          document.body
        )}
    </span>
  )
}

export function Option({ selected, name, desc, oneLine, onClick, disabled }: { selected: boolean; name: string; desc?: string; oneLine?: boolean; onClick: () => void; disabled?: boolean }) {
  return (
    <button type="button" className="option" onClick={onClick} role="menuitemradio" aria-checked={selected} disabled={disabled}>
      {selected ? <Check className="tick" /> : <span />}
      <span style={{ minWidth: 0 }}>
        <div className="option-name">{name}</div>
        {desc && (
          <div className={`option-desc ${oneLine ? 'one-line' : ''}`} title={oneLine ? desc : undefined}>
            {desc}
          </div>
        )}
      </span>
    </button>
  )
}
