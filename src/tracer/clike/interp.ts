import type { ClassDecl, Declarator, Expr, FnDecl, Param, Program, Stmt, TypeNode } from './ast';
import { T } from './ast';
import type { TFrame, TStep, TVal, TraceResult } from '../types';
import {
  Addr, Box, BoxRef, Chr, ClassRT, Closure, Dbl, Manip, ExcV, FnRef, It, JIter, MIt, MapV, Native, Obj, PQ, Pair, Ptr, SB, Scope, SetV, Stream, Tokenizer, TypeVal, V, VarBox, Vec,
  charStr, cmpVal, copyVal, describe, enc, eqVal, fmtG, hooks, isNum, javaDouble, keyOf, toBig, toInt, toNumber,
} from './values';
import { callBuiltinFn, callMethod, callStatic, staticField, lvMethod, isStaticClass, makeJavaNew, makeCppConstruct, defaultContainer, iterLen } from './lib';

export class StopTrace {}
export class ExitSignal {
  constructor(public code: number) {}
}
/** a fatal runtime error (undefined behaviour in C++, an internal limit, …) */
export class RtError extends Error {
  reported = false;
  constructor(
    msg: string,
    public line?: number,
  ) {
    super(msg);
  }
}
/** a language-level exception (throw / Java runtime exceptions / std::out_of_range) */
export class Throw {
  reported = false;
  constructor(
    public v: V,
    public line: number,
  ) {}
}

type Comp = undefined | { k: 'break'; label?: string } | { k: 'continue'; label?: string } | { k: 'return'; v: V };

interface Frame {
  name: string;
  line: number;
  scope: Scope;
  root: Scope;
  self: V;
  cls: ClassRT | null;
  fn: FnDecl | null;
  ret: TypeNode | null;
}

// ---------- boxes ----------
export class ElemBox implements Box {
  constructor(
    public vec: Vec,
    public i: number,
    public it: Interp,
  ) {}
  get ty() {
    return this.vec.et;
  }
  check() {
    if (this.i < 0 || this.i >= this.vec.a.length || !Number.isInteger(this.i)) this.it.indexError(this.i, this.vec.a.length, this.vec.kind);
  }
  get() {
    this.check();
    return this.vec.a[this.i];
  }
  set(v: V) {
    this.check();
    this.vec.a[this.i] = this.it.coerce(this.vec.et, v);
  }
}

export class StrCharBox implements Box {
  ty = T('char');
  constructor(
    public sb: Box,
    public i: number,
    public it: Interp,
  ) {}
  get(): V {
    const s = this.sb.get() as string;
    if (this.i === s.length && !this.it.java) return new Chr(0);
    if (this.i < 0 || this.i >= s.length) this.it.indexError(this.i, s.length, 'string');
    return new Chr(s.charCodeAt(this.i));
  }
  set(v: V) {
    const s = this.sb.get() as string;
    if (this.i < 0 || this.i >= s.length) this.it.indexError(this.i, s.length, 'string');
    const c = charStr(this.it.coerce(T('char'), v) as Chr);
    this.sb.set(s.slice(0, this.i) + c + s.slice(this.i + 1));
  }
}

export class FieldBox implements Box {
  constructor(
    public o: Obj,
    public name: string,
    public ty: TypeNode | null,
    public it: Interp,
  ) {}
  get() {
    return this.o.f.get(this.name);
  }
  set(v: V) {
    this.o.f.set(this.name, this.it.coerce(this.ty, v));
  }
}

export class PropBox implements Box {
  ty: TypeNode | null = null;
  constructor(
    public o: Pair,
    public k: 'first' | 'second',
    public it: Interp,
  ) {}
  get() {
    return this.o[this.k];
  }
  set(v: V) {
    this.o[this.k] = this.it.java ? v : copyVal(v);
  }
}

export class MapBox implements Box {
  constructor(
    public m: MapV,
    public key: V,
    public it: Interp,
  ) {}
  get ty() {
    return this.m.vt;
  }
  get(): V {
    const k = keyOf(this.key, this.it.java);
    let e = this.m.m.get(k);
    if (!e) {
      // C++ operator[] inserts a value-initialized element on read
      e = [this.key, this.it.defaultVal(this.m.vt)];
      this.m.m.set(k, e);
      this.m.touch();
    }
    return e[1];
  }
  set(v: V) {
    const k = keyOf(this.key, this.it.java);
    const cv = this.it.coerce(this.m.vt, v);
    const e = this.m.m.get(k);
    if (e) e[1] = cv;
    else {
      this.m.m.set(k, [this.key, cv]);
      this.m.touch();
    }
  }
}

/** a map entry whose .second writes through to the map (range-for over a map, iterator->second) */
export function mapEntry(m: MapV, k: string, it: Interp): Pair {
  const e = m.m.get(k)!;
  const p = new Pair(e[0], e[1]);
  Object.defineProperty(p, 'second', {
    get: () => (m.m.get(k) ?? e)[1],
    set: (v: V) => {
      const cur = m.m.get(k);
      if (cur) cur[1] = it.coerce(m.vt, v);
    },
  });
  Object.defineProperty(p, 'first', { get: () => e[0], set: () => it.fail('UnsupportedOperationException', 'a map key cannot be modified') });
  return p;
}

const INT_MAX = 2147483647;

export interface RunOpts {
  stdin: string;
  maxSteps: number;
  timeoutMs: number;
  maxDepth?: number;
}

export class Interp {
  java: boolean;
  steps: TStep[] = [];
  stdout = '';
  frames: Frame[] = [];
  globals = new Scope(null);
  classes = new Map<string, ClassRT>();
  functions = new Map<string, FnDecl[]>();
  line = 1;
  deadline: number;
  stopped = false;
  timedOut = false;
  showGlobal = false;
  inPos = 0;
  cout = new Stream('cout');
  cin = new Stream('cin');
  staticLocals = new WeakMap<Declarator, Box>();
  currentExc: Throw | null = null;
  randState = 12345;
  clock = 0;
  /** line where the error that ended the run first surfaced */
  errorLine: number | undefined;
  /** > 0 while a snapshot is being drawn: user code called from there records no steps */
  silent = 0;
  sameLineBody = -1;
  sameLineDepth = 0;

  constructor(
    public prog: Program,
    public opts: RunOpts,
  ) {
    this.java = prog.lang === 'java';
    this.deadline = performance.now() + opts.timeoutMs;
    hooks.userCmp = (a, b) => this.userCompare(a, b);
  }

  // ---------- errors ----------
  fail(jType: string, msg: string): never {
    if (this.java) throw new Throw(new ExcV(jType, msg), this.line);
    throw new RtError(msg, this.line);
  }
  throwExc(type: string, msg: string): never {
    throw new Throw(new ExcV(type, msg), this.line);
  }
  indexError(i: number, n: number, kind: string): never {
    if (this.java) {
      if (kind === 'string') this.throwExc('StringIndexOutOfBoundsException', `index ${i}, length ${n}`);
      if (kind === 'array') this.throwExc('ArrayIndexOutOfBoundsException', `Index ${i} out of bounds for length ${n}`);
      this.throwExc('IndexOutOfBoundsException', `Index ${i} out of bounds for length ${n}`);
    }
    throw new RtError(`index ${i} is out of range for a ${kind} of size ${n} — undefined behavior in C++ (a real program may crash or read garbage)`, this.line);
  }
  nullError(what: string): never {
    if (this.java) this.throwExc('NullPointerException', `Cannot ${what} because the value is null`);
    throw new RtError(`null pointer dereference: cannot ${what} (segmentation fault)`, this.line);
  }

  // ---------- recording ----------
  record(event: TStep['event'], line: number, extra: Partial<TStep> = {}) {
    if (this.silent) return; // user code run while drawing a snapshot (comparators of a sorted map / priority queue)
    if (this.stopped) throw new StopTrace();
    if (this.steps.length >= this.opts.maxSteps || performance.now() > this.deadline) {
      this.stopped = true;
      this.timedOut = performance.now() > this.deadline;
      throw new StopTrace();
    }
    this.steps.push({ line, event, frames: this.snapshot(), stdout: this.stdout, ...extra });
  }

  step(line: number) {
    this.line = line;
    const f = this.top;
    if (f) f.line = line;
    if (this.sameLineBody === line && this.sameLineDepth === this.frames.length) {
      // `if (x) return 1;` / `for (…) s += i;` — the body is on its header's line: one step, like Python's tracer
      this.sameLineBody = -1;
      return;
    }
    this.sameLineBody = -1;
    this.record('line', line);
  }

  /** run a branch/loop body; if it starts on the header's line, its first step merges into the header's */
  body(header: number, s: Stmt): Comp {
    if (s.k !== 'block' && s.line === header) {
      this.sameLineBody = header;
      this.sameLineDepth = this.frames.length;
    }
    return this.execScoped(s);
  }

  snapshot(): TFrame[] {
    this.silent++;
    const savedLine = this.line;
    try {
      return this.snapshotFrames();
    } finally {
      this.silent--;
      this.line = savedLine;
    }
  }

  /** encode a value for display; a failure (e.g. a comparator that throws) must not break the step */
  encSafe(v: V): TVal {
    try {
      return enc(v, this.java);
    } catch {
      return { t: 'other', repr: '?' };
    }
  }

  snapshotFrames(): TFrame[] {
    const out: TFrame[] = [];
    if (this.showGlobal) {
      const locals: TFrame['locals'] = {};
      if (this.java) {
        const multi = [...this.classes.values()].filter((c) => c.statics.size > 0).length > 1;
        for (const c of this.classes.values()) for (const [k, b] of c.statics) locals[multi ? `${c.name}.${k}` : k] = this.encSafe(b.get());
      } else for (const [k, b] of this.globals.vars) locals[k] = this.encSafe(b.get());
      out.push({ name: 'global', line: this.frames[0]?.line ?? 1, locals });
    }
    for (const f of [...this.frames]) {
      const chain: Scope[] = [];
      for (let s: Scope | null = f.scope; s; s = s.parent) {
        chain.push(s);
        if (s === f.root) break;
      }
      const locals: TFrame['locals'] = {};
      if (f.self !== null && f.self !== undefined && f.fn) locals['this'] = this.encSafe(f.self);
      for (let i = chain.length - 1; i >= 0; i--) for (const [k, b] of chain[i].vars) locals[k] = this.encSafe(b.get());
      out.push({ name: f.name, line: f.line, locals });
    }
    return out;
  }

  get top(): Frame {
    return this.frames[this.frames.length - 1];
  }

  // ---------- program start ----------
  run(): TraceResult {
    try {
      this.setup();
      if (this.java) this.runJava();
      else this.runCpp();
      return { steps: this.steps, stdout: this.stdout };
    } catch (e) {
      return this.finish(e);
    }
  }

  finish(e: unknown): TraceResult {
    if (e instanceof StopTrace || this.stopped) {
      return {
        steps: this.steps,
        stdout: this.stdout,
        truncated: true,
        error: this.timedOut ? { msg: `Stopped after ${Math.round(this.opts.timeoutMs / 1000)}s — possible infinite loop.`, line: this.line } : undefined,
      };
    }
    if (e instanceof ExitSignal) return { steps: this.steps, stdout: this.stdout };
    const msg = this.errorMessage(e);
    const line = this.errorLine ?? this.line;
    const last = this.steps[this.steps.length - 1];
    if (!last || last.event !== 'exception') this.steps.push({ line, event: 'exception', frames: [], stdout: this.stdout, error: msg });
    return { steps: this.steps, stdout: this.stdout, error: { msg, line } };
  }

  errorMessage(e: unknown): string {
    if (e instanceof Throw) {
      const v = e.v;
      if (this.java) {
        if (v instanceof ExcV) return `Exception in thread "main" ${javaExcName(v.type)}${v.msg ? `: ${v.msg}` : ''}`;
        if (v instanceof Obj) return `Exception in thread "main" ${v.cls.name}${v.f.has('message') && v.f.get('message') !== null ? `: ${v.f.get('message')}` : ''}`;
        return `Exception in thread "main" ${this.javaStr(v)}`;
      }
      if (v instanceof ExcV) return `terminate called after throwing an instance of 'std::${v.type}'\n  what():  ${v.msg}`;
      if (v instanceof Obj) return `terminate called after throwing an instance of '${v.cls.name}'`;
      return `terminate called after throwing an instance of '${describeCpp(v)}' (${this.cppStr(v, this.cout)})`;
    }
    if (e instanceof RtError) return `Runtime error: ${e.message}`;
    if (e instanceof RangeError && /call stack/i.test(e.message)) return this.java ? 'Exception in thread "main" java.lang.StackOverflowError' : 'Runtime error: stack overflow (recursion too deep)';
    if (e instanceof TypeError) return `Runtime error: ${e.message}`;
    return `Runtime error: ${(e as Error)?.message ?? String(e)}`;
  }

