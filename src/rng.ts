/**
 * Deterministic PRNG (mulberry32) driving every probabilistic decision in the
 * library. Using our own RNG -- rather than leaning solely on faker's
 * internal state -- means cart/order/shipment "coin flips" stay reproducible
 * independent of how many faker calls (names, addresses, product names)
 * happen in between them.
 */
export class Rng {
  private state: number;

  constructor(seed: number) {
    // Ensure a non-zero 32-bit starting state.
    this.state = seed >>> 0 || 0x9e3779b9;
  }

  /** Returns a float in [0, 1). */
  next(): number {
    this.state |= 0;
    this.state = (this.state + 0x6d2b79f5) | 0;
    let t = this.state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }

  /** Integer in [min, max], inclusive on both ends. */
  int(min: number, max: number): number {
    return Math.floor(this.next() * (max - min + 1)) + min;
  }

  /** Float in [min, max), rounded to `precision` decimals. */
  float(min: number, max: number, precision = 2): number {
    const value = this.next() * (max - min) + min;
    const factor = 10 ** precision;
    return Math.round(value * factor) / factor;
  }

  /** True with probability `p` (0..1). */
  chance(p: number): boolean {
    return this.next() < p;
  }

  pick<T>(items: readonly T[]): T {
    if (items.length === 0) throw new Error("Rng.pick: empty array");
    return items[this.int(0, items.length - 1)];
  }

  /** Weighted pick from [item, weight] pairs. */
  weighted<T>(items: ReadonlyArray<readonly [T, number]>): T {
    const total = items.reduce((sum, [, w]) => sum + w, 0);
    let roll = this.next() * total;
    for (const [item, weight] of items) {
      roll -= weight;
      if (roll <= 0) return item;
    }
    return items[items.length - 1][0];
  }

  shuffle<T>(items: readonly T[]): T[] {
    const copy = [...items];
    for (let i = copy.length - 1; i > 0; i--) {
      const j = this.int(0, i);
      [copy[i], copy[j]] = [copy[j], copy[i]];
    }
    return copy;
  }

  /** Random Date between two Dates (inclusive of `from`, exclusive of `to`). */
  dateBetween(from: Date, to: Date): Date {
    const fromMs = from.getTime();
    const toMs = to.getTime();
    if (toMs <= fromMs) return new Date(fromMs);
    return new Date(fromMs + Math.floor(this.next() * (toMs - fromMs)));
  }
}
