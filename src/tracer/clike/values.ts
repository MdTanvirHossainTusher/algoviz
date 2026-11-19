import type { Expr, FnDecl, Param, Stmt, TypeNode } from './ast';
import type { TVal } from '../types';

/**
 * Runtime values.
 * int/short/byte → JS number (integer), long → bigint, double/float → Dbl, char → Chr,
 * bool → boolean, String / std::string → JS string (C++ mutation goes through the variable's Box).
 */
export class Chr {
  constructor(readonly c: number) {}
}
export class Dbl {
  constructor(readonly v: number) {}
}

let nextId = 1;

export class Pair {
  constructor(
    public first: V,
    public second: V,
  ) {}
}

/** vector, array, deque, stack, queue, ArrayList, LinkedList, ArrayDeque, Stack, tuple, ... */
export class Vec {
  readonly id = nextId++;
  constructor(
    public kind: string,
    public a: V[] = [],
    public et: TypeNode | null = null,
  ) {}
}

export class MapV {
  readonly id = nextId++;
  m = new Map<string, [V, V]>();
  /** Java HashMap bucket position: put() appends to a bucket, merge/compute* insert at its head */
  seq = new Map<string, number>();
  seqN = 0;
  maxSize = 0;
  version = 0;
  private order: string[] | null = null;
  private orderVersion = -1;
  constructor(
    public kind: string,
    public sorted: boolean,
    public kt: TypeNode | null = null,
    public vt: TypeNode | null = null,
    /** custom ordering for sorted maps: negative when a comes first */
    public cmp: ((a: V, b: V) => number) | null = null,
    public multi = false,
  ) {}
  touch() {
    this.version++;
    if (this.m.size > this.maxSize) this.maxSize = this.m.size;
  }
  keys(): string[] {
    if (this.orderVersion === this.version && this.order) return this.order;
    const ks = [...this.m.keys()];
    if (this.sorted) {
      const c = this.cmp ?? cmpVal;
      ks.sort((x, y) => c(this.m.get(x)![0], this.m.get(y)![0]));
    } else if (this.kind === 'HashMap') {
      const pos = new Map(ks.map((k, i) => [k, this.seq.get(k) ?? i]));
      javaHashOrder(ks, (k) => this.m.get(k)![0], this.maxSize, (k) => pos.get(k)!);
    }
    this.order = ks;
    this.orderVersion = this.version;
    return ks;
  }
}

export class SetV {
  readonly id = nextId++;
  /** key → [value, count] (count > 1 only for multiset) */
  m = new Map<string, [V, number]>();
  maxSize = 0;
  version = 0;
  private order: string[] | null = null;
  private orderVersion = -1;
  constructor(
    public kind: string,
    public sorted: boolean,
    public et: TypeNode | null = null,
    public cmp: ((a: V, b: V) => number) | null = null,
    public multi = false,
  ) {}
  touch() {
    this.version++;
    if (this.m.size > this.maxSize) this.maxSize = this.m.size;
  }
  get size() {
    let n = 0;
    for (const [, c] of this.m.values()) n += c;
    return n;
  }
  keys(): string[] {
    if (this.orderVersion === this.version && this.order) return this.order;
    const ks = [...this.m.keys()];
    if (this.sorted) {
      const c = this.cmp ?? cmpVal;
      ks.sort((x, y) => c(this.m.get(x)![0], this.m.get(y)![0]));
    } else if (this.kind === 'HashSet') {
      const pos = new Map(ks.map((k, i) => [k, i]));
      javaHashOrder(ks, (k) => this.m.get(k)![0], this.maxSize, (k) => pos.get(k)!);
    }
    this.order = ks;
    this.orderVersion = this.version;
    return ks;
  }
  /** values in iteration order, multiset duplicates expanded */
  values(): V[] {
    const out: V[] = [];
    for (const k of this.keys()) {
      const [v, c] = this.m.get(k)!;
      for (let i = 0; i < c; i++) out.push(v);
    }
    return out;
  }
}