  setup() {
    const reg = (d: ClassDecl, outer: ClassRT | null) => {
      const rt: ClassRT = { name: d.name, base: null, decl: d, statics: new Map() };
      (rt as ClassRT & { outer?: ClassRT | null }).outer = outer;
      this.classes.set(d.name, rt);
      for (const i of d.inner) reg(i, rt);
    };
    for (const c of this.prog.classes) reg(c, null);
    for (const rt of this.classes.values()) {
      const b = rt.decl?.base;
      if (b) {
        rt.base = this.classes.get(b) ?? null;
        if (!rt.base && /Exception|Error|exception|runtime_error/.test(b)) rt.isException = true;
      }
    }
    for (const f of this.prog.functions) {
      const list = this.functions.get(f.name) ?? [];
      list.push(f);
      this.functions.set(f.name, list);
    }
  }

  runCpp() {
    const main = this.functions.get('main')?.find((f) => f.body);
    if (!main) throw new RtError("no main() function — the tracer starts the program at int main()", 1);
    this.showGlobal = this.prog.globals.some((g) => g.k === 'decl');
    // globals are initialized before main, without steps
    const gframe: Frame = { name: 'global', line: 1, scope: this.globals, root: this.globals, self: null, cls: null, fn: null, ret: null };
    this.frames.push(gframe);
    for (const g of this.prog.globals) if (g.k === 'decl') for (const d of g.decls) this.declare(d, this.globals, true);
    this.frames.pop();
    // class static members
    for (const c of this.classes.values()) this.initStatics(c);
    const r = this.invoke(main, [], null, null, main.line);
    void r;
  }

  runJava() {
    for (const c of this.classes.values()) this.initStatics(c);
    this.showGlobal = [...this.classes.values()].some((c) => c.statics.size > 0);
    let main: FnDecl | undefined;
    for (const c of this.classes.values()) {
      const m = c.decl?.methods.find((x) => x.name === 'main' && x.isStatic && x.body);
      if (m) {
        main = m;
        break;
      }
    }
    if (!main) throw new RtError('no `public static void main(String[] args)` method found — the tracer starts the program there', 1);
    const cls = this.classes.get(main.owner!.name)!;
    const args = main.params.length ? [new Vec('array', [], T('string'))] : [];
    this.invoke(main, args, null, cls, main.line, true);
  }

  initStatics(c: ClassRT) {
    const d = c.decl;
    if (!d) return;
    if (d.isEnum && d.enumConsts) {
      d.enumConsts.forEach((ec, i) => {
        const o = new Obj(c);
        o.f.set('name', ec.name);
        o.f.set('ordinal', i);
        c.statics.set(ec.name, new VarBox(o, T(c.name)));
      });
    }
    const frame: Frame = { name: 'global', line: d.line, scope: new Scope(this.globals), root: this.globals, self: null, cls: c, fn: null, ret: null };
    this.frames.push(frame);
    try {
      for (const f of d.fields) {
        if (!f.isStatic) continue;
        const v = f.init ? this.evTo(f.ty, f.init) : f.ctorArgs ? this.construct(f.ty, f.ctorArgs, f.line) : this.defaultVal(f.ty);
        c.statics.set(f.name, new VarBox(v, f.ty));
      }
      for (const s of d.staticInit) this.exec(s);
    } finally {
      this.frames.pop();
    }
  }

  // ---------- statements ----------
  execBody(stmts: Stmt[]): Comp {
    for (const s of stmts) {
      const c = this.exec(s);
      if (c) return c;
    }
    return undefined;
  }

  scoped<R>(fn: () => R): R {
    const f = this.top;
    const prev = f.scope;
    f.scope = new Scope(prev);
    try {
      return fn();
    } catch (e) {
      this.reportException(e); // while the block's variables are still visible
      throw e;
    } finally {
      f.scope = prev;
    }
  }

  execScoped(s: Stmt): Comp {
    if (s.k === 'block') return this.exec(s);
    return this.scoped(() => this.exec(s));
  }

  exec(s: Stmt, label?: string): Comp {
    switch (s.k) {
      case 'block':
        return this.scoped(() => this.execBody(s.body));
      case 'empty':
        return undefined;
      case 'expr':
        this.step(s.line);
        this.ev(s.e);
        return undefined;
      case 'decl':
        this.step(s.line);
        for (const d of s.decls) {
          if (s.isStatic && !this.java) {
            let b = this.staticLocals.get(d);
            if (!b) {
              this.declare(d, this.top.scope);
              b = this.top.scope.vars.get(d.name)!;
              this.staticLocals.set(d, b);
            } else this.top.scope.vars.set(d.name, b);
          } else this.declare(d, this.top.scope);
        }
        return undefined;
      case 'if':
        this.step(s.line);
        if (this.truthy(this.ev(s.c))) return this.body(s.line, s.t);
        if (s.f) return this.body(s.line, s.f);
        return undefined;
      case 'while':
        for (;;) {
          this.step(s.line);
          if (!this.truthy(this.ev(s.c))) return undefined;
          const c = this.body(s.line, s.body);
          const r = loopComp(c, label);
          if (r === 'break') return undefined;
          if (r !== 'next') return c;
        }
      case 'do':
        for (;;) {
          const c = this.execScoped(s.body);
          const r = loopComp(c, label);
          if (r === 'break') return undefined;
          if (r !== 'next') return c;
          this.step(s.condLine);
          if (!this.truthy(this.ev(s.c))) return undefined;
        }
      case 'for':
        return this.scoped(() => {
          this.step(s.line);
          if (s.init) {
            if (s.init.k === 'decl') for (const d of s.init.decls) this.declare(d, this.top.scope);
            else if (s.init.k === 'expr') this.ev(s.init.e);
          }
          let first = true;
          for (;;) {
            if (!first) {
              this.step(s.line);
              if (s.step) this.ev(s.step);
            }
            first = false;
            if (s.c && !this.truthy(this.ev(s.c))) return undefined;
            const c = this.body(s.line, s.body);
            const r = loopComp(c, label);
            if (r === 'break') return undefined;
            if (r !== 'next') return c;
          }
        });
      case 'foreach':
        return this.foreach(s, label);
      case 'switch':
        return this.switchStmt(s, label);
      case 'return': {
        this.step(s.line);
        const f = this.top;
        const v = s.e ? this.evTo(f.ret && f.ret.name !== 'auto' ? f.ret : null, s.e) : undefined;
        return { k: 'return', v };
      }
      case 'break':
        this.step(s.line);
        return { k: 'break', label: s.label };
      case 'continue':
        this.step(s.line);
        return { k: 'continue', label: s.label };
      case 'throw': {
        this.step(s.line);
        if (!s.e) {
          if (!this.currentExc) throw new RtError('throw; with no active exception — std::terminate', s.line);
          throw new Throw(this.currentExc.v, s.line);
        }
        let v = this.ev(s.e);
        if (v instanceof Ptr) v = v.o;
        const t = new Throw(v, s.line);
        this.reportException(t);
        throw t;
      }
      case 'try':
        return this.tryStmt(s);
      case 'label': {
        const c = this.exec(s.body, s.label);
        if (c && (c.k === 'break' || c.k === 'continue') && c.label === s.label) return undefined;
        return c;
      }
    }
  }

  tryStmt(s: Extract<Stmt, { k: 'try' }>): Comp {
    let comp: Comp;
    try {
      comp = this.exec(s.body);
    } catch (e) {
      const thrown = this.toThrow(e);
      if (!thrown) {
        if (s.fin) this.exec(s.fin);
        throw e;
      }
      const h = s.catches.find((c) => this.catchMatches(c.ty, thrown.v));
      if (!h) {
        if (s.fin) this.exec(s.fin);
        throw thrown;
      }
      const prevExc = this.currentExc;
      this.currentExc = thrown;
      try {
        comp = this.scoped(() => {
          if (h.name) this.top.scope.vars.set(h.name, new VarBox(thrown.v, h.ty));
          return this.exec(h.body);
        });
      } finally {
        this.currentExc = prevExc;
        if (s.fin) {
          const fc = this.exec(s.fin);
          if (fc) return fc;
        }
      }
      return comp;
    }
    if (s.fin) {
      const fc = this.exec(s.fin);
      if (fc) return fc;
    }
    return comp;
  }

  /** turn catchable errors into Throw (null = not catchable) */
  toThrow(e: unknown): Throw | null {
    if (e instanceof Throw) return e;
    if (e instanceof StopTrace || e instanceof ExitSignal || e instanceof RtError) return null;
    if (this.java && e instanceof RangeError && /call stack/i.test(e.message)) return new Throw(new ExcV('StackOverflowError', ''), this.line);
    return null;
  }

  catchMatches(ty: TypeNode | null, v: V): boolean {
    if (!ty) return true;
    const want = ty.orig ?? ty.name;
    if (v instanceof ExcV) return excIsA(v.type, want, this.java);
    if (v instanceof Obj) {
      for (let c: ClassRT | null = v.cls; c; c = c.base) {
        if (c.name === want) return true;
        if (!c.base && c.decl?.base) return excIsA(c.decl.base, want, this.java);
      }
      return false;
    }
    if (ty.ptr) return v instanceof Ptr;
    const n = ty.name;
    if (n === 'int' || n === 'long' || n === 'uint' || n === 'ulong') return typeof v === 'number' || typeof v === 'bigint';
    if (n === 'double') return v instanceof Dbl;
    if (n === 'char') return v instanceof Chr;
    if (n === 'string') return typeof v === 'string';
    if (n === 'bool') return typeof v === 'boolean';
    return want === 'exception' || want === 'Exception' || want === 'Throwable';
  }

  foreach(s: Extract<Stmt, { k: 'foreach' }>, label?: string): Comp {
    this.step(s.line);
    const src = s.e.k === 'init' ? this.fromInit(null, s.e) : this.ev(s.e);
    const d = s.decl;
    const isRef = d.ty.ref;
    // build per-iteration boxes lazily so mutation during iteration behaves like the real container
    let n = 0;
    let at: (i: number) => Box;
    if (src instanceof Vec) {
      n = src.a.length;
      at = (i) => (isRef ? new ElemBox(src, i, this) : new VarBox(src.a[i], null));
    } else if (typeof src === 'string') {
      const sbox = new VarBox(src, T('string'));
      n = src.length;
      at = (i) => new VarBox(new Chr(src.charCodeAt(i)), null);
      void sbox;
    } else if (src instanceof SetV) {
      const vals = src.values();
      n = vals.length;
      at = (i) => new VarBox(vals[i], null);
    } else if (src instanceof MapV) {
      const ks = [...src.keys()];
      n = ks.length;
      at = (i) => new VarBox(mapEntry(src, ks[i], this), null);
    } else if (src instanceof PQ) {
      const vals = [...src.a];
      n = vals.length;
      at = (i) => new VarBox(vals[i], null);
    } else if (src === null) this.nullError('iterate over null');
    else throw new RtError(`cannot iterate over a ${describe(src)} with a range-for`, s.line);

    // a box for a string element reference
    if (typeof src === 'string' && isRef) {
      const sb = s.e.k === 'id' || s.e.k === 'member' || s.e.k === 'index' ? this.lv(s.e) : new VarBox(src, T('string'));
      at = (i) => new StrCharBox(sb, i, this);
    }
    const len = () => (src instanceof Vec ? src.a.length : n);
    for (let i = 0; i < len(); i++) {
      if (i > 0) this.step(s.line);
      const c = this.scoped(() => {
        const b = at(i);
        this.bindLoopVar(d, b, isRef);
        return this.body(s.line, s.body);
      });
      const r = loopComp(c, label);
      if (r === 'break') return undefined;
      if (r !== 'next') return c;
    }
    return undefined;
  }

  bindLoopVar(d: Declarator, b: Box, isRef: boolean) {
    const scope = this.top.scope;
    if (d.binding) {
      this.bindStructured(d.binding, b.get(), isRef, scope);
      return;
    }
    if (isRef) scope.vars.set(d.name, b);
    else {
      const ty = d.ty.name === 'auto' ? this.inferType(b.get()) : d.ty;
      scope.vars.set(d.name, new VarBox(this.coerce(ty, b.get()), ty));
    }
  }

  bindStructured(names: string[], v: V, isRef: boolean, scope: Scope) {
    let parts: Box[];
    if (v instanceof Pair) parts = [new PropBox(v, 'first', this), new PropBox(v, 'second', this)];
    else if (v instanceof Vec) parts = v.a.map((_, i) => new ElemBox(v, i, this));
    else if (v instanceof Obj || v instanceof Ptr) {
      const o = v instanceof Ptr ? v.o : v;
      parts = [...o.f.keys()].map((k) => new FieldBox(o, k, null, this));
    } else throw new RtError(`cannot destructure a ${describe(v)}`, this.line);
    if (parts.length < names.length) throw new RtError(`structured binding needs ${names.length} elements but the value has ${parts.length}`, this.line);
    names.forEach((n, i) => scope.vars.set(n, isRef ? parts[i] : new VarBox(copyVal(parts[i].get()), null)));
  }

