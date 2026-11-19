import type { TFrame, TStep, TVal, Lang } from './types';

export function fmt(v: TVal | undefined, max = 48, lang: Lang = 'python'): string {
  if (!v) return '?';
  let s: string;
  switch (v.t) {
    case 'num':
      s = String(v.v);
      break;
    case 'str':
      s = JSON.stringify(v.v);
      break;
    case 'bool':
      s = lang === 'python' ? (v.v ? 'True' : 'False') : String(v.v);
      break;
    case 'none':
      s = v.v;
      break;
    case 'list': {
      const [o, c] = v.kind === 'tuple' ? ['(', ')'] : v.kind === 'set' || v.kind === 'Set' ? ['{', '}'] : ['[', ']'];
      s = `${o}${v.items.map((x) => fmt(x, 16, lang)).join(', ')}${v.more ? ', …' : ''}${c}`;
      break;
    }
    case 'dict':
      s = `${v.cls ?? ''}{${v.entries.map(([k, x]) => `${k}: ${fmt(x, 16, lang)}`).join(', ')}${v.more ? ', …' : ''}}`;
      break;
    case 'ref':
      s = v.label;
      break;
    case 'fn':
      s = `ƒ ${v.name}`;
      break;
    default:
      s = v.repr;
  }
  return s.length > max ? s.slice(0, max - 1) + '…' : s;
}

export const same = (a: TVal | undefined, b: TVal | undefined) => JSON.stringify(a) === JSON.stringify(b);

function diffVal(name: string, a: TVal | undefined, b: TVal, lang: Lang, out: string[]) {
  if (b.t === 'fn') return;
  if (a === undefined) {
    out.push(`new ${name} = ${fmt(b, 48, lang)}`);
    return;
  }
  if (same(a, b)) return;
  if (a.t === 'list' && b.t === 'list') {
    const pre = (n: number) => a.items.slice(0, n).every((x, i) => same(x, b.items[i]));
    const push = lang === 'python' ? (b.kind === 'deque' || b.kind === 'set' ? 'add' : 'append') : 'push';
    if (b.items.length === a.items.length + 1 && pre(a.items.length)) {
      out.push(`${name}.${push}(${fmt(b.items[b.items.length - 1], 30, lang)}) → length ${b.items.length}`);
      return;
    }
    if (b.items.length === a.items.length - 1 && b.items.every((x, i) => same(x, a.items[i]))) {
      out.push(`${name}: removed last ${fmt(a.items[a.items.length - 1], 30, lang)}`);
      return;
    }
    if (b.items.length === a.items.length - 1 && b.items.every((x, i) => same(x, a.items[i + 1]))) {
      out.push(`${name}: removed first ${fmt(a.items[0], 30, lang)}`);
      return;
    }
    if (a.items.length === b.items.length) {
      const changed = b.items.map((_, i) => i).filter((i) => !same(a.items[i], b.items[i]));
      if (changed.length === 2 && same(a.items[changed[0]], b.items[changed[1]]) && same(a.items[changed[1]], b.items[changed[0]])) {
        out.push(`${name}: swapped [${changed[0]}] and [${changed[1]}]`);
        return;
      }
      for (const i of changed.slice(0, 4)) out.push(`${name}[${i}]: ${fmt(a.items[i], 24, lang)} → ${fmt(b.items[i], 24, lang)}`);
      if (changed.length > 4) out.push(`…and ${changed.length - 4} more elements of ${name}`);
      return;
    }
  }
  if (a.t === 'dict' && b.t === 'dict') {
    const am = new Map(a.entries);
    const bm = new Map(b.entries);
    for (const [k, v] of bm) {
      if (!am.has(k)) out.push(`${name}[${k}] = ${fmt(v, 30, lang)} (new key)`);
      else if (!same(am.get(k), v)) out.push(`${name}[${k}]: ${fmt(am.get(k), 24, lang)} → ${fmt(v, 24, lang)}`);
    }
    for (const k of am.keys()) if (!bm.has(k)) out.push(`${name}: deleted key ${k}`);
    return;
  }
  out.push(`${name}: ${fmt(a, 30, lang)} → ${fmt(b, 30, lang)}`);
}

/** Pair frames across two steps by position + function name (recursion makes names repeat). */
function matchFrame(prev: TStep | undefined, i: number, f: TFrame): TFrame | undefined {
  const p = prev?.frames[i];
  return p && p.name === f.name ? p : undefined;
}

export interface Explanation {
  headline: string;
  changes: string[];
  printed: string;
}

export function explain(steps: TStep[], idx: number, code: string[], lang: Lang): Explanation {
  const s = steps[idx];
  const prev = steps[idx - 1];
  const changes: string[] = [];
  s.frames.forEach((f, i) => {
    const pf = matchFrame(prev, i, f);
    if (!pf) return;
    const prefix = i === s.frames.length - 1 || f.name === 'global' ? '' : `${f.name}: `;
    for (const [k, v] of Object.entries(f.locals)) diffVal(prefix + k, pf.locals[k], v, lang, changes);
  });
  const printed = prev && s.stdout.length > prev.stdout.length && s.stdout.startsWith(prev.stdout) ? s.stdout.slice(prev.stdout.length) : '';
  const top = s.frames[s.frames.length - 1];
  const src = (code[s.line - 1] ?? '').trim();
  let headline: string;
  if (s.event === 'call') {
    const args = top ? Object.entries(top.locals).filter(([, v]) => v.t !== 'fn').map(([k, v]) => `${k}=${fmt(v, 24, lang)}`).join(', ') : '';
    headline = `Call ${top?.name ?? 'function'}(${args}) — a new frame is pushed (depth ${s.frames.length - 1}).`;
  } else if (s.event === 'return') {
    headline = `${top?.name === 'global' ? 'Program' : top?.name ?? 'Function'} returns ${fmt(s.ret, 60, lang)} from line ${s.line}.`;
  } else if (s.event === 'exception') {
    headline = `⚠ ${s.error ?? 'Exception'} (line ${s.line})`;
  } else {
    headline = idx === 0 ? `Start at line ${s.line}: ${src}` : `Next: line ${s.line} — ${src}`;
  }
  return { headline, changes, printed };
}

const INDEX_NAME = /^(i|j|k|l|r|lo|hi|low|high|mid|left|right|start|end|p|q|idx|index|slow|fast|ptr|pos|[ijk]\d?)$/i;

/** int locals that look like indexes into `len`-long arrays → shown as pointer labels under cells */
export function indexPointers(f: TFrame, len: number): Map<number, string[]> {
  const m = new Map<number, string[]>();
  for (const [k, v] of Object.entries(f.locals)) {
    if (v.t !== 'num' || !Number.isInteger(v.v) || !INDEX_NAME.test(k)) continue;
    if (v.v < 0 || v.v >= len) continue;
    m.set(v.v, [...(m.get(v.v) ?? []), k]);
  }
  return m;
}