/** binary heap; `before(a, b)` is true when a must come out before b */
export class PQ {
  readonly id = nextId++;
  a: V[] = [];
  constructor(
    public kind: string,
    public before: (a: V, b: V) => boolean,
    public et: TypeNode | null = null,
  ) {}
  push(v: V) {
    const a = this.a;
    a.push(v);
    let i = a.length - 1;
    while (i > 0) {
      const p = (i - 1) >> 1;
      if (!this.before(a[i], a[p])) break;
      [a[i], a[p]] = [a[p], a[i]];
      i = p;
    }
  }
  pop(): V {
    const a = this.a;
    const top = a[0];
    const last = a.pop()!;
    if (a.length) {
      a[0] = last;
      let i = 0;
      for (;;) {
        const l = 2 * i + 1;
        const r = l + 1;
        let m = i;
        if (l < a.length && this.before(a[l], a[m])) m = l;
        if (r < a.length && this.before(a[r], a[m])) m = r;
        if (m === i) break;
        [a[i], a[m]] = [a[m], a[i]];
        i = m;
      }
    }
    return top;
  }
  /** elements in the order they would be popped */
  ordered(): V[] {
    return [...this.a].sort((x, y) => (this.before(x, y) ? -1 : this.before(y, x) ? 1 : 0));
  }
}

export interface ClassRT {
  name: string;
  base: ClassRT | null;
  decl: import('./ast').ClassDecl | null;
  statics: Map<string, Box>;
  isException?: boolean;
}

export class Obj {
  readonly id = nextId++;
  f = new Map<string, V>();
  constructor(public cls: ClassRT) {}
}

/** C++ pointer to a heap object (canonical per object, so === means same address) */
export class Ptr {
  private static cache = new WeakMap<Obj, Ptr>();
  private constructor(readonly o: Obj) {}
  static to(o: Obj): Ptr {
    let p = Ptr.cache.get(o);
    if (!p) {
      p = new Ptr(o);
      Ptr.cache.set(o, p);
    }
    return p;
  }
}

/** something indexable an iterator can walk: a Vec, or a C++ string held in a Box */
export type SeqSrc = Vec | Box;

export class It {
  constructor(
    readonly src: SeqSrc,
    readonly i: number,
    readonly rev = false,
  ) {}
}

/** iterator into a map/set: index into the current key order (end = size) */
export class MIt {
  constructor(
    readonly src: MapV | SetV,
    readonly i: number,
    /** reverse iterator: ++ moves towards the front */
    readonly rev = false,
  ) {}
}

/** Java Iterator over a snapshot */
export class JIter {
  i = 0;
  constructor(
    readonly items: V[],
    readonly onRemove?: (v: V) => void,
  ) {}
}

export class SB {
  readonly id = nextId++;
  constructor(public s = '') {}
}

export class Closure {
  constructor(
    public name: string,
    public params: Param[],
    public body: Stmt[] | Expr,
    public scope: Scope,
    public self: V,
    public cls: ClassRT | null,
    public line: number,
    public ret?: TypeNode,
  ) {}
}

export class FnRef {
  constructor(
    public name: string,
    public decls: FnDecl[],
    public self: V = null,
    public cls: ClassRT | null = null,
  ) {}
}

export class Native {
  constructor(
    public name: string,
    public call: (args: V[]) => V,
  ) {}
}

export class Stream {
  /** for cout: fixed / precision; for Scanner/readers nothing */
  fixed = false;
  precision = 6;
  boolalpha = false;
  fail = false;
  width = 0;
  fill = ' ';
  constructor(
    public kind: 'cin' | 'cout' | 'cerr' | 'scanner' | 'reader' | 'writer' | 'system' | 'sysout',
  ) {}
}

/** wraps an existing lvalue so a reference parameter can bind to it from library code */
export class BoxRef {
  constructor(readonly box: Box) {}
}

/** iostream manipulators: endl, setprecision(n), fixed, setw(n), … */
export class Manip {
  constructor(
    readonly kind: string,
    readonly n: number,
  ) {}
}

/** &x passed to scanf */
export class Addr {
  constructor(readonly box: Box) {}
}

export class Tokenizer {
  constructor(
    public toks: string[],
    public i = 0,
  ) {}
}

export class ExcV {
  constructor(
    public type: string,
    public msg: string,
  ) {}
}

