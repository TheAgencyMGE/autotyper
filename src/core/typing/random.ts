/**
 * Seedable RNG helpers. All humanization randomness flows through here so that
 * behaviour is bounded, reproducible in tests and easy to reason about.
 */
export class Random {
  private state: number

  constructor(seed: number = (Date.now() ^ Math.floor(Math.random() * 0xffffffff)) >>> 0) {
    this.state = seed >>> 0 || 0x9e3779b9
  }

  /** mulberry32 — uniform in [0, 1). */
  next(): number {
    let t = (this.state = (this.state + 0x6d2b79f5) >>> 0)
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }

  chance(p: number): boolean {
    return this.next() < p
  }

  uniform(lo: number, hi: number): number {
    return lo + (hi - lo) * this.next()
  }

  int(lo: number, hiInclusive: number): number {
    return Math.floor(this.uniform(lo, hiInclusive + 1))
  }

  pick<T>(items: readonly T[]): T {
    return items[Math.floor(this.next() * items.length)]
  }

  /** Standard normal, clamped to ±limit standard deviations (bounded randomness). */
  gaussian(limit = 2.5): number {
    const u = Math.max(this.next(), 1e-9)
    const v = this.next()
    const z = Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v)
    return Math.max(-limit, Math.min(limit, z))
  }
}