  switchStmt(s: Extract<Stmt, { k: 'switch' }>, label?: string): Comp {
    this.step(s.line);
    const v = this.ev(s.e);
    return this.scoped(() => {
      let start = s.cases.findIndex((c) => c.test !== null && this.caseEq(v, c.test));
      if (start < 0) start = s.cases.findIndex((c) => c.test === null);
      if (start < 0) return undefined;
      for (let i = start; i < s.cases.length; i++) {
        const c = this.execBody(s.cases[i].body);
        if (c) {
          if (c.k === 'break' && (!c.label || c.label === label)) return undefined;
          return c;
        }
      }
      return undefined;
    });
  }

  caseEq(v: V, test: Expr): boolean {
    if (test.k === 'id' && v instanceof Obj && v.cls.decl?.isEnum) return v.f.get('name') === test.name;
    return eqVal(v, this.ev(test));
  }

  // ---------- declarations ----------
  declare(d: Declarator, scope: Scope, isGlobal = false) {
    const ty = d.ty;
    if (d.binding) {
      const v = d.init ? this.ev(d.init) : null;
      if (ty.ref) {
        const b = d.init && isLvalueExpr(d.init) ? this.lv(d.init) : new VarBox(v, null);
        this.bindStructured(d.binding, b.get(), true, scope);
      } else this.bindStructured(d.binding, copyVal(v), false, scope);
      return;
    }
    if (ty.ref && !this.java) {
      if (!d.init) throw new RtError(`reference '${d.name}' must be initialized`, this.line);
      const b = isLvalueExpr(d.init) ? this.lv(d.init) : new VarBox(this.evTo({ ...ty, ref: false }, d.init), { ...ty, ref: false });
      scope.vars.set(d.name, b);
      return;
    }
    let v: V;
    let boxTy: TypeNode | null = ty;
    if (!this.java && ty.dims && ty.dims.length) {
      v = this.makeCArray(ty, d.init, isGlobal);
    } else if (d.ctorArgs) v = this.construct(ty, d.ctorArgs, this.line);
    else if (d.init) {
      if (ty.name === 'auto' && !ty.ptr) {
        v = d.init.k === 'init' ? this.fromInit(null, d.init) : copyIfCpp(this.ev(d.init), this.java);
        boxTy = this.inferType(v);
      } else v = this.evTo(ty, d.init);
    } else v = this.defaultVal(ty);
    scope.vars.set(d.name, new VarBox(v, boxTy));
  }

  makeCArray(ty: TypeNode, init: Expr | undefined, _isGlobal: boolean): Vec {
    const elem: TypeNode = { ...ty, arr: 0, dims: undefined };
    const dims = ty.dims!.map((x) => (x ? toInt(this.ev(x)) : -1));
    const build = (level: number, ini: Expr | undefined): Vec => {
      let n = dims[level];
      const items = ini && ini.k === 'init' ? ini.items : null;
      if (ini && ini.k === 'str' && level === dims.length - 1) {
        const s = ini.v;
        if (n < 0) n = s.length + 1;
        return new Vec('array', Array.from({ length: n }, (_, i) => new Chr(i < s.length ? s.charCodeAt(i) : 0)), T('char'));
      }
      if (n < 0) n = items ? items.length : 0;
      if (n > 5_000_000) throw new RtError(`array of ${n} elements is too large for the tracer`, this.line);
      const a: V[] = new Array(n);
      for (let i = 0; i < n; i++) {
        const it = items?.[i];
        if (level < dims.length - 1) a[i] = build(level + 1, it);
        else a[i] = it ? this.evTo(elem, it) : this.defaultVal(elem);
      }
      return new Vec('array', a, level < dims.length - 1 ? { ...ty, dims: ty.dims!.slice(level + 1), arr: dims.length - level - 1 } : elem);
    };
    return build(0, init);
  }

  inferType(v: V): TypeNode | null {
    if (typeof v === 'number') return T('int');
    if (typeof v === 'bigint') return T('long');
    if (v instanceof Dbl) return T('double');
    if (v instanceof Chr) return T('char');
    if (typeof v === 'boolean') return T('bool');
    if (typeof v === 'string') return T('string');
    return null;
  }

  defaultVal(ty: TypeNode | null): V {
    if (!ty) return null;
    if (ty.ptr) return null;
    if (ty.arr && this.java) return null;
    switch (ty.name) {
      case 'int': case 'uint': case 'short': case 'byte':
        return this.java && ty.orig && /^[A-Z]/.test(ty.orig) ? null : 0;
      case 'long': case 'ulong':
        return this.java && ty.orig === 'Long' ? null : 0n;
      case 'double':
        return this.java && ty.orig && /^[A-Z]/.test(ty.orig) ? null : new Dbl(0);
      case 'char':
        return this.java && ty.orig === 'Character' ? null : new Chr(0);
      case 'bool':
        return this.java && ty.orig === 'Boolean' ? null : false;
      case 'string':
        return this.java ? null : '';
      case 'auto': case 'void':
        return null;
    }
    if (this.java) return null;
    const c = this.classes.get(ty.name);
    if (c) return this.newObject(c, [], this.line, null);
    return defaultContainer(this, ty);
  }

  // ---------- coercion ----------
  coerce(ty: TypeNode | null, v: V): V {
    if (!ty) return this.java ? v : copyVal(v);
    if (ty.ptr || ty.arr) {
      if (!this.java && ty.ptr && typeof v === 'number' && v === 0) return null;
      return v;
    }
    if (v === null && this.java) {
      // int x = map.get(k) with a missing key: unboxing null throws
      if (ty.orig && /^(int|long|double|float|char|boolean|short|byte)$/.test(ty.orig)) this.nullError(`unbox null into an ${ty.orig}`);
      return null;
    }
    switch (ty.name) {
      case 'int':
        return isNum(v) ? toInt(v) : v;
      case 'short':
        return isNum(v) ? (toInt(v) << 16) >> 16 : v;
      case 'byte':
        return isNum(v) ? (toInt(v) << 24) >> 24 : v;
      case 'uint':
        return isNum(v) ? (typeof v === 'bigint' ? Number(BigInt.asUintN(32, v)) : toInt(v) >>> 0) : v;
      case 'long':
        return isNum(v) ? BigInt.asIntN(64, toBig(v)) : v;
      case 'ulong':
        return isNum(v) ? BigInt.asUintN(64, toBig(v)) : v;
      case 'double':
        return isNum(v) ? new Dbl(toNumber(v)) : v;
      case 'char':
        return isNum(v) ? new Chr(toInt(v) & 0xffff) : v;
      case 'bool':
        return isNum(v) || v === null || v instanceof Ptr ? this.truthy(v) : v;
      case 'string':
        if (v instanceof Chr && !this.java) return charStr(v);
        if (v instanceof SB) return v.s;
        return v;
      case 'auto':
        return this.java ? v : copyVal(v);
      case 'function':
        return v;
    }
    if (this.java) return v;
    if (v instanceof Ptr) return v;
    return copyVal(v);
  }

  /** evaluate an expression for storage into a location of type ty (handles {…} initializer lists) */
  evTo(ty: TypeNode | null, e: Expr): V {
    if (e.k === 'init') return this.fromInit(ty, e);
    return this.coerce(ty, this.ev(e));
  }

  fromInit(ty: TypeNode | null, e: Extract<Expr, { k: 'init' }>): V {
    const items = e.items;
    if (!ty || ty.name === 'auto') return new Vec('vector', items.map((x) => (x.k === 'init' ? this.fromInit(null, x) : copyIfCpp(this.ev(x), this.java))), null);
    if (ty.arr) {
      const et: TypeNode = { ...ty, arr: ty.arr - 1, dims: ty.dims?.slice(1) };
      const v = new Vec('array', items.map((x) => this.evTo(et, x)), et);
      const n = ty.dims?.[0] ? toInt(this.ev(ty.dims[0])) : -1;
      while (n > v.a.length) v.a.push(this.defaultVal(et));
      return v;
    }
    if (ty.ptr) return items.length ? this.ev(items[0]) : null;
    switch (ty.name) {
      case 'int': case 'long': case 'uint': case 'ulong': case 'double': case 'char': case 'bool': case 'short': case 'byte':
        return items.length ? this.evTo(ty, items[0]) : this.defaultVal(ty);
      case 'string':
        if (items.length === 1 && items[0].k !== 'chr') return this.evTo(ty, items[0]);
        return items.map((x) => charStr(this.coerce(T('char'), this.ev(x)) as Chr)).join('');
      case 'pair': {
        const [a, b] = ty.args;
        return new Pair(items[0] ? this.evTo(a ?? null, items[0]) : this.defaultVal(a), items[1] ? this.evTo(b ?? null, items[1]) : this.defaultVal(b));
      }
      case 'tuple':
        return new Vec('tuple', items.map((x, i) => this.evTo(ty.args[i] ?? null, x)), null);
    }
    const c = this.classes.get(ty.name);
    if (c) {
      const ctor = this.pickFn(c.decl?.ctors ?? [], items.length);
      if (ctor || items.length === 0) return this.newObject(c, items, e.line, null);
      // aggregate initialization: fields in declaration order
      const o = this.newObject(c, [], e.line, null, true);
      const fields = this.instanceFields(c);
      items.forEach((x, i) => {
        const f = fields[i];
        if (!f) throw new RtError(`too many initializers for ${c.name}`, e.line);
        o.f.set(f.name, this.evTo(f.ty, x));
      });
      return o;
    }
    return makeCppConstruct(this, ty, items, e.line, true);
  }

  truthy(v: V): boolean {
    if (typeof v === 'boolean') return v;
    if (typeof v === 'number') return v !== 0;
    if (typeof v === 'bigint') return v !== 0n;
    if (v instanceof Chr) return v.c !== 0;
    if (v instanceof Dbl) return v.v !== 0;
    if (v === null || v === undefined) return false;
    if (v instanceof Stream) return !v.fail;
    return true;
  }

  // ---------- lvalues ----------
  lookup(name: string): Box | undefined {
    const f = this.top;
    const b = f.scope.lookup(name);
    if (b) return b;
    const self = f.self instanceof Ptr ? f.self.o : f.self;
    if (self instanceof Obj && self.f.has(name)) return new FieldBox(self, name, this.fieldType(self.cls, name), this);
    for (let c: ClassRT | null | undefined = f.cls; c; c = (c as ClassRT & { outer?: ClassRT | null }).outer) {
      for (let k: ClassRT | null = c; k; k = k.base) {
        const sb = k.statics.get(name);
        if (sb) return sb;
      }
    }
    return this.globals.vars.get(name);
  }

  fieldType(c: ClassRT, name: string): TypeNode | null {
    for (let k: ClassRT | null = c; k; k = k.base) {
      const f = k.decl?.fields.find((x) => x.name === name);
      if (f) return f.ty;
    }
    return null;
  }

  lv(e: Expr): Box {
    switch (e.k) {
      case 'id': {
        const b = this.lookup(e.name);
        if (b) return b;
        return new VarBox(this.evId(e.name, e.line), null); // constants such as cin, INT_MAX
      }
      case 'member': {
        let o = this.ev(e.a);
        if (o instanceof Ptr) o = o.o;
        if (o === null || o === undefined) this.nullError(`access field "${e.name}"`);
        if (o instanceof Obj) {
          if (!o.f.has(e.name) && !this.fieldType(o.cls, e.name)) {
            const sb = this.findStatic(o.cls, e.name);
            if (sb) return sb;
            throw new RtError(`${o.cls.name} has no member named '${e.name}'`, e.line);
          }
          return new FieldBox(o, e.name, this.fieldType(o.cls, e.name), this);
        }
        if (o instanceof Pair && (e.name === 'first' || e.name === 'second')) return new PropBox(o, e.name, this);
        if (o instanceof MIt) {
          const ks = o.src.keys();
          if (o.i < 0 || o.i >= ks.length) throw new RtError('dereferencing end() iterator (undefined behavior)', e.line);
          if (o.src instanceof MapV) {
            if (e.name === 'first') return new VarBox(o.src.m.get(ks[o.i])![0], null);
            if (e.name === 'second') return new MapBox(o.src, o.src.m.get(ks[o.i])![0], this);
          }
        }
        if (o instanceof It && (e.name === 'first' || e.name === 'second')) {
          const p = this.derefIt(o).get();
          if (p instanceof Pair) return new PropBox(p, e.name, this);
        }
        if (o instanceof TypeVal) {
          const c = this.classes.get(o.ty.name);
          const sb = c && this.findStatic(c, e.name);
          if (sb) return sb;
        }
        throw new RtError(`a ${describe(o)} has no member named '${e.name}'${o instanceof Vec || o instanceof MapV || typeof o === 'string' ? ' (did you mean to call a method, e.g. .size()?)' : ''}`, e.line);
      }
      case 'index': {
        const base = this.ev(e.a);
        if (typeof base === 'string') {
          if (this.java) throw new RtError('Java strings cannot be indexed with [] — use charAt(i)', e.line);
          const sb = isLvalueExpr(e.a) ? this.lv(e.a) : new VarBox(base, T('string'));
          return new StrCharBox(sb, toInt(this.ev(e.i)), this);
        }
        if (base instanceof Vec) return new ElemBox(base, this.index(this.ev(e.i)), this);
        if (base instanceof MapV) {
          if (this.java) throw new RtError('Java maps use get/put, not []', e.line);
          return new MapBox(base, this.evTo(base.kt, e.i), this);
        }
        if (base instanceof It) return this.derefIt(new It(base.src, base.i + toInt(this.ev(e.i)), base.rev));
        if (base instanceof Obj || base instanceof Ptr) {
          const o = base instanceof Ptr ? base.o : base;
          const m = this.findMethod(o.cls, 'operator[]', 1);
          if (m) return new VarBox(this.invoke(m, [this.ev(e.i)], Ptr.to(o), o.cls, e.line), null);
        }
        if (base === null) this.nullError('index into null');
        throw new RtError(`cannot index into a ${describe(base)}`, e.line);
      }
      case 'un':
        if (e.op === '*') {
          const p = this.ev(e.a);
          if (p instanceof It) return this.derefIt(p);
          if (p instanceof MIt) return this.derefMIt(p);
          if (p instanceof Ptr) return new ObjBox(p.o, this);
          if (p instanceof Vec) return new ElemBox(p, 0, this);
          if (p === null) this.nullError('dereference a null pointer');
          throw new RtError(`cannot dereference a ${describe(p)}`, e.line);
        }
        if (e.op === '++' || e.op === '--') {
          const b = this.lv(e.a);
          this.store(b, this.incr(b.get(), e.op === '++' ? 1 : -1));
          return b;
        }
        break;
      case 'call':
        if (e.fn.k === 'member') {
          const b = lvMethod(this, e);
          if (b) return b;
        }
        break;
      case 'assign':
        this.ev(e);
        return this.lv(e.a);
      case 'cond':
        return this.truthy(this.ev(e.c)) ? this.lv(e.a) : this.lv(e.b);
    }
    return new VarBox(this.ev(e), null);
  }