/** marker for a type used as a value: `greater<int>()`, `Integer`, `Math` */
export class TypeVal {
  constructor(readonly ty: TypeNode) {}
}

export type V =
  | number | bigint | boolean | string | null | undefined
  | Chr | Dbl | Pair | Vec | MapV | SetV | PQ | Obj | Ptr | It | MIt | JIter | SB
  | Closure | FnRef | Native | Stream | Tokenizer | ExcV | TypeVal | Manip | Addr | BoxRef;

// ---------- boxes (lvalues) ----------
export interface Box {
  get(): V;
  set(v: V): void;
  ty: TypeNode | null;
}

export class VarBox implements Box {
  constructor(
    public v: V,
    public ty: TypeNode | null,
  ) {}
  get() {
    return this.v;
  }
  set(v: V) {
    this.v = v;
  }
}

export class Scope {
  vars = new Map<string, Box>();
  constructor(public parent: Scope | null) {}
  lookup(name: string): Box | undefined {
    for (let s: Scope | null = this; s; s = s.parent) {
      const b = s.vars.get(name);
      if (b) return b;
    }
    return undefined;
  }
}

// ---------- numbers ----------
export const isNum = (v: V): v is number | bigint | Chr | Dbl | boolean =>
  typeof v === 'number' || typeof v === 'bigint' || v instanceof Chr || v instanceof Dbl || typeof v === 'boolean';

export function toNumber(v: V): number {
  if (typeof v === 'number') return v;
  if (typeof v === 'bigint') return Number(v);
  if (v instanceof Chr) return v.c;
  if (v instanceof Dbl) return v.v;
  if (typeof v === 'boolean') return v ? 1 : 0;
  throw new TypeError(`expected a number but got ${describe(v)}`);
}

export function toBig(v: V): bigint {
  if (typeof v === 'bigint') return v;
  if (v instanceof Dbl) {
    if (!Number.isFinite(v.v)) return v.v > 0 ? 9223372036854775807n : -9223372036854775808n;
    return BigInt(Math.trunc(v.v));
  }
  return BigInt(toNumber(v));
}

export function toInt(v: V): number {
  if (typeof v === 'number') return v | 0;
  if (typeof v === 'bigint') return Number(BigInt.asIntN(32, v));
  if (v instanceof Dbl) {
    const x = v.v;
    if (Number.isNaN(x)) return 0;
    if (x >= 2147483647) return 2147483647;
    if (x <= -2147483648) return -2147483648;
    return Math.trunc(x);
  }
  return toNumber(v) | 0;
}

export function describe(v: V): string {
  if (v === null) return 'null';
  if (v === undefined) return 'void';
  if (typeof v !== 'object') return typeof v;
  if (v instanceof Vec) return v.kind;
  if (v instanceof Obj) return v.cls.name;
  return v.constructor.name;
}

// ---------- hashing / comparison ----------
export function keyOf(v: V, java: boolean): string {
  if (typeof v === 'number') return `i${v}`;
  if (typeof v === 'bigint') return `i${v}`;
  if (typeof v === 'string') return `s${v}`;
  if (typeof v === 'boolean') return v ? 'T' : 'F';
  if (v === null || v === undefined) return 'n';
  if (v instanceof Chr) return `c${v.c}`;
  if (v instanceof Dbl) return Number.isInteger(v.v) && !java ? `i${v.v}` : `d${v.v}`;
  if (v instanceof Pair) return `p(${keyOf(v.first, java)},${keyOf(v.second, java)})`;
  if (v instanceof Vec) return `v[${v.a.map((x) => keyOf(x, java)).join(',')}]`;
  if (v instanceof Ptr) return `P${v.o.id}`;
  if (v instanceof Obj) {
    if (java && !v.cls.decl?.methods.some((m) => m.name === 'equals')) return `o${v.id}`;
    return `o${v.cls.name}{${[...v.f.values()].map((x) => keyOf(x, java)).join(',')}}`;
  }
  if (v instanceof SetV) return `S{${v.values().map((x) => keyOf(x, java)).join(',')}}`;
  if (v instanceof MapV) return `M{${v.keys().map((k) => `${k}:${keyOf(v.m.get(k)![1], java)}`).join(',')}}`;
  if (v instanceof SB) return `B${v.id}`;
  return `x${(v as { id?: number }).id ?? Math.random()}`;
}

