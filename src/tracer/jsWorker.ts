/// <reference lib="webworker" />
import { instrument, InstrumentError } from './jsInstrument';
import type { TFrame, TStep, TVal, TraceResult } from './types';

class StopTrace extends Error {}

function enc(v: unknown, depth = 0, seen: Set<unknown> = new Set()): TVal {
  switch (typeof v) {
    case 'number':
      return Number.isFinite(v) ? { t: 'num', v } : { t: 'other', repr: String(v) };
    case 'string':
      return { t: 'str', v: v.length > 200 ? v.slice(0, 200) + '…' : v };
    case 'boolean':
      return { t: 'bool', v };
    case 'undefined':
      return { t: 'none', v: 'undefined' };
    case 'bigint':
      return { t: 'other', repr: `${v}n` };
    case 'symbol':
      return { t: 'other', repr: v.toString() };
    case 'function':
      return { t: 'fn', name: (v as { name?: string }).name || 'function' };
  }
  if (v === null) return { t: 'none', v: 'null' };
  if (seen.has(v)) return { t: 'ref', label: '↺ cycle' };
  if (depth > 4) return { t: 'ref', label: '…' };
  const s2 = new Set(seen).add(v);
  if (Array.isArray(v) || ArrayBuffer.isView(v)) {
    const arr = Array.from(v as ArrayLike<unknown>);
    return { t: 'list', kind: Array.isArray(v) ? 'array' : (v as object).constructor.name, items: arr.slice(0, 60).map((x) => enc(x, depth + 1, s2)), more: Math.max(0, arr.length - 60) };
  }
  if (v instanceof Map) {
    const e = [...v.entries()];
    return { t: 'dict', kind: 'Map', entries: e.slice(0, 40).map(([k, x]) => [short(k), enc(x, depth + 1, s2)]), more: Math.max(0, e.length - 40) };
  }
  if (v instanceof Set) {
    const a = [...v];
    return { t: 'list', kind: 'Set', items: a.slice(0, 60).map((x) => enc(x, depth + 1, s2)), more: Math.max(0, a.length - 60) };
  }
  if (v instanceof Date) return { t: 'other', repr: v.toISOString() };
  if (v instanceof Error) return { t: 'other', repr: `${v.name}: ${v.message}` };
  const obj = v as Record<string, unknown>;
  const keys = Object.keys(obj);
  const ctor = Object.getPrototypeOf(obj)?.constructor?.name;
  return { t: 'dict', kind: 'object', cls: ctor && ctor !== 'Object' ? ctor : undefined, entries: keys.slice(0, 30).map((k) => [k, enc(obj[k], depth + 1, s2)]), more: Math.max(0, keys.length - 30) };
}

function short(k: unknown): string {
  if (typeof k === 'string') return JSON.stringify(k);
  if (typeof k === 'object' && k !== null) return Array.isArray(k) ? `[${k.length}]` : '{…}';
  return String(k);
}

function fmt(v: unknown, depth = 0): string {
  if (typeof v === 'string') return depth ? JSON.stringify(v) : v;
  if (typeof v !== 'object' || v === null) return String(v);
  if (depth > 2) return Array.isArray(v) ? '[Array]' : '[Object]';
  if (Array.isArray(v)) return v.length ? `[ ${v.map((x) => fmt(x, depth + 1)).join(', ')} ]` : '[]';
  if (v instanceof Map) return `Map(${v.size}) { ${[...v].map(([k, x]) => `${fmt(k, depth + 1)} => ${fmt(x, depth + 1)}`).join(', ')} }`;
  if (v instanceof Set) return `Set(${v.size}) { ${[...v].map((x) => fmt(x, depth + 1)).join(', ')} }`;
  return `{ ${Object.entries(v).map(([k, x]) => `${k}: ${fmt(x, depth + 1)}`).join(', ')} }`;
}

interface RunMsg {
  code: string;
  stdin: string;
  maxSteps: number;
  timeoutMs: number;
}

