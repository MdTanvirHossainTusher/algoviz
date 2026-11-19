import type { Step, Viz, Tone, Pointer, ArrayViz, Algorithm, Params } from './types';

/** Collects steps and keeps running counters that are snapshotted into every step. */
export class Recorder {
  steps: Step[] = [];
  stats: Record<string, number> = {};
  private limit: number;

  constructor(statKeys: string[] = [], limit = 4000) {
    for (const k of statKeys) this.stats[k] = 0;
    this.limit = limit;
  }

  inc(key: string, by = 1) {
    this.stats[key] = (this.stats[key] ?? 0) + by;
  }

  push(line: number | undefined, msg: string, views: Viz[], vars?: Step['vars']) {
    if (this.steps.length >= this.limit) return;
    this.steps.push({ line, msg, views, vars: vars ? { ...vars } : undefined, stats: { ...this.stats } });
  }

  get full() {
    return this.steps.length >= this.limit;
  }
}

export function arrayViz(
  values: (number | string)[],
  opts: {
    ids?: number[];
    tones?: Record<number, Tone>;
    pointers?: Pointer[];
    title?: string;
    style?: 'bars' | 'cells';
    labels?: string[];
  } = {},
): ArrayViz {
  return {
    kind: 'array',
    values: [...values],
    ids: opts.ids ? [...opts.ids] : undefined,
    tones: opts.tones ? { ...opts.tones } : undefined,
    pointers: opts.pointers,
    title: opts.title,
    style: opts.style,
    labels: opts.labels,
  };
}

export function tonesFrom(entries: [number | undefined | null, Tone][], base: Record<number, Tone> = {}) {
  const t: Record<number, Tone> = { ...base };
  for (const [i, tone] of entries) if (i !== undefined && i !== null && i >= 0) t[i] = tone;
  return t;
}

export function rangeTones(from: number, to: number, tone: Tone, base: Record<number, Tone> = {}) {
  const t: Record<number, Tone> = { ...base };
  for (let i = from; i <= to; i++) t[i] = tone;
  return t;
}

export function edgeKey(a: string, b: string, directed = false) {
  if (directed) return `${a}->${b}`;
  return a < b ? `${a}-${b}` : `${b}-${a}`;
}

export function randInt(lo: number, hi: number) {
  return Math.floor(Math.random() * (hi - lo + 1)) + lo;
}

export function randArray(n: number, lo = 5, hi = 99) {
  return Array.from({ length: n }, () => randInt(lo, hi));
}

/** Wrap an array algorithm so an empty input yields one explanatory step instead of odd behaviour. */
export function guardEmpty(algo: Algorithm, key: string, msg: string): Algorithm {
  const run = algo.run;
  return {
    ...algo,
    run: (p: Params) => {
      const v = p[key];
      if (Array.isArray(v) && v.length === 0) {
        return [{ line: algo.code.length - 1, msg, views: [arrayViz([], { style: 'cells' })], stats: {} }];
      }
      return run(p);
    },
  };
}

export function shuffle<T>(a: T[]): T[] {
  const r = [...a];
  for (let i = r.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [r[i], r[j]] = [r[j], r[i]];
  }
  return r;
}

/** An explicitly empty array is a valid (edge-case) input, so only fall back when the value is missing. */
export const nums = (v: unknown, fallback: number[]): number[] => (Array.isArray(v) ? (v as number[]) : fallback);
export const num = (v: unknown, fallback: number): number => (typeof v === 'number' && !Number.isNaN(v) ? v : fallback);
export const str = (v: unknown, fallback: string): string => (typeof v === 'string' && v.length ? v : fallback);