/** hooks the interpreter installs for user-defined ordering (operator<, compareTo) */
export const hooks: { userCmp: ((a: Obj, b: Obj) => number) | null } = { userCmp: null };

export function cmpVal(a: V, b: V): number {
  if (isNum(a) && isNum(b)) {
    if (typeof a === 'bigint' || typeof b === 'bigint') {
      if (!(a instanceof Dbl) && !(b instanceof Dbl)) {
        const x = toBig(a);
        const y = toBig(b);
        return x < y ? -1 : x > y ? 1 : 0;
      }
    }
    const x = toNumber(a);
    const y = toNumber(b);
    return x < y ? -1 : x > y ? 1 : 0;
  }
  if (typeof a === 'string' && typeof b === 'string') return a < b ? -1 : a > b ? 1 : 0;
  if (a instanceof Pair && b instanceof Pair) return cmpVal(a.first, b.first) || cmpVal(a.second, b.second);
  if (a instanceof Vec && b instanceof Vec) {
    const n = Math.min(a.a.length, b.a.length);
    for (let i = 0; i < n; i++) {
      const c = cmpVal(a.a[i], b.a[i]);
      if (c) return c;
    }
    return a.a.length - b.a.length;
  }
  if (a instanceof Obj && b instanceof Obj && hooks.userCmp) return hooks.userCmp(a, b);
  if (a instanceof Ptr && b instanceof Ptr) return a.o.id - b.o.id;
  if (a instanceof It && b instanceof It) return a.i - b.i;
  if (a instanceof MIt && b instanceof MIt) return a.i - b.i;
  if (a === null && b === null) return 0;
  throw new TypeError(`cannot compare ${describe(a)} with ${describe(b)}`);
}

export function eqVal(a: V, b: V): boolean {
  if (a === b) return true;
  if (isNum(a) && isNum(b)) return cmpVal(a, b) === 0;
  if (a === null || b === null || a === undefined || b === undefined) return a === b || (a == null && b == null);
  if (typeof a === 'string' || typeof b === 'string') return a === b;
  if (a instanceof Pair && b instanceof Pair) return eqVal(a.first, b.first) && eqVal(a.second, b.second);
  if (a instanceof Vec && b instanceof Vec) return a.a.length === b.a.length && a.a.every((x, i) => eqVal(x, b.a[i]));
  if (a instanceof It && b instanceof It) return a.src === b.src && a.i === b.i;
  if (a instanceof MIt && b instanceof MIt) return a.src === b.src && a.i === b.i;
  if (a instanceof MapV && b instanceof MapV) return a.m.size === b.m.size && [...a.m].every(([k, [, v]]) => b.m.has(k) && eqVal(v, b.m.get(k)![1]));
  if (a instanceof SetV && b instanceof SetV) return a.m.size === b.m.size && [...a.m.keys()].every((k) => b.m.has(k));
  return false;
}

export function copyVal(v: V): V {
  if (typeof v !== 'object' || v === null) return v;
  if (v instanceof Vec) return v.kind === 'array' ? v : new Vec(v.kind, v.a.map(copyVal), v.et);
  if (v instanceof Pair) return new Pair(copyVal(v.first), copyVal(v.second));
  if (v instanceof Obj) {
    const o = new Obj(v.cls);
    for (const [k, x] of v.f) o.f.set(k, x instanceof Vec && x.kind === 'array' ? new Vec('array', x.a.map(copyVal), x.et) : copyVal(x));
    return o;
  }
  if (v instanceof MapV) {
    const m = new MapV(v.kind, v.sorted, v.kt, v.vt, v.cmp, v.multi);
    for (const [k, [a, b]] of v.m) m.m.set(k, [copyVal(a), copyVal(b)]);
    m.touch();
    return m;
  }
  if (v instanceof SetV) {
    const s = new SetV(v.kind, v.sorted, v.et, v.cmp, v.multi);
    for (const [k, [a, c]] of v.m) s.m.set(k, [copyVal(a), c]);
    s.touch();
    return s;
  }
  if (v instanceof PQ) {
    const p = new PQ(v.kind, v.before, v.et);
    p.a = v.a.map(copyVal);
    return p;
  }
  return v;
}