  findStatic(c: ClassRT, name: string): Box | undefined {
    for (let k: ClassRT | null = c; k; k = k.base) {
      const b = k.statics.get(name);
      if (b) return b;
    }
    return undefined;
  }

  index(v: V): number {
    if (typeof v === 'number') return v;
    if (typeof v === 'bigint' || v instanceof Chr || typeof v === 'boolean') return toInt(v);
    if (v instanceof Dbl) throw new RtError('array index must be an integer, not a double', this.line);
    throw new RtError(`array index must be an integer, not a ${describe(v)}`, this.line);
  }

  derefIt(p: It): Box {
    const src = p.src;
    const n = iterLen(src);
    const phys = p.rev ? n - 1 - p.i : p.i;
    if (src instanceof Vec) {
      if (phys < 0 || phys >= n) throw new RtError(`dereferencing an iterator outside the container (position ${p.i}, size ${n}) — undefined behavior`, this.line);
      return new ElemBox(src, phys, this);
    }
    return new StrCharBox(src, phys, this);
  }

  derefMIt(p: MIt): Box {
    const ks = p.src.keys();
    const phys = p.rev ? ks.length - 1 - p.i : p.i;
    if (phys < 0 || phys >= ks.length) throw new RtError('dereferencing end() of a map/set — undefined behavior', this.line);
    if (p.src instanceof MapV) return new VarBox(mapEntry(p.src, ks[phys], this), null);
    return new VarBox(p.src.m.get(ks[phys])![0], null);
  }

  incr(v: V, d: number): V {
    if (typeof v === 'number') return v >= -INT_MAX - 1 && v <= INT_MAX ? (v + d) | 0 : v + d;
    if (typeof v === 'bigint') return BigInt.asIntN(64, v + BigInt(d));
    if (v instanceof Chr) return new Chr((v.c + d) & 0xffff);
    if (v instanceof Dbl) return new Dbl(v.v + d);
    if (v instanceof It) return new It(v.src, v.i + d, v.rev);
    if (v instanceof MIt) return new MIt(v.src, v.i + d, v.rev);
    if (v instanceof Ptr) throw new RtError('pointer arithmetic on object pointers is not supported by the tracer', this.line);
    if (v === null) this.nullError('increment null');
    throw new RtError(`cannot increment a ${describe(v)}`, this.line);
  }

  // ---------- expressions ----------
  ev(e: Expr): V {
    switch (e.k) {
      case 'num':
        return e.float ? new Dbl(e.v as number) : e.v;
      case 'str':
        return e.v;
      case 'chr':
        return new Chr(e.v.charCodeAt(0));
      case 'bool':
        return e.v;
      case 'null':
        return null;
      case 'this':
        return this.top.self;
      case 'id':
        return this.evId(e.name, e.line);
      case 'scope':
        return this.evScope(e);
      case 'bin':
        return this.evBin(e);
      case 'un':
        return this.evUnary(e);
      case 'post': {
        const b = this.lv(e.a);
        const old = b.get();
        this.store(b, this.incr(old, e.op === '++' ? 1 : -1));
        return old;
      }
      case 'assign':
        return this.evAssign(e);
      case 'cond':
        return this.truthy(this.ev(e.c)) ? this.ev(e.a) : this.ev(e.b);
      case 'call':
        return this.evCall(e);
      case 'index':
        return this.lv(e).get();
      case 'member':
        return this.evMember(e);
      case 'cast':
        return this.cast(e.ty, this.ev(e.a));
      case 'construct':
        return this.construct(e.ty, e.args, e.line, e.brace);
      case 'new':
        return this.evNew(e);
      case 'init':
        return this.fromInit(null, e);
      case 'lambda': {
        const f = this.top;
        return new Closure('lambda', e.params, e.body, f.scope, f.self, f.cls, e.line, e.ret);
      }
      case 'mref':
        return this.methodRef(e.owner, e.name, e.line);
      case 'sizeof':
        return this.sizeOf(e);
      case 'instanceof': {
        const v = this.ev(e.a);
        if (v === null) return false;
        if (v instanceof Obj) {
          for (let c: ClassRT | null = v.cls; c; c = c.base) if (c.name === e.ty.name) return true;
          return false;
        }
        return javaTypeMatches(v, e.ty);
      }
      case 'comma': {
        let v: V = undefined;
        for (const x of e.items) v = this.ev(x);
        return v;
      }
      case 'lit':
        return e.v as V;
    }
  }

  evId(name: string, line: number): V {
    const b = this.lookup(name);
    if (b) return b.get();
    if (!this.java) {
      switch (name) {
        case 'INT_MAX': return INT_MAX;
        case 'INT_MIN': return -INT_MAX - 1;
        case 'UINT_MAX': return 4294967295;
        case 'LLONG_MAX': case 'LONG_MAX': case 'LONG_LONG_MAX': return 9223372036854775807n;
        case 'LLONG_MIN': case 'LONG_MIN': return -9223372036854775808n;
        case 'ULLONG_MAX': return 18446744073709551615n;
        case 'SHRT_MAX': return 32767;
        case 'CHAR_MAX': return 127;
        case 'DBL_MAX': return new Dbl(Number.MAX_VALUE);
        case 'DBL_MIN': return new Dbl(Number.MIN_VALUE);
        case 'INFINITY': return new Dbl(Infinity);
        case 'NAN': return new Dbl(NaN);
        case 'M_PI': return new Dbl(Math.PI);
        case 'M_E': return new Dbl(Math.E);
        case 'EOF': return -1;
        case 'cout': return this.cout;
        case 'cin': return this.cin;
        case 'cerr': case 'clog': return new Stream('cerr');
        case 'endl': return new Manip('endl', 0);
        case 'fixed': return new Manip('fixed', 0);
        case 'scientific': return new Manip('scientific', 0);
        case 'boolalpha': return new Manip('boolalpha', 1);
        case 'noboolalpha': return new Manip('boolalpha', 0);
        case 'flush': case 'left': case 'right': case 'showpoint': case 'ws': return new Manip(name, 0);
        case 'npos': return NPOS;
      }
    }
    const fns = this.functions.get(name);
    if (fns) return new FnRef(name, fns);
    const f = this.top;
    if (f.cls) {
      const ms = this.methodsNamed(f.cls, name);
      if (ms.length) return new FnRef(name, ms, f.self, f.cls);
    }
    if (this.classes.has(name) || isStaticClass(name, this.java)) return new TypeVal(T(name));
    throw new RtError(`'${name}' was not declared in this scope`, line);
  }

  evScope(e: Extract<Expr, { k: 'scope' }>): V {
    const p = e.path;
    const last = p[p.length - 1];
    if (p[0] === 'numeric_limits') {
      const t = e.targs?.[0]?.name ?? 'int';
      const max = last === 'max';
      if (last === 'infinity') return new Dbl(Infinity);
      if (t === 'int') return max ? INT_MAX : last === 'lowest' || last === 'min' ? -INT_MAX - 1 : 0;
      if (t === 'long') return max ? 9223372036854775807n : -9223372036854775808n;
      if (t === 'uint') return max ? 4294967295 : 0;
      if (t === 'ulong') return max ? 18446744073709551615n : 0n;
      if (t === 'double') return new Dbl(max ? Number.MAX_VALUE : last === 'lowest' ? -Number.MAX_VALUE : Number.MIN_VALUE);
      if (t === 'char') return new Chr(max ? 127 : 0);
      throw new RtError(`numeric_limits<${t}> is not supported`, e.line);
    }
    if (last === 'npos') return NPOS;
    const c = this.classes.get(p[p.length - 2]);
    if (c) {
      const sb = this.findStatic(c, last);
      if (sb) return sb.get();
      const ms = this.methodsNamed(c, last);
      if (ms.length) return new FnRef(last, ms, null, c);
    }
    return this.evId(last, e.line);
  }

  evAssign(e: Extract<Expr, { k: 'assign' }>): V {
    const b = this.lv(e.a);
    if (e.op === '=') {
      let v: V;
      if (e.b.k === 'init') v = this.fromInit(b.ty ?? this.inferType(b.get()), e.b);
      else {
        v = this.ev(e.b);
        if (!b.ty && !this.java) v = this.coerceLike(b.get(), v);
      }
      // a user-defined operator= is not supported; struct assignment copies fields
      this.store(b, v);
      return b.get();
    }
    const op = e.op.slice(0, -1);
    const cur = b.get();
    const rhs = this.ev(e.b);
    let r: V;
    if (typeof cur === 'string' && op === '+' && !this.java) {
      r = cur + (rhs instanceof Chr ? charStr(rhs) : typeof rhs === "string" ? rhs : typeof rhs === "number" ? String.fromCharCode(rhs & 0xff) : this.badConcat(rhs));
    } else r = this.binop(op, cur, rhs, e.line);
    this.store(b, b.ty ? r : this.coerceLike(cur, r));
    return b.get();
  }

  /** write through an lvalue, converting to a typed variable's declared type (int x = 2.9 → 2, char c += 1) */
  store(b: Box, v: V) {
    b.set(b instanceof VarBox && b.ty ? this.coerce(b.ty, v) : v);
  }

  badConcat(v: V): never {
    throw new RtError(`cannot append a ${describe(v)} to a std::string — use to_string(x) or char(x)`, this.line);
  }

  /** keep the numeric kind of an untyped location (vector element of unknown type, auto, …) */
  coerceLike(cur: V, v: V): V {
    if (typeof cur === 'number' && isNum(v)) return toInt(v);
    if (typeof cur === 'bigint' && isNum(v)) return BigInt.asIntN(64, toBig(v));
    if (cur instanceof Chr && isNum(v)) return new Chr(toInt(v) & 0xffff);
    if (cur instanceof Dbl && isNum(v)) return new Dbl(toNumber(v));
    if (typeof cur === 'string' && v instanceof Chr && !this.java) return charStr(v);
    return this.java ? v : copyVal(v);
  }

  evUnary(e: Extract<Expr, { k: 'un' }>): V {
    switch (e.op) {
      case '!':
        return !this.truthy(this.ev(e.a));
      case '-': {
        const v = this.ev(e.a);
        if (typeof v === 'number') return v === -INT_MAX - 1 ? v : -v | 0 || 0;
        if (typeof v === 'bigint') return BigInt.asIntN(64, -v);
        if (v instanceof Dbl) return new Dbl(-v.v);
        if (v instanceof Chr) return -v.c;
        if (typeof v === 'boolean') return v ? -1 : 0;
        throw new RtError(`cannot negate a ${describe(v)}`, e.line);
      }
      case '+': {
        const v = this.ev(e.a);
        if (v instanceof Chr || typeof v === 'boolean') return toNumber(v);
        return v;
      }
      case '~': {
        const v = this.ev(e.a);
        if (typeof v === 'bigint') return BigInt.asIntN(64, ~v);
        return ~toNumber(v);
      }
      case '++':
      case '--': {
        const b = this.lv(e.a);
        this.store(b, this.incr(b.get(), e.op === '++' ? 1 : -1));
        return b.get();
      }
      case '*':
        return this.lv(e).get();
      case '&': {
        if (isLvalueExpr(e.a)) {
          const b = this.lv(e.a);
          const v = b.get();
          if (v instanceof Obj) return Ptr.to(v);
          return new Addr(b);
        }
        const v = this.ev(e.a);
        if (v instanceof Obj) return Ptr.to(v);
        throw new RtError('taking the address of a temporary', e.line);
      }
    }
    throw new RtError(`unsupported operator ${e.op}`, e.line);
  }