self.onmessage = (e: MessageEvent<RunMsg>) => {
  const { code, stdin, maxSteps, timeoutMs } = e.data;
  const steps: TStep[] = [];
  let stdout = '';
  let stopped = false;
  let timedOut = false;
  let lastLine = 1;
  const deadline = performance.now() + timeoutMs;
  const stack: { name: string; line: number; snap: () => Record<string, unknown> }[] = [];
  const reported = new WeakSet<object>();

  const frames = (): TFrame[] =>
    stack.map((f) => {
      let raw: Record<string, unknown> = {};
      try {
        raw = f.snap();
      } catch {
        /* ignore */
      }
      const locals: Record<string, TVal> = {};
      for (const [k, v] of Object.entries(raw)) locals[k] = enc(v);
      return { name: f.name, line: f.line, locals };
    });

  const record = (event: TStep['event'], line: number, extra: Partial<TStep> = {}) => {
    if (stopped) throw new StopTrace();
    if (steps.length >= maxSteps || performance.now() > deadline) {
      stopped = true;
      timedOut = performance.now() > deadline;
      throw new StopTrace();
    }
    steps.push({ line, event, frames: frames(), stdout, ...extra });
  };

  const api = {
    __at_e(name: string, line: number, snap: () => Record<string, unknown>) {
      stack.push({ name, line, snap });
      if (name !== 'global') record('call', line);
    },
    __at_t(line: number, snap?: () => Record<string, unknown>) {
      lastLine = line;
      if (stack.length) {
        const top = stack[stack.length - 1];
        top.line = line;
        if (snap) top.snap = snap; // the closure created at this statement sees its block-scoped names
      }
      record('line', line);
    },
    __at_r<T>(line: number, v: T): T {
      lastLine = line;
      if (stack.length) stack[stack.length - 1].line = line;
      record('return', line, { ret: enc(v) });
      return v;
    },
    __at_x() {
      stack.pop();
    },
    __at_ex(err: unknown) {
      if (err instanceof StopTrace || stopped) return;
      if (typeof err === 'object' && err !== null) {
        if (reported.has(err)) return;
        reported.add(err);
      }
      const msg = err instanceof Error ? `${err.name}: ${err.message}` : `Uncaught ${fmt(err)}`;
      steps.push({ line: lastLine, event: 'exception', frames: frames(), stdout, error: msg });
    },
  };

  const lines = stdin.split('\n');
  let li = 0;
  const readLine = () => (li < lines.length ? lines[li++] : null);
  const log = (...a: unknown[]) => {
    stdout += a.map((x) => fmt(x)).join(' ') + '\n';
  };
  const consoleShim = { log, info: log, debug: log, warn: log, error: log, table: log, dir: log };
  const requireShim = (m: string) => {
    if (m === 'fs') return { readFileSync: () => stdin };
    throw new Error(`require('${m}') is not available in the tracer — only 'fs' (to read stdin) is supported.`);
  };

  let result: TraceResult;
  try {
    const { code: inst } = instrument(code);
    const fn = new Function('console', 'input', 'prompt', 'readline', 'require', '__at_e', '__at_t', '__at_r', '__at_x', '__at_ex', inst);
    try {
      fn(consoleShim, readLine, readLine, readLine, requireShim, api.__at_e, api.__at_t, api.__at_r, api.__at_x, api.__at_ex);
      result = { steps, stdout };
    } catch (err) {
      if (err instanceof StopTrace || stopped) {
        result = { steps, stdout, truncated: true, error: timedOut ? { msg: `Stopped after ${Math.round(timeoutMs / 1000)}s — possible infinite loop.`, line: lastLine } : undefined };
      } else {
        const msg = err instanceof Error ? `${err.name}: ${err.message}` : `Uncaught ${fmt(err)}`;
        if (!steps.length || steps[steps.length - 1].event !== 'exception') steps.push({ line: lastLine, event: 'exception', frames: [], stdout, error: msg });
        result = { steps, stdout, error: { msg, line: lastLine } };
      }
    }
  } catch (err) {
    const line = err instanceof InstrumentError ? err.line : undefined;
    result = { steps: [], stdout, error: { msg: (err as Error).message, line } };
  }
  self.postMessage(result);
};