// ---------- Java HashMap iteration order ----------
function javaHash(v: V): number | null {
  if (typeof v === 'number') return v | 0;
  if (typeof v === 'bigint') return Number(BigInt.asIntN(32, v ^ (v >> 32n)));
  if (v instanceof Chr) return v.c;
  if (typeof v === 'boolean') return v ? 1231 : 1237;
  if (typeof v === 'string') {
    let h = 0;
    for (let i = 0; i < v.length; i++) h = (Math.imul(31, h) + v.charCodeAt(i)) | 0;
    return h;
  }
  return null;
}

/** Orders keys the way java.util.HashMap iterates them (bucket order), so printed maps match real Java. */
function javaHashOrder(ks: string[], val: (k: string) => V, maxSize: number, pos: (k: string) => number) {
  let cap = 16;
  while (maxSize > cap * 0.75) cap *= 2;
  const idx = new Map<string, number>();
  for (const k of ks) {
    const h = javaHash(val(k));
    if (h === null) return; // unknown hash → keep insertion order
    idx.set(k, ((h ^ (h >>> 16)) & (cap - 1)) >>> 0);
  }
  ks.sort((a, b) => idx.get(a)! - idx.get(b)! || pos(a) - pos(b));
}

// ---------- number formatting ----------
/** printf %g / default iostream formatting */
export function fmtG(x: number, p = 6): string {
  if (Number.isNaN(x)) return x < 0 ? '-nan' : 'nan';
  if (!Number.isFinite(x)) return x < 0 ? '-inf' : 'inf';
  if (x === 0) return Object.is(x, -0) ? '-0' : '0';
  if (p === 0) p = 1;
  const e = x.toExponential(p - 1);
  const exp = parseInt(e.slice(e.indexOf('e') + 1), 10);
  if (exp < -4 || exp >= p) {
    let [m, ex] = e.split('e');
    if (m.includes('.')) m = m.replace(/0+$/, '').replace(/\.$/, '');
    const n = Math.abs(parseInt(ex, 10));
    return `${m}e${ex[0] === '-' ? '-' : '+'}${n < 10 ? '0' : ''}${n}`;
  }
  let s = x.toFixed(Math.max(0, p - 1 - exp));
  if (s.includes('.')) s = s.replace(/0+$/, '').replace(/\.$/, '');
  return s;
}

export function fmtExp(x: number, prec: number, upper = false): string {
  if (!Number.isFinite(x)) return fmtG(x);
  const [m, ex] = x.toExponential(prec).split('e');
  const n = Math.abs(parseInt(ex, 10));
  const s = `${m}e${ex[0] === '-' ? '-' : '+'}${n < 10 ? '0' : ''}${n}`;
  return upper ? s.toUpperCase() : s;
}

export function javaDouble(x: number): string {
  if (Number.isNaN(x)) return 'NaN';
  if (!Number.isFinite(x)) return x < 0 ? '-Infinity' : 'Infinity';
  if (x === 0) return Object.is(x, -0) ? '-0.0' : '0.0';
  const a = Math.abs(x);
  if (a >= 1e-3 && a < 1e7) {
    const s = String(x);
    return s.includes('.') ? s : `${s}.0`;
  }
  const [m, ex] = x.toExponential().split('e');
  return `${m.includes('.') ? m : `${m}.0`}E${parseInt(ex, 10)}`;
}

export function charStr(c: Chr) {
  return String.fromCharCode(c.c);
}