  evBin(e: Extract<Expr, { k: 'bin' }>): V {
    if (e.op === '&&') return this.truthy(this.ev(e.a)) && this.truthy(this.ev(e.b));
    if (e.op === '||') return this.truthy(this.ev(e.a)) || this.truthy(this.ev(e.b));
    const a = this.ev(e.a);
    if (a instanceof Stream) {
      if (e.op === '>>' && (a.kind === 'cin')) {
        this.readInto(a, this.lv(e.b));
        return a;
      }
      if (e.op === '<<' && (a.kind === 'cout' || a.kind === 'cerr')) {
        this.writeCpp(a, this.ev(e.b));
        return a;
      }
    }
    const b = this.ev(e.b);
    return this.binop(e.op, a, b, e.line);
  }

  binop(op: string, a: V, b: V, line: number): V {
    // user operator overloads (C++)
    if (!this.java && (a instanceof Obj || b instanceof Obj)) {
      const r = this.userOp(op, a, b, line);
      if (r !== NO_OP) return r as V;
    }
    switch (op) {
      case '+':
        if (typeof a === 'string' || typeof b === 'string' || a instanceof SB || b instanceof SB) {
          if (this.java) return this.javaStr(a) + this.javaStr(b);
          if (typeof a === 'string' && typeof b === 'string') return a + b;
          if (typeof a === 'string' && b instanceof Chr) return a + charStr(b);
          if (a instanceof Chr && typeof b === 'string') return charStr(a) + b;
          throw new RtError(`cannot add a ${describe(a)} and a ${describe(b)} — for numbers use to_string(x)`, line);
        }
        if (a instanceof It && isNum(b)) return new It(a.src, a.i + toInt(b), a.rev);
        if (b instanceof It && isNum(a)) return new It(b.src, b.i + toInt(a), b.rev);
        if (a instanceof Vec && a.kind === 'array' && isNum(b)) return new It(a, toInt(b));
        if (a instanceof MIt && isNum(b)) return new MIt(a.src, a.i + toInt(b), a.rev);
        break;
      case '-':
        if (a instanceof It && b instanceof It) return a.i - b.i;
        if (a instanceof It && isNum(b)) return new It(a.src, a.i - toInt(b), a.rev);
        if (a instanceof It && b instanceof Vec) return a.i;
        if (a instanceof MIt && isNum(b)) return new MIt(a.src, a.i - toInt(b), a.rev);
        break;
      case '==':
      case '!=': {
        if (!this.java) [a, b] = unsignedConv(a, b);
        const r = this.java ? this.javaEq(a, b) : eqVal(a, b);
        return op === '==' ? r : !r;
      }
      case '<':
      case '>':
      case '<=':
      case '>=': {
        let c: number;
        if (!this.java) [a, b] = unsignedConv(a, b);
        try {
          c = cmpVal(a, b);
        } catch (err) {
          if (a === null || b === null) this.nullError('compare null');
          throw err;
        }
        return op === '<' ? c < 0 : op === '>' ? c > 0 : op === '<=' ? c <= 0 : c >= 0;
      }
    }
    if (!isNum(a) || !isNum(b)) {
      if (a === null || b === null) this.nullError(`use null in '${op}'`);
      throw new RtError(`operator ${op} cannot be applied to a ${describe(a)} and a ${describe(b)}`, line);
    }
    return this.arith(op, a, b, line);
  }

  javaEq(a: V, b: V): boolean {
    if (isNum(a) && isNum(b)) return cmpVal(a, b) === 0;
    if (typeof a === 'string' && typeof b === 'string') return a === b;
    if (a instanceof Pair && b instanceof Pair) return a === b;
    return a === b;
  }

  arith(op: string, a: number | bigint | Chr | Dbl | boolean, b: number | bigint | Chr | Dbl | boolean, line: number): V {
    if (a instanceof Dbl || b instanceof Dbl) {
      const x = toNumber(a);
      const y = toNumber(b);
      switch (op) {
        case '+': return new Dbl(x + y);
        case '-': return new Dbl(x - y);
        case '*': return new Dbl(x * y);
        case '/': return new Dbl(x / y);
        case '%': return new Dbl(x % y);
      }
      throw new RtError(`operator ${op} cannot be applied to a double`, line);
    }
    if (typeof a === 'boolean' && typeof b === 'boolean' && (op === '&' || op === '|' || op === '^')) {
      return op === '&' ? a && b : op === '|' ? a || b : a !== b;
    }
    if (typeof a === 'bigint' || typeof b === 'bigint') {
      const x = toBig(a);
      const y = toBig(b);
      const W = (r: bigint) => BigInt.asIntN(64, r);
      switch (op) {
        case '+': return W(x + y);
        case '-': return W(x - y);
        case '*': return W(x * y);
        case '/':
          if (y === 0n) this.fail('ArithmeticException', this.java ? '/ by zero' : 'integer division by zero (undefined behavior — the program would crash)');
          return W(x / y);
        case '%':
          if (y === 0n) this.fail('ArithmeticException', this.java ? '/ by zero' : 'integer modulo by zero (undefined behavior)');
          return W(x % y);
        case '&': return W(x & y);
        case '|': return W(x | y);
        case '^': return W(x ^ y);
        case '<<': return typeof a === 'bigint' ? W(x << (y & 63n)) : toInt(a) << Number(y & 31n);
        case '>>': return typeof a === 'bigint' ? W(x >> (y & 63n)) : toInt(a) >> Number(y & 31n);
        case '>>>': return typeof a === 'bigint' ? W(BigInt.asUintN(64, x) >> (y & 63n)) : (toInt(a) >>> Number(y & 31n)) | 0;
      }
      throw new RtError(`unsupported operator ${op}`, line);
    }
    const x = toNumber(a);
    const y = toNumber(b);
    const in32 = (n: number) => n >= -2147483648 && n <= 2147483647;
    const wrap = (r: number) => (in32(x) && in32(y) ? r | 0 : r);
    switch (op) {
      case '+': return wrap(x + y);
      case '-': return wrap(x - y);
      case '*':
        if (in32(x) && in32(y)) return Math.imul(x, y);
        return Number(BigInt.asUintN(32, BigInt(Math.trunc(x)) * BigInt(Math.trunc(y))));
      case '/':
        if (y === 0) this.fail('ArithmeticException', this.java ? '/ by zero' : 'integer division by zero (undefined behavior — the program would crash)');
        return wrap(Math.trunc(x / y)) || 0;
      case '%':
        if (y === 0) this.fail('ArithmeticException', this.java ? '/ by zero' : 'integer modulo by zero (undefined behavior)');
        return x % y || 0;
      case '&': return x & y;
      case '|': return x | y;
      case '^': return x ^ y;
      case '<<': return x << (y & 31);
      case '>>': return x >> (y & 31);
      case '>>>': return (x >>> (y & 31)) | 0;
    }
    throw new RtError(`unsupported operator ${op}`, line);
  }

  userOp(op: string, a: V, b: V, line: number): V | typeof NO_OP {
    const ao = a instanceof Obj ? a : null;
    const call = (o: Obj, name: string, arg: V): V | typeof NO_OP => {
      const m = this.findMethod(o.cls, name, 1);
      if (m) return this.invoke(m, [arg], Ptr.to(o), o.cls, line);
      const g = this.functions.get(name)?.find((f) => f.params.length === 2);
      if (g) return this.invoke(g, [o, arg], null, null, line);
      return NO_OP;
    };
    if (ao) {
      const r = call(ao, `operator${op}`, b);
      if (r !== NO_OP) return r;
      if (op === '>' || op === '<=' || op === '>=') {
        if (b instanceof Obj) {
          const lt = (x: Obj, y: Obj) => call(x, 'operator<', y);
          if (op === '>') {
            const r2 = lt(b, ao);
            if (r2 !== NO_OP) return this.truthy(r2 as V);
          }
          if (op === '<=') {
            const r2 = lt(b, ao);
            if (r2 !== NO_OP) return !this.truthy(r2 as V);
          }
          if (op === '>=') {
            const r2 = lt(ao, b);
            if (r2 !== NO_OP) return !this.truthy(r2 as V);
          }
        }
      }
      if (op === '!=') {
        const r2 = call(ao, 'operator==', b);
        if (r2 !== NO_OP) return !this.truthy(r2 as V);
      }
    }
    return NO_OP;
  }

  userCompare(a: Obj, b: Obj): number {
    if (this.java) {
      const m = this.findMethod(a.cls, 'compareTo', 1);
      if (!m) this.throwExc('ClassCastException', `class ${a.cls.name} cannot be cast to class java.lang.Comparable`);
      return Math.sign(toNumber(this.invoke(m, [b], a, a.cls, this.line)));
    }
    const lt = (x: Obj, y: Obj) => {
      const m = this.findMethod(x.cls, 'operator<', 1);
      if (m) return this.truthy(this.invoke(m, [y], Ptr.to(x), x.cls, this.line));
      const g = this.functions.get('operator<')?.find((f) => f.params.length === 2);
      if (g) return this.truthy(this.invoke(g, [x, y], null, null, this.line));
      throw new RtError(`no operator< for ${x.cls.name} — define bool operator<(const ${x.cls.name}&) const or pass a comparator`, this.line);
    };
    return lt(a, b) ? -1 : lt(b, a) ? 1 : 0;
  }

  cast(ty: TypeNode, v: V): V {
    if (ty.ptr || ty.arr) return v;
    switch (ty.name) {
      case 'int': case 'short': case 'byte': case 'uint': case 'long': case 'ulong': case 'double': case 'char': case 'bool':
        if (v instanceof Chr && ty.name === 'char') return v;
        if (!isNum(v)) {
          if (v === null && this.java) this.nullError('unbox null');
          throw new RtError(`cannot cast a ${describe(v)} to ${ty.name}`, this.line);
        }
        return this.coerce({ ...ty, orig: undefined }, v);
      case 'string':
        if (this.java && v !== null && typeof v !== 'string') this.throwExc('ClassCastException', `cannot cast to String`);
        return this.coerce(ty, v);
    }
    return v;
  }

  sizeOf(e: Extract<Expr, { k: 'sizeof' }>): number {
    const tsize = (t: TypeNode): number => {
      if (t.ptr) return 8;
      switch (t.name) {
        case 'char': case 'bool': return 1;
        case 'short': return 2;
        case 'int': case 'uint': return 4;
        case 'long': case 'ulong': case 'double': return 8;
        case 'string': return 32;
        case 'vector': return 24;
      }
      return 8;
    };
    const vsize = (v: V): number => {
      if (v instanceof Vec && v.kind === 'array') return v.a.length ? v.a.length * vsize(v.a[0]) : 0;
      if (typeof v === 'number') return 4;
      if (typeof v === 'bigint' || v instanceof Dbl) return 8;
      if (v instanceof Chr || typeof v === 'boolean') return 1;
      if (v instanceof Vec) return 24;
      return 8;
    };
    if (e.ty) {
      if (e.ty.dims?.length || !this.classes.has(e.ty.name)) return tsize(e.ty);
      return 8 * (this.classes.get(e.ty.name)!.decl?.fields.length ?? 1);
    }
    return vsize(this.ev(e.a!));
  }

  // ---------- member access ----------
  evMember(e: Extract<Expr, { k: 'member' }>): V {
    let o = this.ev(e.a);
    if (o instanceof TypeVal) {
      const c = this.classes.get(o.ty.name);
      if (c) {
        const sb = this.findStatic(c, e.name);
        if (sb) return sb.get();
        if (c.decl?.inner.some((i) => i.name === e.name)) return new TypeVal(T(e.name));
        const ms = this.methodsNamed(c, e.name);
        if (ms.length) return new FnRef(e.name, ms, null, c);
        throw new RtError(`${c.name} has no static member '${e.name}'`, e.line);
      }
      return staticField(this, o.ty.name, e.name, e.line);
    }
    if (o instanceof Ptr) o = o.o;
    if (o instanceof Vec && e.name === 'length' && this.java) return o.a.length;
    if (o instanceof Obj && o.cls.decl?.isEnum && !o.f.has(e.name)) {
      const sb = this.findStatic(o.cls, e.name);
      if (sb) return sb.get();
    }
    if (o instanceof Obj && o.f.has(e.name)) return o.f.get(e.name);
    return this.lv(e).get();
  }

  // ---------- calls ----------
  methodsNamed(c: ClassRT, name: string): FnDecl[] {
    const out: FnDecl[] = [];
    for (let k: ClassRT | null = c; k; k = k.base) for (const m of k.decl?.methods ?? []) if (m.name === name && m.body) out.push(m);
    return out;
  }

  findMethod(c: ClassRT, name: string, n: number, args?: V[]): FnDecl | undefined {
    for (let k: ClassRT | null = c; k; k = k.base) {
      const m = this.pickFn((k.decl?.methods ?? []).filter((x) => x.name === name && x.body), n, args);
      if (m) return m;
    }
    return undefined;
  }

  /** overload resolution: by argument count, then by how well runtime argument kinds match the parameter types */
  pickFn(cands: FnDecl[], n: number, args?: V[]): FnDecl | undefined {
    const ok = cands.filter((f) => {
      const req = f.params.filter((p) => !p.def).length;
      const varargs = this.java && f.params.length && f.params[f.params.length - 1].ty?.arr;
      return (n >= req && n <= f.params.length) || (varargs && n >= f.params.length - 1);
    });
    if (ok.length <= 1 || !args) return ok[0];
    let best = ok[0];
    let bestScore = -1;
    for (const f of ok) {
      let s = 0;
      f.params.forEach((p, i) => {
        if (i < args.length && p.ty) s += typeScore(p.ty, args[i]);
      });
      if (f.params.length === n) s += 1;
      if (s > bestScore) {
        bestScore = s;
        best = f;
      }
    }
    return best;
  }

  instanceFields(c: ClassRT) {
    const chain: ClassRT[] = [];
    for (let k: ClassRT | null = c; k; k = k.base) chain.unshift(k);
    return chain.flatMap((k) => (k.decl?.fields ?? []).filter((f) => !f.isStatic));
  }

  evCall(e: Extract<Expr, { k: 'call' }>): V {
    const fn = e.fn;
    this.line = e.line;
    if (fn.k === 'member') {
      // static-looking receivers: Math.max, Arrays.sort, Integer.parseInt, System.out.println, Solution.helper
      if (fn.a.k === 'id' && !this.lookup(fn.a.name)) {
        const c = this.classes.get(fn.a.name);
        if (c?.decl?.isEnum && (fn.name === 'values' || fn.name === 'valueOf')) {
          const consts = (c.decl.enumConsts ?? []).map((k) => c.statics.get(k.name)!.get());
          if (fn.name === 'values') return new Vec('array', consts, T(c.name));
          const want = this.ev(e.args[0]);
          const hit = consts.find((o) => (o as Obj).f.get('name') === want);
          if (!hit) this.throwExc('IllegalArgumentException', `No enum constant ${c.name}.${want}`);
          return hit;
        }
        if (c) {
          const args = e.args.map((a) => this.ev(a));
          const m = this.findMethod(c, fn.name, args.length, args);
          if (m) return this.invoke(m, args, null, c, e.line);
        }
        if (!c && isStaticClass(fn.a.name, this.java)) return callStatic(this, fn.a.name, fn.name, e.args, e.line);
      }
      if (fn.a.k === 'member' && fn.a.a.k === 'id' && fn.a.a.name === 'System' && !this.lookup('System')) {
        return callMethod(this, null, staticField(this, 'System', fn.a.name, e.line), fn.name, e.args, e.line);
      }
      let recvBox: Box | null = null;
      let recv: V;
      if (isLvalueExpr(fn.a)) {
        recvBox = this.lv(fn.a);
        recv = recvBox.get();
      } else recv = this.ev(fn.a);
      if (recv instanceof Ptr) {
        recvBox = null;
        recv = recv.o;
      }
      if (recv instanceof Obj) {
        const args = e.args.map((a) => a);
        const m = this.findMethod(recv.cls, fn.name, args.length);
        if (m) return this.invokeExprs(m, e.args, this.java ? recv : Ptr.to(recv), recv.cls, e.line);
        if (recv.cls.decl?.isEnum) {
          if (fn.name === 'name' || fn.name === 'toString') return recv.f.get('name');
          if (fn.name === 'ordinal') return recv.f.get('ordinal');
          if (fn.name === 'compareTo') return toInt(recv.f.get('ordinal')) - toInt((this.ev(e.args[0]) as Obj).f.get('ordinal'));
        }
        if (this.java) {
          if (fn.name === 'toString') return this.javaStr(recv);
          if (fn.name === 'equals') return this.ev(e.args[0]) === recv;
          if (fn.name === 'hashCode') return recv.id;
          if (fn.name === 'getMessage' && recv.f.has('message')) return recv.f.get('message');
          // functional interface objects (anonymous Comparator etc.)
          const only = this.methodsNamed(recv.cls, fn.name);
          if (only.length) return this.invokeExprs(only[0], e.args, recv, recv.cls, e.line);
        }
        throw new RtError(`${recv.cls.name} has no method '${fn.name}' taking ${e.args.length} argument(s)`, e.line);
      }
      if (recv instanceof TypeVal) return callStatic(this, recv.ty.name, fn.name, e.args, e.line);
      return callMethod(this, recvBox, recv, fn.name, e.args, e.line);
    }
    if (fn.k === 'id') {
      const name = fn.name;
      // this(...) / super(...) inside constructors
      if ((name === 'super' || name === 'this') && this.java) return this.ctorDelegate(name, e.args, e.line);
      const b = this.top.scope.lookup(name) ?? this.lookupNonLocalVar(name);
      if (b) return this.callValueExprs(b.get(), e.args, e.line);
      const f = this.top;
      if (f.cls) {
        for (let c: ClassRT | null | undefined = f.cls; c; c = (c as ClassRT & { outer?: ClassRT | null }).outer) {
          const ms = this.methodsNamed(c, name);
          if (ms.length) {
            const args = e.args.map((a) => a);
            const m = this.pickFn(ms, args.length);
            if (m) {
              const self = c === f.cls || this.isSubclass(f.cls, c) ? f.self : null;
              return this.invokeExprs(m, e.args, m.isStatic ? null : self, c, e.line);
            }
          }
        }
      }
      const fns = this.functions.get(name);
      if (fns) {
        const cand = fns.filter((x) => x.body);
        let m = this.pickFn(cand, e.args.length);
        if (m && cand.filter((x) => x.params.length === e.args.length).length > 1) {
          const vals = e.args.map((a) => this.ev(a));
          m = this.pickFn(cand, vals.length, vals)!;
          return this.invoke(m, vals, null, null, e.line);
        }
        if (m) return this.invokeExprs(m, e.args, null, null, e.line);
        throw new RtError(`no overload of ${name}() takes ${e.args.length} argument(s)`, e.line);
      }
      const c = this.classes.get(name);
      if (c) return this.newObject(c, e.args, e.line, null);
      return callBuiltinFn(this, name, e.args, e.line, fn);
    }
    if (fn.k === 'scope') {
      const p = fn.path;
      if (p.length === 1) {
        // explicit template arguments: max<long long>(a, b), maxOf<string>(x, y)
        const ty = fn.targs?.[0];
        if (ty && (p[0] === 'max' || p[0] === 'min')) {
          const [a, b] = e.args.map((x) => this.evTo(ty, x));
          const less = cmpVal(a, b) < 0;
          return p[0] === 'max' ? (less ? b : a) : less ? a : b;
        }
        return this.evCall({ ...e, fn: { k: 'id', line: fn.line, name: p[0] } });
      }
      if (p[0] === 'get' && p.length === 2) {
        const v = this.ev(e.args[0]);
        const i = Number(p[1]);
        if (v instanceof Pair) return i === 0 ? v.first : v.second;
        if (v instanceof Vec) return v.a[i];
      }
      const c = p.length > 1 ? this.classes.get(p[p.length - 2]) : undefined;
      if (c) {
        const vals = e.args.map((a) => this.ev(a));
        const m = this.findMethod(c, p[p.length - 1], vals.length, vals);
        if (m) return this.invoke(m, vals, null, c, e.line);
      }
      return callBuiltinFn(this, p[p.length - 1], e.args, e.line, fn);
    }
    return this.callValueExprs(this.ev(fn), e.args, e.line);
  }

  lookupNonLocalVar(name: string): Box | undefined {
    const b = this.lookup(name);
    if (!b) return undefined;
    const v = b.get();
    if (v instanceof Closure || v instanceof FnRef || v instanceof Native || ((v instanceof Obj || v instanceof Ptr) && !this.java)) return b;
    return undefined;
  }

  isSubclass(a: ClassRT, b: ClassRT) {
    for (let k: ClassRT | null = a; k; k = k.base) if (k === b) return true;
    return false;
  }

  ctorDelegate(name: string, args: Expr[], line: number): V {
    const f = this.top;
    const self = f.self as Obj;
    const cls = name === 'super' ? f.cls?.base : f.cls;
    if (!cls) {
      // super(message) of a built-in exception base
      if (name === 'super' && args.length) self.f.set('message', this.ev(args[0]));
      return undefined;
    }
    const ctor = this.pickFn(cls.decl?.ctors ?? [], args.length);
    if (ctor) this.invokeExprs(ctor, args, self, cls, line, true);
    return undefined;
  }

  /** call a function value with argument expressions (keeps C++ reference parameters working for lambdas) */
  callValueExprs(fv: V, args: Expr[], line: number): V {
    if (fv instanceof Closure) return this.callClosure(fv, args.map((a) => ({ expr: a })), line);
    if (fv instanceof FnRef) {
      const m = this.pickFn(fv.decls, args.length);
      if (!m) throw new RtError(`no overload of ${fv.name}() takes ${args.length} argument(s)`, line);
      return this.invokeExprs(m, args, fv.self, fv.cls, line);
    }
    return this.callValue(fv, args.map((a) => this.ev(a)), line);
  }

  callValue(fv: V, args: V[], line: number): V {
    if (fv instanceof Closure) return this.callClosure(fv, args.map((v) => ({ value: v })), line);
    if (fv instanceof FnRef) {
      const m = this.pickFn(fv.decls, args.length, args);
      if (!m) throw new RtError(`no overload of ${fv.name}() takes ${args.length} argument(s)`, line);
      return this.invoke(m, args, fv.self, fv.cls, line);
    }
    if (fv instanceof Native) return fv.call(args);
    if (fv instanceof Ptr) fv = fv.o;
    if (fv instanceof Obj) {
      const m = this.findMethod(fv.cls, 'operator()', args.length);
      if (m) return this.invoke(m, args, Ptr.to(fv), fv.cls, line);
      // Java functional-interface object: call its single abstract-method implementation
      const ms = (fv.cls.decl?.methods ?? []).filter((x) => x.body && x.params.length === args.length);
      if (ms.length) return this.invoke(ms[0], args, fv, fv.cls, line);
    }
    if (fv === null) this.nullError('call a null function');
    throw new RtError(`a ${describe(fv)} is not callable`, line);
  }

  callClosure(c: Closure, args: ({ expr: Expr } | { value: V })[], line: number): V {
    const scope = new Scope(c.scope);
    const boxes = this.bindParams(c.params, args, line);
    c.params.forEach((p, i) => scope.vars.set(p.name, boxes[i]));
    return this.enterFrame({ name: c.name, line: c.line, scope, root: scope, self: c.self, cls: c.cls, fn: null, ret: c.ret ?? null }, () => {
      this.record('call', c.line);
      if (Array.isArray(c.body)) {
        const comp = this.execBody(c.body);
        const v = comp && comp.k === 'return' ? comp.v : undefined;
        this.record('return', comp && comp.k === 'return' ? this.line : c.line, { ret: enc(v, this.java) });
        return v;
      }
      const v = this.ev(c.body);
      this.record('return', c.line, { ret: enc(v, this.java) });
      return v;
    });
  }

  bindParams(params: Param[], args: ({ expr: Expr } | { value: V })[], line: number): Box[] {
    const out: Box[] = [];
    params.forEach((p, i) => {
      const a = args[i];
      const ty = p.ty;
      // Java varargs: pack the rest into an array (unless an array is passed directly)
      if (this.java && ty?.arr && i === params.length - 1 && args.length >= params.length) {
        const rest = args.slice(i).map((x) => ('expr' in x ? this.ev(x.expr) : x.value));
        const direct = rest.length === 1 && (rest[0] instanceof Vec || rest[0] === null);
        out.push(new VarBox(direct ? rest[0] : new Vec('array', rest, { ...ty, arr: ty.arr - 1 }), ty));
        return;
      }
      if (!a) {
        if (p.def) out.push(new VarBox(this.evTo(ty, p.def), ty));
        else if (this.java && ty?.arr && i === params.length - 1) out.push(new VarBox(new Vec('array', [], { ...ty, arr: ty.arr - 1 }), ty));
        else throw new RtError(`missing argument '${p.name}'`, line);
        return;
      }
      if (ty?.ref && !this.java) {
        if ('expr' in a && a.expr.k === 'lit' && a.expr.v instanceof BoxRef) out.push(a.expr.v.box);
        else if ('expr' in a && isLvalueExpr(a.expr)) out.push(this.lv(a.expr));
        else {
          const vty = { ...ty, ref: false };
          out.push(new VarBox('expr' in a ? this.evTo(vty.name === 'auto' ? null : vty, a.expr) : this.coerce(vty.name === 'auto' ? null : vty, a.value), vty.name === 'auto' ? null : vty));
        }
        return;
      }
      const useTy = ty && ty.name !== 'auto' ? ty : null;
      const v = 'expr' in a ? (a.expr.k === 'init' ? this.fromInit(useTy, a.expr) : this.coerce(useTy, this.ev(a.expr))) : this.coerce(useTy, a.value);
      out.push(new VarBox(v, useTy ?? this.inferType(v)));
    });
    return out;
  }