// ---------- encoding for the trace view ----------
export function enc(v: V, java: boolean, depth = 0, seen: Set<unknown> = new Set()): TVal {
  if (v === null) return { t: 'none', v: java ? 'null' : 'nullptr' };
  if (v === undefined) return { t: 'none', v: 'void' };
  switch (typeof v) {
    case 'number':
      return { t: 'num', v };
    case 'bigint':
      return Number.isSafeInteger(Number(v)) ? { t: 'num', v: Number(v) } : { t: 'other', repr: v.toString() };
    case 'boolean':
      return { t: 'bool', v };
    case 'string':
      return { t: 'str', v: v.length > 200 ? `${v.slice(0, 200)}…` : v };
  }
  if (v instanceof Chr) return { t: 'other', repr: v.c === 0 ? "'\\0'" : v.c === 10 ? "'\\n'" : v.c === 32 ? "' '" : `'${charStr(v)}'` };
  if (v instanceof Dbl) return Number.isFinite(v.v) ? { t: 'num', v: v.v } : { t: 'other', repr: java ? javaDouble(v.v) : fmtG(v.v) };
  if (seen.has(v)) return { t: 'ref', label: '↺ cycle' };
  if (depth > 4) return { t: 'ref', label: '…' };
  const s2 = new Set(seen).add(v);
  const sub = (x: V) => enc(x, java, depth + 1, s2);
  const list = (kind: string, items: V[]): TVal => ({ t: 'list', kind, items: items.slice(0, 60).map(sub), more: Math.max(0, items.length - 60) });
  if (v instanceof Pair) return { t: 'list', kind: 'tuple', items: [sub(v.first), sub(v.second)] };
  if (v instanceof Vec) return list(v.kind === 'tuple' ? 'tuple' : v.kind, v.a);
  if (v instanceof SetV) return list(v.sorted ? 'sorted set' : 'set', v.values());
  if (v instanceof PQ) return list(v.kind, v.ordered());
  if (v instanceof MapV) {
    const ks = v.keys();
    return {
      t: 'dict',
      kind: v.kind,
      entries: ks.slice(0, 40).map((k) => {
        const [kk, vv] = v.m.get(k)!;
        return [keyLabel(kk, java), sub(vv)] as [string, TVal];
      }),
      more: Math.max(0, ks.length - 40),
    };
  }
  if (v instanceof Ptr) return encObj(v.o, java, depth, s2, `${v.o.cls.name}*`);
  if (v instanceof Obj) return encObj(v, java, depth, s2, v.cls.name);
  if (v instanceof SB) return { t: 'str', v: v.s };
  if (v instanceof It) return { t: 'other', repr: `iterator @${v.i}` };
  if (v instanceof MIt) {
    const ks = v.src.keys();
    if (v.i >= ks.length) return { t: 'other', repr: 'end()' };
    const e = v.src.m.get(ks[v.i])!;
    return { t: 'other', repr: `iterator → ${keyLabel(e[0], java)}` };
  }
  if (v instanceof Closure) return { t: 'fn', name: v.name };
  if (v instanceof FnRef || v instanceof Native) return { t: 'fn', name: v.name };
  if (v instanceof Stream) return { t: 'other', repr: v.kind === 'scanner' ? 'Scanner' : v.kind };
  if (v instanceof Tokenizer) return { t: 'other', repr: `StringTokenizer(${v.toks.length - v.i} left)` };
  if (v instanceof ExcV) return { t: 'other', repr: `${v.type}: ${v.msg}` };
  if (v instanceof JIter) return { t: 'other', repr: 'Iterator' };
  if (v instanceof TypeVal) return { t: 'other', repr: v.ty.name };
  return { t: 'other', repr: String(v) };
}

function encObj(o: Obj, java: boolean, depth: number, seen: Set<unknown>, cls: string): TVal {
  const entries = [...o.f.entries()];
  return { t: 'dict', kind: 'object', cls, entries: entries.slice(0, 30).map(([k, x]) => [k, enc(x, java, depth + 1, seen)]), more: Math.max(0, entries.length - 30) };
}

function keyLabel(k: V, java: boolean): string {
  if (typeof k === 'string') return JSON.stringify(k);
  if (k instanceof Chr) return `'${charStr(k)}'`;
  if (k instanceof Pair) return `(${keyLabel(k.first, java)}, ${keyLabel(k.second, java)})`;
  if (k instanceof Dbl) return java ? javaDouble(k.v) : fmtG(k.v);
  if (k instanceof Vec) return `[${k.a.map((x) => keyLabel(x, java)).join(', ')}]`;
  if (k === null) return 'null';
  if (k instanceof Obj || k instanceof Ptr) return (k instanceof Ptr ? k.o : k).cls.name;
  return String(k);
}