  invokeExprs(fn: FnDecl, args: Expr[], self: V, cls: ClassRT | null, line: number, sameObjectCtor = false): V {
    return this.invokeArgs(fn, args.map((a) => ({ expr: a })), self, cls, line, sameObjectCtor);
  }

  invoke(fn: FnDecl, args: V[], self: V, cls: ClassRT | null, line: number, isMain = false): V {
    void isMain;
    return this.invokeArgs(fn, args.map((v) => ({ value: v })), self, cls, line);
  }

  invokeArgs(fn: FnDecl, args: ({ expr: Expr } | { value: V })[], self: V, cls: ClassRT | null, line: number, ctorBody = false): V {
    if (!fn.body) throw new RtError(`${fn.name}() is declared but never defined`, line);
    const boxes = this.bindParams(fn.params, args, line);
    const scope = new Scope(null);
    fn.params.forEach((p, i) => p.name && scope.vars.set(p.name, boxes[i]));
    const name = fn.owner && fn.owner.ctors.includes(fn) ? fn.owner.name : fn.name;
    return this.enterFrame({ name, line: fn.line, scope, root: scope, self, cls: cls ?? (fn.owner ? this.classes.get(fn.owner.name) ?? null : null), fn, ret: fn.ret }, () => {
      this.record('call', fn.line);
      if (fn.inits || (ctorBody && fn.owner)) this.runInits(fn, self);
      const comp = this.execBody(fn.body!);
      let v: V = comp && comp.k === 'return' ? comp.v : undefined;
      if (v === undefined && fn.name === 'main' && !this.java) v = 0;
      this.record('return', comp && comp.k === 'return' ? this.line : fn.end, { ret: enc(v, this.java) });
      return v;
    });
  }

  runInits(fn: FnDecl, self: V) {
    if (!fn.inits) return;
    const o = self instanceof Ptr ? self.o : (self as Obj);
    for (const ini of fn.inits) {
      const baseCls = this.classes.get(ini.name);
      if (baseCls && o.cls.base === baseCls) {
        const ctor = this.pickFn(baseCls.decl?.ctors ?? [], ini.args.length);
        if (ctor) this.invokeExprs(ctor, ini.args, self, baseCls, fn.line, true);
        continue;
      }
      const fty = this.fieldType(o.cls, ini.name);
      if (!fty && !o.f.has(ini.name)) throw new RtError(`${o.cls.name} has no member '${ini.name}' to initialize`, fn.line);
      let v: V;
      if (ini.args.length === 1) v = this.evTo(fty, ini.args[0]);
      else if (ini.args.length === 0) v = this.defaultVal(fty);
      else v = this.construct(fty ?? T('auto'), ini.args, fn.line);
      o.f.set(ini.name, v);
    }
  }

  enterFrame<R>(frame: Frame, body: () => R): R {
    const max = this.opts.maxDepth ?? 400;
    if (this.frames.length >= max) {
      if (this.java) throw new Throw(new ExcV('StackOverflowError', `recursion deeper than ${max} calls (the tracer's limit)`), this.line);
      throw new RtError(`stack overflow: recursion deeper than ${max} calls (the tracer's limit) — is there a missing base case?`, this.line);
    }
    this.frames.push(frame);
    const savedLine = this.line;
    try {
      return body();
    } catch (e) {
      this.reportException(e);
      throw e;
    } finally {
      this.frames.pop();
      this.line = savedLine;
    }
  }

  /** record one 'exception' step where an error first surfaces, while its frames are still on the stack */
  reportException(e: unknown) {
    if (e instanceof StopTrace || e instanceof ExitSignal || this.stopped || this.silent) return;
    if (e instanceof Throw || e instanceof RtError) {
      if (e.reported) return;
      e.reported = true;
    } else if (e && typeof e === 'object') {
      if ((e as { __reported?: boolean }).__reported) return;
      (e as { __reported?: boolean }).__reported = true;
    }
    let msg: string;
    if (e instanceof Throw) {
      const v = e.v;
      msg = v instanceof ExcV ? `${this.java ? javaExcName(v.type) : `std::${v.type}`}${v.msg ? `: ${v.msg}` : ''}` : v instanceof Obj ? `${v.cls.name}${v.f.get('message') ? `: ${v.f.get('message')}` : ''}` : `throw ${this.java ? this.javaStr(v) : this.cppStr(v, this.cout)}`;
    } else msg = this.errorMessage(e);
    this.errorLine = this.line;
    if (this.steps.length < this.opts.maxSteps) this.steps.push({ line: this.line, event: 'exception', frames: this.snapshot(), stdout: this.stdout, error: msg });
  }

  // ---------- objects ----------
  newObject(c: ClassRT, args: Expr[] | V[], line: number, anon: null, skipCtor = false): Obj {
    void anon;
    if (c.decl?.isInterface) throw new RtError(`${c.name} is an interface and cannot be instantiated`, line);
    const o = new Obj(c);
    // fields from the base class down
    const chain: ClassRT[] = [];
    for (let k: ClassRT | null = c; k; k = k.base) chain.unshift(k);
    const frame: Frame = { name: c.name, line, scope: new Scope(null), root: new Scope(null), self: this.java ? o : Ptr.to(o), cls: c, fn: null, ret: null };
    frame.root = frame.scope;
    this.frames.push(frame);
    try {
      for (const k of chain) {
        for (const f of k.decl?.fields ?? []) {
          if (f.isStatic) continue;
          let v: V;
          if (!this.java && f.ty.dims?.length) v = this.makeCArray(f.ty, f.init, false);
          else if (f.init) v = this.evTo(f.ty, f.init);
          else if (f.ctorArgs) v = this.construct(f.ty, f.ctorArgs, f.line);
          else v = this.defaultVal(f.ty);
          o.f.set(f.name, v);
        }
        if (this.java) for (const s of k.decl?.staticInit ?? []) void s; // instance initializer blocks are rare; ignored
      }
      if (c.isException || (!c.base && c.decl?.base && /Exception|Error/.test(c.decl.base))) if (!o.f.has('message')) o.f.set('message', null);
    } finally {
      this.frames.pop();
    }
    if (skipCtor) return o;
    const isExprs = args.length > 0 && isExprArray(args);
    const ctors = c.decl?.ctors ?? [];
    const self = this.java ? o : Ptr.to(o);
    if (ctors.length) {
      const vals = isExprs ? null : (args as V[]);
      const ctor = this.pickFn(ctors, args.length, vals ?? undefined);
      if (!ctor) throw new RtError(`no constructor of ${c.name} takes ${args.length} argument(s)`, line);
      if (isExprs) this.invokeExprs(ctor, args as Expr[], self, c, line, true);
      else this.invokeArgs(ctor, (args as V[]).map((v) => ({ value: v })), self, c, line, true);
    } else {
      if (c.base && c.base.decl?.ctors.length) {
        const bc = this.pickFn(c.base.decl.ctors, 0);
        if (bc) this.invoke(bc, [], self, c.base, line);
      }
      if (args.length) {
        if (this.java) throw new RtError(`${c.name} has no constructor taking ${args.length} argument(s)`, line);
        const fields = this.instanceFields(c);
        args.forEach((a, i) => {
          const f = fields[i];
          if (!f) throw new RtError(`too many initializers for ${c.name}`, line);
          o.f.set(f.name, isExprs ? this.evTo(f.ty, a as Expr) : this.coerce(f.ty, a as V));
        });
      }
    }
    return o;
  }

  construct(ty: TypeNode, args: Expr[], line: number, brace = false): V {
    const c = this.classes.get(ty.name);
    if (c && !ty.ptr) {
      if (brace) return this.fromInit(ty, { k: 'init', line, items: args });
      return this.newObject(c, args, line, null);
    }
    return makeCppConstruct(this, ty, args, line, brace);
  }

  evNew(e: Extract<Expr, { k: 'new' }>): V {
    const ty = e.ty;
    if (e.dims !== undefined || ty.arr) {
      const et: TypeNode = { ...ty, arr: 0 };
      if (e.init) return this.fromInit({ ...ty }, e.init as Extract<Expr, { k: 'init' }>);
      const dims = (e.dims ?? []).map((d) => toInt(this.ev(d)));
      const total = ty.arr;
      const build = (level: number): Vec => {
        const n = dims[level];
        if (n < 0) this.fail('NegativeArraySizeException', `${n}`);
        if (n > 5_000_000) throw new RtError(`array of ${n} elements is too large for the tracer`, e.line);
        const a: V[] = new Array(n);
        const rest = total - level - 1;
        for (let i = 0; i < n; i++) a[i] = level + 1 < dims.length ? build(level + 1) : rest > 0 ? null : this.java ? this.defaultVal(et) : this.defaultVal(et);
        return new Vec('array', a, rest > 0 ? { ...et, arr: rest } : et);
      };
      return build(0);
    }
    if (this.java) {
      if (e.body) {
        const base = this.classes.get(ty.name) ?? null;
        const rt: ClassRT = { name: base ? `${ty.name}` : ty.name, base, decl: e.body, statics: new Map() };
        (rt as ClassRT & { outer?: ClassRT | null }).outer = this.top.cls;
        const o = this.newObject(rt, [], e.line, null, true);
        // anonymous classes see the enclosing scope's effectively-final locals
        const cap = this.top.scope;
        for (const [k, b] of this.collectScope(cap)) if (!o.f.has(k)) o.f.set(`${k}`, b.get());
        for (const k of [...o.f.keys()]) if (!e.body.fields.some((f) => f.name === k)) o.f.delete(k);
        return o;
      }
      const c = this.classes.get(ty.name);
      if (c) return this.newObject(c, e.args, e.line, null);
      return makeJavaNew(this, ty, e.args, e.line);
    }
    const c = this.classes.get(ty.name);
    if (c) {
      if (e.init) return Ptr.to(this.fromInit(ty, e.init as Extract<Expr, { k: 'init' }>) as Obj);
      return Ptr.to(this.newObject(c, e.args, e.line, null));
    }
    return makeCppConstruct(this, ty, e.args, e.line, false);
  }

  collectScope(s: Scope): Map<string, Box> {
    const m = new Map<string, Box>();
    const chain: Scope[] = [];
    for (let x: Scope | null = s; x; x = x.parent) chain.unshift(x);
    for (const x of chain) for (const [k, b] of x.vars) m.set(k, b);
    return m;
  }

  methodRef(owner: string, name: string, line: number): V {
    const f = this.top;
    if (owner === 'this') {
      const ms = f.cls ? this.methodsNamed(f.cls, name) : [];
      return new FnRef(name, ms, f.self, f.cls);
    }
    const c = this.classes.get(owner);
    if (c) {
      if (name === 'new') return new Native(`${owner}::new`, (args) => this.newObject(c, args, line, null));
      const ms = this.methodsNamed(c, name);
      const statics = ms.filter((m) => m.isStatic);
      if (statics.length) return new FnRef(name, statics, null, c);
      // unbound instance method: first argument is the receiver
      return new Native(`${owner}::${name}`, (args) => {
        const recv = args[0] as Obj;
        const m = this.findMethod(recv.cls, name, args.length - 1)!;
        return this.invoke(m, args.slice(1), recv, recv.cls, line);
      });
    }
    const b = this.lookup(owner);
    if (b) {
      const recv = b.get();
      return new Native(`${owner}::${name}`, (args) => callMethod(this, null, recv, name, args.map((v) => litExpr(v, line)), line));
    }
    return new Native(`${owner}::${name}`, (args) => {
      if (isStaticClass(owner, true)) {
        try {
          return callStatic(this, owner, name, args.map((v) => litExpr(v, line)), line);
        } catch (err) {
          if (!(err instanceof RtError) || !args.length) throw err;
        }
      }
      return callMethod(this, null, args[0], name, args.slice(1).map((v) => litExpr(v, line)), line);
    });
  }

  // ---------- I/O ----------
  out(s: string) {
    this.stdout += s;
    if (this.stdout.length > 200_000) throw new RtError('output limit (200 KB) exceeded', this.line);
  }

  skipWs() {
    const s = this.opts.stdin;
    while (this.inPos < s.length && /\s/.test(s[this.inPos])) this.inPos++;
  }
  readToken(): string | null {
    this.skipWs();
    const s = this.opts.stdin;
    if (this.inPos >= s.length) return null;
    const start = this.inPos;
    while (this.inPos < s.length && !/\s/.test(s[this.inPos])) this.inPos++;
    return s.slice(start, this.inPos);
  }
  readLine(): string | null {
    const s = this.opts.stdin;
    if (this.inPos >= s.length) return null;
    let end = s.indexOf('\n', this.inPos);
    if (end < 0) end = s.length;
    const line = s.slice(this.inPos, end).replace(/\r$/, '');
    this.inPos = end + 1;
    return line;
  }
  peekToken(): string | null {
    const save = this.inPos;
    const t = this.readToken();
    this.inPos = save;
    return t;
  }

  readInto(st: Stream, b: Box) {
    if (st.fail) return;
    const cur = b.get();
    const ty = b.ty ?? this.inferType(cur);
    const name = ty?.name ?? 'string';
    if (name === 'char') {
      this.skipWs();
      if (this.inPos >= this.opts.stdin.length) {
        st.fail = true;
        return;
      }
      b.set(new Chr(this.opts.stdin.charCodeAt(this.inPos++)));
      return;
    }
    const save = this.inPos;
    const t = this.readToken();
    if (t === null) {
      st.fail = true;
      return;
    }
    if (name === 'int' || name === 'long' || name === 'uint' || name === 'ulong' || name === 'short') {
      const m = /^[+-]?\d+/.exec(t);
      if (!m) {
        st.fail = true;
        this.inPos = save;
        b.set(this.coerce(ty, 0));
        return;
      }
      this.inPos = save;
      this.skipWs();
      this.inPos += m[0].length;
      b.set(this.coerce(ty, name === 'long' || name === 'ulong' ? BigInt(m[0]) : Number(m[0])));
      return;
    }
    if (name === 'double') {
      const m = /^[+-]?(\d+\.?\d*|\.\d+)([eE][+-]?\d+)?/.exec(t);
      if (!m) {
        st.fail = true;
        this.inPos = save;
        return;
      }
      this.inPos = save;
      this.skipWs();
      this.inPos += m[0].length;
      b.set(new Dbl(parseFloat(m[0])));
      return;
    }
    if (name === 'bool') {
      b.set(t === '1' || t === 'true');
      return;
    }
    b.set(t);
  }

  writeCpp(st: Stream, v: V) {
    if (v instanceof Manip) {
      switch (v.kind) {
        case 'endl': this.out('\n'); break;
        case 'fixed': st.fixed = true; break;
        case 'scientific': st.fixed = false; break;
        case 'precision': st.precision = v.n; break;
        case 'width': st.width = v.n; break;
        case 'fill': st.fill = String.fromCharCode(v.n); break;
        case 'boolalpha': st.boolalpha = v.n === 1; break;
      }
      return;
    }
    if (v instanceof Obj) {
      const g = this.functions.get('operator<<')?.find((f) => f.params.length === 2) ?? this.findMethod(v.cls, 'operator<<', 2);
      if (g) {
        this.invoke(g, [st, v], null, null, this.line);
        return;
      }
      throw new RtError(`no operator<< for ${v.cls.name} — print its fields instead`, this.line);
    }
    let s = this.cppStr(v, st);
    if (st.width > s.length) s = st.fill.repeat(st.width - s.length) + s;
    st.width = 0;
    this.out(s);
  }

  cppStr(v: V, st: Stream): string {
    if (typeof v === 'string') return v;
    if (typeof v === 'number' || typeof v === 'bigint') return String(v);
    if (v instanceof Dbl) return st.fixed ? (Number.isFinite(v.v) ? v.v.toFixed(st.precision) : fmtG(v.v)) : fmtG(v.v, st.precision);
    if (v instanceof Chr) return charStr(v);
    if (typeof v === 'boolean') return st.boolalpha ? String(v) : v ? '1' : '0';
    if (v === null) return '0';
    if (v instanceof Ptr) return `0x${(0x5555a000 + v.o.id * 32).toString(16)}`;
    if (v instanceof Vec && v.kind === 'array') return `0x${(0x7ffd1000 + v.id * 64).toString(16)}`;
    if (v instanceof ExcV) return v.msg;
    throw new RtError(`cannot print a ${describe(v)} with cout — there is no operator<< for it (loop over it and print the elements)`, this.line);
  }

  /** Java String.valueOf semantics */
  javaStr(v: V): string {
    if (v === null) return 'null';
    if (v === undefined) return '';
    if (typeof v === 'string') return v;
    if (typeof v === 'number' || typeof v === 'bigint' || typeof v === 'boolean') return String(v);
    if (v instanceof Dbl) return javaDouble(v.v);
    if (v instanceof Chr) return charStr(v);
    if (v instanceof SB) return v.s;
    if (v instanceof Vec) {
      if (v.kind === 'array') return `[${arrayTypeCode(v.et)}@${(0x1b6d3586 + v.id * 7919).toString(16)}`;
      return `[${v.a.map((x) => (x === v ? '(this Collection)' : this.javaStr(x))).join(', ')}]`;
    }
    if (v instanceof PQ) return `[${v.a.map((x) => this.javaStr(x)).join(', ')}]`;
    if (v instanceof SetV) return `[${v.values().map((x) => this.javaStr(x)).join(', ')}]`;
    if (v instanceof MapV) return `{${v.keys().map((k) => `${this.javaStr(v.m.get(k)![0])}=${this.javaStr(v.m.get(k)![1])}`).join(', ')}}`;
    if (v instanceof Pair) return `${this.javaStr(v.first)}=${this.javaStr(v.second)}`;
    if (v instanceof Obj) {
      if (v.cls.decl?.isEnum) return String(v.f.get('name'));
      const m = this.findMethod(v.cls, 'toString', 0);
      if (m) return this.javaStr(this.invoke(m, [], v, v.cls, this.line));
      if (v.cls.isException || v.f.has('message')) return `${v.cls.name}${v.f.get('message') ? `: ${v.f.get('message')}` : ''}`;
      return `${v.cls.name}@${(0x4e50df2e + v.id * 104729).toString(16)}`;
    }
    if (v instanceof ExcV) return `${javaExcName(v.type)}${v.msg ? `: ${v.msg}` : ''}`;
    if (v instanceof Closure || v instanceof Native || v instanceof FnRef) return `Main$$Lambda@${(0x6d06d69c).toString(16)}`;
    if (v instanceof JIter) return 'java.util.Iterator';
    return String(v);
  }

  /** a JS comparator for a C++ "less" callable or a Java Comparator (null = natural order) */
  sorter(cmp: V | undefined): (a: V, b: V) => number {
    if (cmp === undefined || cmp === null) return cmpVal;
    if (this.java) return (a, b) => toNumber(this.callValue(cmp, [a, b], this.line));
    return (a, b) => (this.truthy(this.callValue(cmp, [a, b], this.line)) ? -1 : this.truthy(this.callValue(cmp, [b, a], this.line)) ? 1 : 0);
  }

  /** C++ strict-weak "less" as a boolean predicate */
  lessFn(cmp: V | undefined): (a: V, b: V) => boolean {
    if (cmp === undefined || cmp === null) return (a, b) => cmpVal(a, b) < 0;
    if (this.java) return (a, b) => toNumber(this.callValue(cmp, [a, b], this.line)) < 0;
    return (a, b) => this.truthy(this.callValue(cmp, [a, b], this.line));
  }

  rand(): number {
    this.randState = (Math.imul(this.randState, 1103515245) + 12345) & 0x7fffffff;
    return this.randState;
  }
}

export class ObjBox implements Box {
  ty = null;
  constructor(
    public o: Obj,
    public it: Interp,
  ) {}
  get() {
    return this.o;
  }
  set(v: V) {
    if (!(v instanceof Obj)) throw new RtError('cannot assign a non-object through an object pointer', this.it.line);
    this.o.f = new Map([...v.f].map(([k, x]) => [k, copyVal(x)]));
  }
}

const NO_OP = Symbol('no-op');

/** std::string::npos as a 32-bit size_t */
export const NPOS = 4294967295;

/**
 * C++ converts a negative int to unsigned when compared with an unsigned value. Types are not tracked, but a value
 * above INT_MAX that fits in 32 bits can only come from an unsigned type (size_t, npos), so convert in that case.
 */
function unsignedConv(a: V, b: V): [V, V] {
  if (typeof a === 'number' && typeof b === 'number') {
    if (a > INT_MAX && a <= NPOS && b < 0) return [a, b >>> 0];
    if (b > INT_MAX && b <= NPOS && a < 0) return [a >>> 0, b];
  }
  return [a, b];
}

function loopComp(c: Comp, label?: string): 'next' | 'break' | 'out' {
  if (!c) return 'next';
  if (c.k === 'break') return !c.label || c.label === label ? 'break' : 'out';
  if (c.k === 'continue') return !c.label || c.label === label ? 'next' : 'out';
  return 'out';
}

export function isLvalueExpr(e: Expr): boolean {
  return e.k === 'id' || e.k === 'member' || e.k === 'index' || (e.k === 'un' && (e.op === '*' || e.op === '++' || e.op === '--')) || e.k === 'this';
}

function isExprArray(a: unknown[]): a is Expr[] {
  const x = a[0] as { k?: unknown; line?: unknown } | null;
  return !!x && typeof x === 'object' && typeof x.k === 'string' && typeof x.line === 'number' && !(x instanceof Pair) && !(x instanceof Obj);
}

function copyIfCpp(v: V, java: boolean): V {
  return java ? v : copyVal(v);
}

/** wrap an already-computed value as an expression (for calling library code that expects Expr args) */
export function litExpr(v: V, line: number): Expr {
  return { k: 'lit', line, v };
}

function typeScore(ty: TypeNode, v: V): number {
  if (ty.ptr || ty.arr) return v instanceof Vec || v instanceof Ptr || v === null ? 2 : 0;
  switch (ty.name) {
    case 'int': case 'short': case 'byte': case 'uint':
      return typeof v === 'number' ? 3 : v instanceof Chr ? 1 : typeof v === 'bigint' ? 1 : 0;
    case 'long': case 'ulong':
      return typeof v === 'bigint' ? 3 : typeof v === 'number' ? 2 : 0;
    case 'double':
      return v instanceof Dbl ? 3 : isNum(v) ? 1 : 0;
    case 'char':
      return v instanceof Chr ? 3 : 0;
    case 'bool':
      return typeof v === 'boolean' ? 3 : 0;
    case 'string':
      return typeof v === 'string' ? 3 : 0;
  }
  if (v instanceof Obj) return v.cls.name === ty.name ? 3 : 1;
  if (v instanceof Vec) return /vector|List|ArrayList|array/.test(ty.name) ? 3 : 1;
  return 1;
}

function javaTypeMatches(v: V, ty: TypeNode): boolean {
  switch (ty.orig ?? ty.name) {
    case 'Integer': return typeof v === 'number';
    case 'Long': return typeof v === 'bigint';
    case 'Double': return v instanceof Dbl;
    case 'String': return typeof v === 'string';
    case 'Character': return v instanceof Chr;
    case 'Object': return true;
  }
  return false;
}

function arrayTypeCode(et: TypeNode | null): string {
  if (!et) return 'Ljava.lang.Object;';
  if (et.arr) return `[${arrayTypeCode({ ...et, arr: et.arr - 1 })}`;
  switch (et.name) {
    case 'int': return et.orig === 'Integer' ? 'Ljava.lang.Integer;' : 'I';
    case 'long': return 'J';
    case 'double': return 'D';
    case 'char': return 'C';
    case 'bool': return 'Z';
    case 'string': return 'Ljava.lang.String;';
  }
  return `L${et.name};`;
}

const JAVA_EXC_PKG: Record<string, string> = {
  IOException: 'java.io.IOException',
  InputMismatchException: 'java.util.InputMismatchException',
  NoSuchElementException: 'java.util.NoSuchElementException',
  ConcurrentModificationException: 'java.util.ConcurrentModificationException',
  EmptyStackException: 'java.util.EmptyStackException',
};

export function javaExcName(t: string): string {
  return JAVA_EXC_PKG[t] ?? `java.lang.${t}`;
}

const JAVA_EXC_PARENT: Record<string, string> = {
  ArithmeticException: 'RuntimeException',
  ArrayIndexOutOfBoundsException: 'IndexOutOfBoundsException',
  StringIndexOutOfBoundsException: 'IndexOutOfBoundsException',
  IndexOutOfBoundsException: 'RuntimeException',
  NullPointerException: 'RuntimeException',
  IllegalArgumentException: 'RuntimeException',
  NumberFormatException: 'IllegalArgumentException',
  IllegalStateException: 'RuntimeException',
  UnsupportedOperationException: 'RuntimeException',
  ClassCastException: 'RuntimeException',
  NegativeArraySizeException: 'RuntimeException',
  NoSuchElementException: 'RuntimeException',
  InputMismatchException: 'NoSuchElementException',
  EmptyStackException: 'RuntimeException',
  ConcurrentModificationException: 'RuntimeException',
  RuntimeException: 'Exception',
  IOException: 'Exception',
  Exception: 'Throwable',
  StackOverflowError: 'Error',
  Error: 'Throwable',
  // C++
  out_of_range: 'logic_error',
  invalid_argument: 'logic_error',
  length_error: 'logic_error',
  logic_error: 'exception',
  runtime_error: 'exception',
  overflow_error: 'runtime_error',
  range_error: 'runtime_error',
  bad_alloc: 'exception',
};

export function excIsA(type: string, want: string, java: boolean): boolean {
  void java;
  for (let t: string | undefined = type; t; t = JAVA_EXC_PARENT[t]) if (t === want) return true;
  return false;
}

function describeCpp(v: V): string {
  if (typeof v === 'number') return 'int';
  if (typeof v === 'bigint') return 'long long';
  if (typeof v === 'string') return 'char const*';
  if (v instanceof Dbl) return 'double';
  if (v instanceof Chr) return 'char';
  return describe(v);
}

export { MIt, It, Tokenizer, SetV, JIter };
