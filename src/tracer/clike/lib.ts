import type { Expr, TypeNode } from './ast';
import { T } from './ast';
import {
  Addr, Box, BoxRef, Chr, Closure, Manip, Dbl, ExcV, FnRef, It, JIter, MIt, MapV, Native, Obj, PQ, Pair, Ptr, SB, SetV, Stream, Tokenizer, V, VarBox, Vec,
  charStr, cmpVal, copyVal, describe, eqVal, fmtExp, fmtG, isNum, javaDouble, keyOf, toBig, toInt, toNumber,
} from './values';
import { ElemBox, ExitSignal, Interp, MapBox, NPOS, RtError, StrCharBox, isLvalueExpr, mapEntry } from './interp';

type Args = Expr[];

const JAVA_STATIC = new Set(['Math', 'Arrays', 'Collections', 'Integer', 'Long', 'Double', 'Float', 'Character', 'String', 'Boolean', 'List', 'Set', 'Map', 'Objects', 'System', 'Comparator', 'Short', 'Byte', 'Thread', 'StrictMath']);

export function isStaticClass(name: string, java: boolean): boolean {
  return java ? JAVA_STATIC.has(name) : name === 'ios' || name === 'ios_base';
}

function argc(args: Args, lo: number, hi: number, name: string, line: number) {
  if (args.length < lo || args.length > hi) throw new RtError(`${name}() takes ${lo === hi ? lo : `${lo}–${hi}`} argument(s), got ${args.length}`, line);
}

const ev = (it: Interp, e: Expr) => it.ev(e);
const evs = (it: Interp, args: Args) => args.map((a) => it.ev(a));

// ---------- sequences & iterators ----------
export function iterLen(src: Vec | Box): number {
  return src instanceof Vec ? src.a.length : (src.get() as string).length;
}

function toIt(it: Interp, v: V): It | MIt {
  if (v instanceof It || v instanceof MIt) return v;
  if (v instanceof Vec) return new It(v, 0);
  throw new RtError(`expected an iterator but got a ${describe(v)}`, it.line);
}

/** physical indices covered by [first, last) */
function rangeIdx(it: Interp, first: V, last: V): { src: Vec | Box; idx: number[] } {
  const a = toIt(it, first);
  const b = toIt(it, last);
  if (!(a instanceof It) || !(b instanceof It)) throw new RtError('this algorithm needs random-access iterators (vector, array, string, deque)', it.line);
  if (a.src !== b.src) throw new RtError('the two iterators belong to different containers (undefined behavior)', it.line);
  const n = iterLen(a.src);
  if (a.i > b.i) throw new RtError('first iterator is after last (undefined behavior)', it.line);
  if (a.i < 0 || b.i > n) throw new RtError(`iterator range [${a.i}, ${b.i}) is outside the container of size ${n}`, it.line);
  const idx: number[] = [];
  for (let i = a.i; i < b.i; i++) idx.push(a.rev ? n - 1 - i : i);
  return { src: a.src, idx };
}

function getAt(src: Vec | Box, i: number): V {
  return src instanceof Vec ? src.a[i] : new Chr((src.get() as string).charCodeAt(i));
}

function readRange(it: Interp, first: V, last: V): V[] {
  const a = toIt(it, first);
  if (a instanceof MIt) {
    const b = toIt(it, last) as MIt;
    const ks = a.src.keys();
    const out: V[] = [];
    for (let i = a.i; i < b.i; i++) {
      const k = ks[a.rev ? ks.length - 1 - i : i];
      out.push(a.src instanceof MapV ? mapEntry(a.src, k, it) : a.src.m.get(k)![0]);
      if (a.src instanceof SetV) for (let c = 1; c < a.src.m.get(k)![1]; c++) out.push(a.src.m.get(k)![0]);
    }
    return out;
  }
  const { src, idx } = rangeIdx(it, first, last);
  return idx.map((i) => getAt(src, i));
}

function writeRange(it: Interp, first: V, last: V, vals: V[]) {
  const { src, idx } = rangeIdx(it, first, last);
  if (src instanceof Vec) idx.forEach((p, j) => (src.a[p] = it.coerce(src.et, vals[j])));
  else {
    const chars = (src.get() as string).split('');
    idx.forEach((p, j) => (chars[p] = charStr(it.coerce(T('char'), vals[j]) as Chr)));
    src.set(chars.join(''));
  }
}

function itAt(first: V, offset: number): It {
  const a = first instanceof Vec ? new It(first, 0) : (first as It);
  return new It(a.src, a.i + offset, a.rev);
}

function lowerBound(vals: V[], x: V, less: (a: V, b: V) => boolean, upper: boolean): number {
  let lo = 0;
  let hi = vals.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    const go = upper ? !less(x, vals[mid]) : less(vals[mid], x);
    if (go) lo = mid + 1;
    else hi = mid;
  }
  return lo;
}

function nextPerm(a: V[], less: (x: V, y: V) => boolean): boolean {
  let i = a.length - 2;
  while (i >= 0 && !less(a[i], a[i + 1])) i--;
  if (i < 0) {
    a.reverse();
    return false;
  }
  let j = a.length - 1;
  while (!less(a[i], a[j])) j--;
  [a[i], a[j]] = [a[j], a[i]];
  let l = i + 1;
  let r = a.length - 1;
  while (l < r) {
    [a[l], a[r]] = [a[r], a[l]];
    l++;
    r--;
  }
  return true;
}

const gcd = (a: bigint, b: bigint): bigint => {
  a = a < 0n ? -a : a;
  b = b < 0n ? -b : b;
  while (b) [a, b] = [b, a % b];
  return a;
};

/** result keeps the "widest" numeric kind of the inputs */
function numLike(sample: V[], r: number | bigint): V {
  if (sample.some((x) => x instanceof Dbl)) return new Dbl(Number(r));
  if (sample.some((x) => typeof x === 'bigint')) return BigInt(r);
  return Number(r);
}

function mathD(it: Interp, args: Args, f: (...x: number[]) => number): V {
  return new Dbl(f(...evs(it, args).map(toNumber)));
}

// ---------- printf ----------
export function sprintf(it: Interp, fmt: string, vals: V[], java: boolean): string {
  let ai = 0;
  return fmt.replace(/%([-+ 0#,]*)(\d+|\*)?(?:\.(\d+|\*))?(hh|h|ll|l|L|z|j|t)?([diuoxXfFeEgGcspaAnb%])/g, (m, flags: string, w: string | undefined, p: string | undefined, _len: string, conv: string) => {
    if (conv === '%') return '%';
    if (conv === 'n') return java ? '\n' : '';
    if (w === '*') w = String(toInt(vals[ai++]));
    if (p === '*') p = String(toInt(vals[ai++]));
    if (ai >= vals.length) {
      if (java) it.throwExc('MissingFormatArgumentException', `Format specifier '${m}'`);
      return m;
    }
    const v = vals[ai++];
    let s: string;
    const prec = p !== undefined ? parseInt(p, 10) : undefined;
    switch (conv) {
      case 'd':
      case 'i':
      case 'u': {
        if (java && !(typeof v === 'number' || typeof v === 'bigint')) it.throwExc('IllegalFormatConversionException', `d != ${describe(v)}`);
        let n = isNum(v) ? (typeof v === 'bigint' ? v : BigInt(Math.trunc(toNumber(v)))) : 0n;
        if (conv === 'u' && n < 0n) n = BigInt.asUintN(32, n);
        s = (n < 0n ? -n : n).toString();
        if (flags.includes(',')) s = s.replace(/\B(?=(\d{3})+(?!\d))/g, ',');
        if (n < 0n) s = `-${s}`;
        else if (flags.includes('+')) s = `+${s}`;
        else if (flags.includes(' ')) s = ` ${s}`;
        break;
      }
      case 'f':
      case 'F': {
        const x = toNumber(v);
        s = Number.isFinite(x) ? x.toFixed(prec ?? 6) : java ? javaDouble(x) : fmtG(x);
        if (flags.includes(',')) s = s.replace(/^(-?\d+)/, (d) => d.replace(/\B(?=(\d{3})+(?!\d))/g, ','));
        if (x >= 0 && flags.includes('+')) s = `+${s}`;
        break;
      }
      case 'e':
      case 'E':
        s = fmtExp(toNumber(v), prec ?? 6, conv === 'E');
        break;
      case 'g':
      case 'G':
        s = fmtG(toNumber(v), prec ?? 6);
        if (conv === 'G') s = s.toUpperCase();
        break;
      case 'c':
        s = v instanceof Chr ? charStr(v) : typeof v === 'string' ? v : String.fromCharCode(toInt(v));
        break;
      case 's':
        s = java ? it.javaStr(v) : typeof v === 'string' ? v : it.cppStr(v, it.cout);
        if (prec !== undefined) s = s.slice(0, prec);
        break;
      case 'b':
        s = String(v !== null && v !== false);
        break;
      case 'x':
      case 'X':
      case 'o': {
        let n = typeof v === 'bigint' ? BigInt.asUintN(64, v) : BigInt(toInt(v) >>> 0);
        if (typeof v !== 'bigint' && !java) n = BigInt(toInt(v) >>> 0);
        s = n.toString(conv === 'o' ? 8 : 16);
        if (conv === 'X') s = s.toUpperCase();
        if (flags.includes('#')) s = (conv === 'o' ? '0' : conv === 'X' ? '0X' : '0x') + s;
        break;
      }
      default:
        s = String(v);
    }
    const width = w ? parseInt(w, 10) : 0;
    if (s.length < width) {
      if (flags.includes('-')) s = s.padEnd(width);
      else if (flags.includes('0') && /[diufFeEgGxXo]/.test(conv)) {
        const sign = /^[+-]/.test(s) ? s[0] : '';
        s = sign + s.slice(sign.length).padStart(width - sign.length, '0');
      } else s = s.padStart(width);
    }
    return s;
  });
}

function scanf(it: Interp, args: Args, line: number): V {
  const fmt = ev(it, args[0]) as string;
  let ai = 1;
  let count = 0;
  const re = /%(\d*)(hh|h|ll|l|L)?([dioufeEgsc%])|(\s+)|([^%\s]+)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(fmt))) {
    if (m[4]) {
      it.skipWs();
      continue;
    }
    if (m[5]) {
      it.skipWs();
      if (it.opts.stdin.startsWith(m[5], it.inPos)) it.inPos += m[5].length;
      else break;
      continue;
    }
    if (m[3] === '%') continue;
    const target = ev(it, args[ai++]);
    const box = target instanceof Addr ? target.box : target instanceof Vec ? null : null;
    if (m[3] === 'c') {
      if (it.inPos >= it.opts.stdin.length) return count || -1;
      const c = new Chr(it.opts.stdin.charCodeAt(it.inPos++));
      if (box) box.set(c);
      count++;
      continue;
    }
    const tok = it.readToken();
    if (tok === null) return count || -1;
    if (m[3] === 's') {
      if (box) box.set(tok);
      else if (target instanceof Vec) {
        target.a.forEach((_, i) => (target.a[i] = new Chr(i < tok.length ? tok.charCodeAt(i) : 0)));
      }
      count++;
      continue;
    }
    if (!box) throw new RtError('scanf needs the address of a variable: scanf("%d", &x)', line);
    if (/[dioux]/.test(m[3])) {
      if (!/^[+-]?\d+$/.test(tok)) return count;
      box.set(it.coerce(box.ty ?? (m[2] === 'll' ? T('long') : T('int')), m[2] === 'll' ? BigInt(tok) : Number(tok)));
    } else {
      const x = parseFloat(tok);
      if (Number.isNaN(x)) return count;
      box.set(new Dbl(x));
    }
    count++;
  }
  return count;
}

// ---------- C++ free functions ----------
export function callBuiltinFn(it: Interp, name: string, args: Args, line: number, fnExpr: Expr): V {
  void fnExpr;
  const java = it.java;
  if (java) throw new RtError(`cannot find symbol: method ${name}()`, line);
  switch (name) {
    case 'sort':
    case 'stable_sort': {
      argc(args, 2, 3, name, line);
      const [f, l, c] = evs(it, args);
      const vals = readRange(it, f, l);
      vals.sort(it.sorter(c));
      writeRange(it, f, l, vals);
      return undefined;
    }
    case 'partial_sort':
    case 'nth_element': {
      const [f, , l, c] = evs(it, args);
      const vals = readRange(it, f, l);
      vals.sort(it.sorter(c));
      writeRange(it, f, l, vals);
      return undefined;
    }
    case 'reverse': {
      argc(args, 2, 2, name, line);
      const [f, l] = evs(it, args);
      writeRange(it, f, l, readRange(it, f, l).reverse());
      return undefined;
    }
    case 'rotate': {
      const [f, mid, l] = evs(it, args);
      const vals = readRange(it, f, l);
      const k = (toIt(it, mid) as It).i - (toIt(it, f) as It).i;
      writeRange(it, f, l, [...vals.slice(k), ...vals.slice(0, k)]);
      return undefined;
    }
    case 'max':
    case 'min': {
      if (args.length === 1 && args[0].k === 'init') {
        const vals = args[0].items.map((x) => ev(it, x));
        return vals.reduce((a, b) => ((name === 'max' ? cmpVal(b, a) > 0 : cmpVal(b, a) < 0) ? b : a));
      }
      argc(args, 2, 3, name, line);
      const [a, b, c] = evs(it, args);
      const less = it.lessFn(c);
      if (c === undefined && (typeof a === 'number') !== (typeof b === 'number') && isNum(a) && isNum(b) && !(a instanceof Chr) && !(b instanceof Chr))
        throw new RtError(`${name}(a, b) needs both arguments of the same type (got ${describe(a)} and ${describe(b)}) — cast one, e.g. ${name}<long long>(a, b)`, line);
      return name === 'max' ? (less(a, b) ? b : a) : less(b, a) ? b : a;
    }
    case 'swap': {
      argc(args, 2, 2, name, line);
      const a = it.lv(args[0]);
      const b = it.lv(args[1]);
      const t = a.get();
      a.set(b.get());
      b.set(t);
      return undefined;
    }
    case 'iter_swap': {
      const a = it.derefIt(toIt(it, ev(it, args[0])) as It);
      const b = it.derefIt(toIt(it, ev(it, args[1])) as It);
      const t = a.get();
      a.set(b.get());
      b.set(t);
      return undefined;
    }
    case 'abs':
    case 'labs':
    case 'llabs':
    case 'fabs': {
      const v = ev(it, args[0]);
      if (typeof v === 'bigint') return v < 0n ? -v : v;
      if (v instanceof Dbl || name === 'fabs') return new Dbl(Math.abs(toNumber(v)));
      return Math.abs(toNumber(v)) | 0;
    }
    case 'sqrt': case 'sqrtl': return mathD(it, args, Math.sqrt);
    case 'cbrt': return mathD(it, args, Math.cbrt);
    case 'pow': case 'powl': return mathD(it, args, Math.pow);
    case 'exp': return mathD(it, args, Math.exp);
    case 'log': return mathD(it, args, Math.log);
    case 'log2': return mathD(it, args, Math.log2);
    case 'log10': return mathD(it, args, Math.log10);
    case 'ceil': return mathD(it, args, Math.ceil);
    case 'floor': return mathD(it, args, Math.floor);
    case 'round': return mathD(it, args, (x) => Math.sign(x) * Math.round(Math.abs(x)));
    case 'trunc': return mathD(it, args, Math.trunc);
    case 'sin': return mathD(it, args, Math.sin);
    case 'cos': return mathD(it, args, Math.cos);
    case 'tan': return mathD(it, args, Math.tan);
    case 'asin': return mathD(it, args, Math.asin);
    case 'acos': return mathD(it, args, Math.acos);
    case 'atan': return mathD(it, args, Math.atan);
    case 'atan2': return mathD(it, args, Math.atan2);
    case 'hypot': return mathD(it, args, Math.hypot);
    case 'fmod': return mathD(it, args, (a, b) => a % b);
    case 'fmax': return mathD(it, args, Math.max);
    case 'fmin': return mathD(it, args, Math.min);
    case 'llround': case 'lround': return BigInt(Math.round(toNumber(ev(it, args[0]))));
    case '__gcd':
    case 'gcd':
    case 'lcm': {
      const vals = evs(it, args);
      const [a, b] = vals.map(toBig);
      const g = gcd(a, b);
      const r = name === 'lcm' ? (g === 0n ? 0n : ((a < 0n ? -a : a) / g) * (b < 0n ? -b : b)) : g;
      return numLike(vals, r);
    }
    case 'to_string': {
      const v = ev(it, args[0]);
      if (v instanceof Dbl) return v.v.toFixed(6);
      if (v instanceof Chr) return String(v.c);
      return String(toNumber(v) === toNumber(v) && typeof v === 'bigint' ? v : toNumber(v));
    }
    case 'stoi':
    case 'stol':
    case 'stoll':
    case 'stoul':
    case 'stoull':
    case 'atoi':
    case 'atol':
    case 'atoll': {
      const s = String(ev(it, args[0]));
      const base = args[2] ? toInt(ev(it, args[2])) : 10;
      const m = (base === 16 ? /^\s*[+-]?(0x)?[0-9a-f]+/i : base === 2 ? /^\s*[+-]?[01]+/ : /^\s*[+-]?\d+/).exec(s);
      if (!m) {
        if (name.startsWith('ato')) return 0;
        it.throwExc('invalid_argument', name);
      }
      const big = BigInt.asIntN(64, base === 10 ? BigInt(m[0].trim()) : BigInt(parseInt(m[0], base)));
      if (name === 'stoi' && (big > 2147483647n || big < -2147483648n)) it.throwExc('out_of_range', 'stoi');
      return name === 'stoi' || name === 'atoi' ? Number(big) : big;
    }
    case 'stod':
    case 'stof':
    case 'atof': {
      const x = parseFloat(String(ev(it, args[0])));
      if (Number.isNaN(x) && !name.startsWith('ato')) it.throwExc('invalid_argument', name);
      return new Dbl(Number.isNaN(x) ? 0 : x);
    }
    case 'printf': {
      const vals = evs(it, args);
      const s = sprintf(it, String(vals[0]), vals.slice(1), false);
      it.out(s);
      return s.length;
    }
    case 'puts':
      it.out(`${ev(it, args[0])}\n`);
      return 0;
    case 'putchar': {
      const v = ev(it, args[0]);
      it.out(v instanceof Chr ? charStr(v) : String.fromCharCode(toInt(v)));
      return v;
    }
    case 'getchar':
      if (it.inPos >= it.opts.stdin.length) return -1;
      return it.opts.stdin.charCodeAt(it.inPos++);
    case 'scanf':
      return scanf(it, args, line);
    case 'getline': {
      const st = ev(it, args[0]) as Stream;
      const b = it.lv(args[1]);
      if (st.fail) return st;
      const delim = args[2] ? charStr(ev(it, args[2]) as Chr) : '\n';
      if (it.inPos >= it.opts.stdin.length) {
        st.fail = true;
        b.set('');
        return st;
      }
      const s = it.opts.stdin;
      let end = s.indexOf(delim, it.inPos);
      if (end < 0) end = s.length;
      b.set(s.slice(it.inPos, end).replace(/\r$/, ''));
      it.inPos = end + 1;
      return st;
    }
    case 'accumulate': {
      const [f, l, init, op] = evs(it, args);
      let acc = init;
      for (const x of readRange(it, f, l)) acc = op !== undefined ? it.callValue(op, [acc, x], line) : it.coerceLike(acc, it.binop('+', acc, x, line));
      return acc;
    }
    case 'partial_sum': {
      const [f, l, d] = evs(it, args);
      const vals = readRange(it, f, l);
      for (let i = 1; i < vals.length; i++) vals[i] = it.coerceLike(vals[i], it.binop('+', vals[i - 1], vals[i], line));
      writeRange(it, d, itAt(d, vals.length), vals);
      return itAt(d, vals.length);
    }
    case 'iota': {
      const [f, l, start] = evs(it, args);
      const n = readRange(it, f, l).length;
      writeRange(it, f, l, Array.from({ length: n }, (_, i) => it.binop('+', start, i, line)));
      return undefined;
    }
    case 'fill': {
      const [f, l, v] = evs(it, args);
      writeRange(it, f, l, readRange(it, f, l).map(() => copyVal(v)));
      return undefined;
    }
    case 'fill_n': {
      const [f, n, v] = evs(it, args);
      writeRange(it, f, itAt(f, toInt(n)), Array.from({ length: toInt(n) }, () => copyVal(v)));
      return undefined;
    }
    case 'copy': {
      const [f, l, d] = evs(it, args);
      const vals = readRange(it, f, l);
      writeRange(it, d, itAt(d, vals.length), vals.map(copyVal));
      return itAt(d, vals.length);
    }
    case 'count': {
      const [f, l, v] = evs(it, args);
      return readRange(it, f, l).filter((x) => eqVal(x, v)).length;
    }
    case 'count_if': {
      const [f, l, p] = evs(it, args);
      return readRange(it, f, l).filter((x) => it.truthy(it.callValue(p, [x], line))).length;
    }
    case 'find':
    case 'find_if':
    case 'find_if_not': {
      const [f, l, v] = evs(it, args);
      const vals = readRange(it, f, l);
      const i = vals.findIndex((x) => (name === 'find' ? eqVal(x, v) : it.truthy(it.callValue(v, [x], line)) === (name === 'find_if')));
      const a = toIt(it, f);
      if (a instanceof MIt) return new MIt(a.src, a.i + (i < 0 ? vals.length : i), a.rev);
      return itAt(f, i < 0 ? vals.length : i);
    }
    case 'all_of':
    case 'any_of':
    case 'none_of': {
      const [f, l, p] = evs(it, args);
      const r = readRange(it, f, l).map((x) => it.truthy(it.callValue(p, [x], line)));
      return name === 'all_of' ? r.every(Boolean) : name === 'any_of' ? r.some(Boolean) : !r.some(Boolean);
    }
    case 'for_each': {
      const [f, l, fn] = evs(it, args);
      const a = toIt(it, f);
      if (a instanceof It) {
        const { src, idx } = rangeIdx(it, f, l);
        for (const i of idx) {
          const box = src instanceof Vec ? new ElemBox(src, i, it) : new StrCharBox(src, i, it);
          if (fn instanceof Closure && fn.params[0]?.ty?.ref) it.callClosure(fn, [{ expr: boxExpr(box, line) }], line);
          else it.callValue(fn, [box.get()], line);
        }
      } else for (const x of readRange(it, f, l)) it.callValue(fn, [x], line);
      return fn;
    }
    case 'transform': {
      const vals = evs(it, args);
      const [f, l, d] = vals;
      const src = readRange(it, f, l);
      let out: V[];
      if (vals.length === 5) {
        const src2 = readRange(it, vals[3], itAt(vals[3], src.length));
        out = src.map((x, i) => it.callValue(vals[4], [x, src2[i]], line));
      } else out = src.map((x) => it.callValue(vals[3], [x], line));
      writeRange(it, d, itAt(d, out.length), out);
      return itAt(d, out.length);
    }
    case 'max_element':
    case 'min_element': {
      const [f, l, c] = evs(it, args);
      const vals = readRange(it, f, l);
      const less = it.lessFn(c);
      let bi = 0;
      for (let i = 1; i < vals.length; i++) if (name === 'max_element' ? less(vals[bi], vals[i]) : less(vals[i], vals[bi])) bi = i;
      const a = toIt(it, f);
      if (a instanceof MIt) return new MIt(a.src, a.i + bi, a.rev);
      return itAt(f, vals.length ? bi : 0);
    }
    case 'lower_bound':
    case 'upper_bound':
    case 'binary_search': {
      const [f, l, x, c] = evs(it, args);
      const vals = readRange(it, f, l);
      const less = it.lessFn(c);
      const i = lowerBound(vals, x, less, name === 'upper_bound');
      if (name === 'binary_search') return i < vals.length && !less(x, vals[i]);
      const a = toIt(it, f);
      if (a instanceof MIt) return new MIt(a.src, a.i + i, a.rev);
      return itAt(f, i);
    }
    case 'equal_range': {
      const [f, l, x] = evs(it, args);
      const vals = readRange(it, f, l);
      const less = it.lessFn(undefined);
      return new Pair(itAt(f, lowerBound(vals, x, less, false)), itAt(f, lowerBound(vals, x, less, true)));
    }
    case 'next_permutation':
    case 'prev_permutation': {
      const [f, l, c] = evs(it, args);
      const vals = readRange(it, f, l);
      const less = it.lessFn(c);
      const r = nextPerm(vals, name === 'next_permutation' ? less : (a, b) => less(b, a));
      writeRange(it, f, l, vals);
      return r;
    }
    case 'is_sorted': {
      const [f, l, c] = evs(it, args);
      const vals = readRange(it, f, l);
      const less = it.lessFn(c);
      return vals.every((x, i) => i === 0 || !less(x, vals[i - 1]));
    }
    case 'unique': {
      const [f, l] = evs(it, args);
      const vals = readRange(it, f, l);
      const out: V[] = [];
      for (const x of vals) if (!out.length || !eqVal(out[out.length - 1], x)) out.push(x);
      writeRange(it, f, itAt(f, out.length), out);
      return itAt(f, out.length);
    }
    case 'distance': {
      const [a, b] = evs(it, args).map((x) => toIt(it, x));
      return b.i - a.i;
    }
    case 'next':
    case 'prev': {
      const [a, n] = evs(it, args);
      const d = (n === undefined ? 1 : toInt(n)) * (name === 'next' ? 1 : -1);
      if (a instanceof MIt) return new MIt(a.src, a.i + d, a.rev);
      return itAt(a, d);
    }
    case 'advance': {
      const b = it.lv(args[0]);
      const d = toInt(ev(it, args[1]));
      const a = b.get();
      b.set(a instanceof MIt ? new MIt(a.src, a.i + d, a.rev) : itAt(a, d));
      return undefined;
    }
    case 'begin':
    case 'end':
      return callMethod(it, isLvalueExpr(args[0]) ? it.lv(args[0]) : null, ev(it, args[0]), name, [], line);
    case 'make_pair':
      return new Pair(...(evs(it, args).map(copyVal) as [V, V]));
    case 'make_tuple':
      return new Vec('tuple', evs(it, args).map(copyVal));
    case 'memset': {
      const [a, v] = evs(it, args);
      const b = toInt(v);
      const fillv = b === 0 ? 0 : b === -1 ? -1 : (b & 0xff) * 0x01010101;
      const fill = (x: Vec) => {
        for (let i = 0; i < x.a.length; i++) {
          const c = x.a[i];
          if (c instanceof Vec) fill(c);
          else x.a[i] = it.coerce(x.et, typeof c === 'boolean' ? b !== 0 : c instanceof Chr ? b & 0xff : typeof c === 'bigint' ? BigInt(fillv) : c instanceof Dbl ? (b === 0 ? 0 : NaN) : fillv);
        }
      };
      if (a instanceof Vec) fill(a);
      else throw new RtError('memset needs an array', line);
      return a;
    }
    case 'isdigit': return chrTest(it, args, /[0-9]/);
    case 'isalpha': return chrTest(it, args, /[A-Za-z]/);
    case 'isalnum': return chrTest(it, args, /[A-Za-z0-9]/);
    case 'isupper': return chrTest(it, args, /[A-Z]/);
    case 'islower': return chrTest(it, args, /[a-z]/);
    case 'isspace': return chrTest(it, args, /\s/);
    case 'ispunct': return chrTest(it, args, /[!-/:-@[-`{-~]/);
    case 'isxdigit': return chrTest(it, args, /[0-9a-fA-F]/);
    case 'toupper':
    case 'tolower': {
      const c = toInt(ev(it, args[0]));
      const s = String.fromCharCode(c);
      return (name === 'toupper' ? s.toUpperCase() : s.toLowerCase()).charCodeAt(0);
    }
    case 'exit':
    case 'abort':
    case 'quick_exit':
      throw new ExitSignal(args[0] ? toInt(ev(it, args[0])) : 0);
    case 'assert':
      if (!it.truthy(ev(it, args[0]))) throw new RtError('assertion failed — the program aborts', line);
      return undefined;
    case 'rand':
      return it.rand();
    case 'srand':
      it.randState = toInt(ev(it, args[0])) || 1;
      return undefined;
    case 'time':
    case 'clock':
      return 0;
    case 'sync_with_stdio':
    case 'tie':
    case 'cin.tie':
      return false;
    case '__builtin_popcount':
    case '__builtin_popcountll':
    case 'popcount': {
      let x = BigInt.asUintN(64, toBig(ev(it, args[0])));
      let c = 0;
      while (x) {
        c += Number(x & 1n);
        x >>= 1n;
      }
      return c;
    }
    case '__builtin_clz':
      return Math.clz32(toInt(ev(it, args[0])));
    case '__builtin_clzll': {
      const x = BigInt.asUintN(64, toBig(ev(it, args[0])));
      return 64 - x.toString(2).length;
    }
    case '__builtin_ctz':
    case '__builtin_ctzll': {
      const x = BigInt.asUintN(64, toBig(ev(it, args[0])));
      if (x === 0n) return name === '__builtin_ctz' ? 32 : 64;
      return x.toString(2).length - 1 - x.toString(2).lastIndexOf('1');
    }
    case '__lg':
      return BigInt.asUintN(64, toBig(ev(it, args[0]))).toString(2).length - 1;
    case 'setprecision':
      return new Manip('precision', toInt(ev(it, args[0])));
    case 'setw':
      return new Manip('width', toInt(ev(it, args[0])));
    case 'setfill':
      return new Manip('fill', toInt(ev(it, args[0])));
    case 'move':
    case 'ref':
    case 'cref':
      return ev(it, args[0]);
  }
  throw new RtError(`'${name}' was not declared in this scope (or is not supported by the tracer)`, line);
}

/** an expression that stands for an existing location, so a reference parameter binds to it */
function boxExpr(box: Box, line: number): Expr {
  return { k: 'lit', line, v: new BoxRef(box) };
}

function chrTest(it: Interp, args: Args, re: RegExp): boolean {
  const v = ev(it, args[0]);
  const c = v instanceof Chr ? v.c : toInt(v);
  return c >= 0 && re.test(String.fromCharCode(c));
}

// ---------- C++ construction ----------
export function defaultContainer(it: Interp, ty: TypeNode): V {
  return makeCppConstruct(it, ty, [], it.line, false);
}

function pqBefore(it: Interp, ty: TypeNode, cmpArg: V | undefined): (a: V, b: V) => boolean {
  if (cmpArg !== undefined) {
    const less = it.lessFn(cmpArg);
    return (a, b) => less(b, a);
  }
  const c = ty.args[2];
  if (c) {
    if (c.name === 'greater' || c.name === 'greater_equal') return (a, b) => cmpVal(a, b) < 0;
    if (c.name === 'less' || c.name === 'less_equal') return (a, b) => cmpVal(a, b) > 0;
    const cls = it.classes.get(c.name);
    if (cls) {
      const functor = it.newObject(cls, [], it.line, null);
      const less = it.lessFn(functor);
      return (a, b) => less(b, a);
    }
  }
  return (a, b) => cmpVal(a, b) > 0;
}

function orderCmp(it: Interp, c: TypeNode | undefined, cmpArg: V | undefined): ((a: V, b: V) => number) | null {
  if (cmpArg !== undefined) return it.sorter(cmpArg);
  if (!c) return null;
  if (c.name === 'greater') return (a, b) => -cmpVal(a, b);
  if (c.name === 'less') return null;
  const cls = it.classes.get(c.name);
  if (cls) return it.sorter(it.newObject(cls, [], it.line, null));
  return null;
}

export function makeCppConstruct(it: Interp, ty: TypeNode, args: Args, line: number, brace: boolean): V {
  const n = ty.name;
  const et = ty.args[0] ?? null;
  if (ty.ptr) return args.length ? ev(it, args[0]) : null;
  if (brace && n !== 'vector' && n !== 'deque' && n !== 'list' && !['set', 'unordered_set', 'multiset', 'map', 'unordered_map', 'pair', 'array', 'tuple'].includes(n)) {
    if (args.length <= 1) return args.length ? it.evTo(ty, args[0]) : it.defaultVal(ty);
  }
  switch (n) {
    case 'int': case 'long': case 'uint': case 'ulong': case 'double': case 'char': case 'bool': case 'short': case 'byte':
      return args.length ? it.cast(ty, ev(it, args[0])) : it.defaultVal(ty);
    case 'auto':
      return args.length ? ev(it, args[0]) : null;
    case 'string': {
      if (brace) return it.fromInit(ty, { k: 'init', line, items: args });
      const vals = evs(it, args);
      if (vals.length === 0) return '';
      if (vals.length === 2 && isNum(vals[0]) && vals[1] instanceof Chr) return charStr(vals[1]).repeat(Math.max(0, toInt(vals[0])));
      if (vals.length === 2 && (vals[0] instanceof It || vals[0] instanceof MIt)) return readRange(it, vals[0], vals[1]).map((c) => charStr(it.coerce(T('char'), c) as Chr)).join('');
      if (vals.length >= 2 && typeof vals[0] === 'string') return vals[0].substr(toInt(vals[1]), vals[2] !== undefined ? toInt(vals[2]) : undefined);
      if (typeof vals[0] === 'string') return vals[0];
      if (vals[0] instanceof Chr) return charStr(vals[0]);
      throw new RtError(`cannot construct a string from a ${describe(vals[0])}`, line);
    }
    case 'vector':
    case 'deque':
    case 'list': {
      const v = new Vec(n, [], et);
      if (brace) {
        v.a = args.map((x) => it.evTo(et, x));
        return v;
      }
      const vals = evs(it, args);
      if (vals.length === 0) return v;
      if (vals.length === 2 && (vals[0] instanceof It || vals[0] instanceof MIt || vals[0] instanceof Vec) && !(isNum(vals[1]))) {
        v.a = readRange(it, vals[0], vals[1]).map((x) => it.coerce(et, x));
        return v;
      }
      if (vals[0] instanceof Vec && vals.length === 1) {
        v.a = vals[0].a.map((x) => it.coerce(et, x));
        return v;
      }
      const count = toInt(vals[0]);
      if (count < 0) throw new RtError(`cannot create a ${n} with negative size ${count} (std::length_error)`, line);
      if (count > 5_000_000) throw new RtError(`a ${n} of ${count} elements is too large for the tracer`, line);
      const fill = vals.length > 1 ? it.coerce(et, vals[1]) : it.defaultVal(et);
      v.a = Array.from({ length: count }, () => copyVal(fill));
      return v;
    }
    case 'array': {
      const size = ty.value ? toInt(ev(it, ty.value)) : args.length;
      const v = new Vec('stdarray', [], et);
      v.a = Array.from({ length: size }, (_, i) => (args[i] ? it.evTo(et, args[i]) : it.defaultVal(et)));
      return v;
    }
    case 'stack':
    case 'queue': {
      const v = new Vec(n, [], et);
      if (args.length) {
        const src = ev(it, args[0]);
        if (src instanceof Vec) v.a = src.a.map(copyVal);
      }
      return v;
    }
    case 'priority_queue': {
      const vals = evs(it, args);
      const cmpArg = vals.find((x) => x instanceof Closure || x instanceof FnRef || x instanceof Native || x instanceof Obj);
      const pq = new PQ('priority_queue', pqBefore(it, ty, cmpArg), et);
      if (vals.length >= 2 && (vals[0] instanceof It || vals[0] instanceof Vec)) for (const x of readRange(it, vals[0], vals[1])) pq.push(copyVal(x));
      return pq;
    }
    case 'set':
    case 'multiset':
    case 'unordered_set':
    case 'unordered_multiset': {
      const vals = brace ? [] : evs(it, args);
      const cmpArg = vals.find((x) => x instanceof Closure || x instanceof FnRef || x instanceof Native);
      const s = new SetV(n, !n.startsWith('unordered'), et, n.startsWith('unordered') ? null : orderCmp(it, ty.args[1], cmpArg), n.includes('multi'));
      const items = brace ? args.map((x) => it.evTo(et, x)) : vals.length >= 2 && !cmpArg ? readRange(it, vals[0], vals[1]) : vals[0] instanceof SetV ? vals[0].values() : vals[0] instanceof Vec ? vals[0].a : [];
      for (const x of items) setAdd(it, s, it.coerce(et, x));
      return s;
    }
    case 'map':
    case 'unordered_map':
    case 'multimap': {
      if (n === 'multimap') throw new RtError('std::multimap is not supported by the tracer — use map<K, vector<V>>', line);
      const vt = ty.args[1] ?? null;
      const vals = brace ? [] : evs(it, args);
      const cmpArg = vals.find((x) => x instanceof Closure || x instanceof FnRef || x instanceof Native);
      const m = new MapV(n, n === 'map', et, vt, n === 'map' ? orderCmp(it, ty.args[2], cmpArg) : null);
      if (brace) {
        for (const x of args) {
          const p = it.evTo(T('pair', [et ?? T('auto'), vt ?? T('auto')]), x) as Pair;
          mapPut(it, m, p.first, p.second, false);
        }
      } else if (vals[0] instanceof MapV) for (const [k, [kk, vv]] of vals[0].m) m.m.set(k, [kk, copyVal(vv)]);
      m.touch();
      return m;
    }
    case 'pair': {
      if (brace) return it.fromInit(ty, { k: 'init', line, items: args });
      if (!args.length) return new Pair(it.defaultVal(ty.args[0] ?? null), it.defaultVal(ty.args[1] ?? null));
      const vals = evs(it, args);
      if (vals.length === 1 && vals[0] instanceof Pair) return copyVal(vals[0]);
      return new Pair(it.coerce(ty.args[0] ?? null, vals[0]), it.coerce(ty.args[1] ?? null, vals[1]));
    }
    case 'tuple':
      return new Vec('tuple', args.map((x, i) => it.evTo(ty.args[i] ?? null, x)));
    case 'greater':
    case 'less':
    case 'greater_equal':
    case 'less_equal': {
      const f = { greater: (c: number) => c > 0, less: (c: number) => c < 0, greater_equal: (c: number) => c >= 0, less_equal: (c: number) => c <= 0 }[n];
      return new Native(`${n}<>`, (a) => f(cmpVal(a[0], a[1])));
    }
    case 'function':
      return args.length ? ev(it, args[0]) : null;
    case 'exception':
    case 'runtime_error':
    case 'logic_error':
    case 'invalid_argument':
    case 'out_of_range':
    case 'overflow_error':
    case 'length_error':
      return new ExcV(n, args.length ? String(ev(it, args[0])) : n === 'exception' ? 'std::exception' : '');
    case 'bitset':
      throw new RtError('std::bitset is not supported by the tracer — use an integer with bit operations or a vector<bool>', line);
  }
  throw new RtError(`cannot construct a ${n} — unknown type`, line);
}

// ---------- container helpers ----------
function setAdd(it: Interp, s: SetV, v: V): boolean {
  const k = keyOf(v, it.java);
  const e = s.m.get(k);
  if (e) {
    if (s.multi) {
      e[1]++;
      s.touch();
      return true;
    }
    return false;
  }
  s.m.set(k, [v, 1]);
  s.touch();
  return true;
}

function setRemove(it: Interp, s: SetV, v: V, all = true): number {
  const k = keyOf(v, it.java);
  const e = s.m.get(k);
  if (!e) return 0;
  if (!all && e[1] > 1) {
    e[1]--;
    s.touch();
    return 1;
  }
  s.m.delete(k);
  s.touch();
  return e[1];
}

function mapPut(it: Interp, m: MapV, k: V, v: V, overwrite = true, head = false): V {
  const kk = keyOf(k, it.java);
  const e = m.m.get(kk);
  if (e) {
    const old = e[1];
    if (overwrite) e[1] = it.coerce(m.vt, v);
    return old;
  }
  m.m.set(kk, [it.coerce(m.kt, k), it.coerce(m.vt, v)]);
  m.seqN++;
  m.seq.set(kk, head ? -m.seqN : m.seqN);
  m.touch();
  return null;
}

function mapGet(it: Interp, m: MapV, k: V): V {
  const e = m.m.get(keyOf(k, it.java));
  return e ? e[1] : null;
}

function keyIndex(it: Interp, s: MapV | SetV, k: V): number {
  return s.keys().indexOf(keyOf(k, it.java));
}

function boundIndex(_it: Interp, s: MapV | SetV, x: V, upper: boolean): number {
  const ks = s.keys();
  const vals = ks.map((k) => s.m.get(k)![0]);
  const c = s.cmp ?? cmpVal;
  return lowerBound(vals, x, (a, b) => c(a, b) < 0, upper);
}

/** for Java TreeMap/TreeSet navigation: index of the greatest key <= x (floor) etc. */
function navKey(it: Interp, s: MapV | SetV, x: V, kind: 'floor' | 'ceiling' | 'lower' | 'higher'): V {
  const ks = s.keys();
  const vals = ks.map((k) => s.m.get(k)![0]);
  const c = s.cmp ?? cmpVal;
  let best: V = null;
  for (const v of vals) {
    const d = c(v, x);
    if (kind === 'floor' && d <= 0) best = v;
    if (kind === 'lower' && d < 0) best = v;
    if (kind === 'ceiling' && d >= 0) return v;
    if (kind === 'higher' && d > 0) return v;
  }
  void it;
  return best;
}

function emptyErr(it: Interp, what: string): never {
  if (it.java) it.throwExc('NoSuchElementException', '');
  throw new RtError(`${what} on an empty container — undefined behavior in C++ (the program may crash)`, it.line);
}

function strBox(recvBox: Box | null, recv: string): Box {
  return recvBox ?? new VarBox(recv, T('string'));
}

/** C++ calls whose result is an lvalue: v.back() = x, m.at(k)++, st.top() += 1 */
export function lvMethod(it: Interp, e: Extract<Expr, { k: 'call' }>): Box | null {
  const fn = e.fn as Extract<Expr, { k: 'member' }>;
  if (it.java) return null;
  const name = fn.name;
  if (!['back', 'front', 'top', 'at', 'first', 'second'].includes(name)) return null;
  let recvBox: Box | null = null;
  let recv: V;
  if (isLvalueExpr(fn.a)) {
    recvBox = it.lv(fn.a);
    recv = recvBox.get();
  } else recv = it.ev(fn.a);
  if (recv instanceof Ptr) recv = recv.o;
  if (recv instanceof Vec) {
    const n = recv.a.length;
    if (name === 'at') {
      const i = toInt(it.ev(e.args[0]));
      if (i < 0 || i >= n) it.throwExc('out_of_range', `vector::_M_range_check: __n (which is ${i}) >= this->size() (which is ${n})`);
      return new ElemBox(recv, i, it);
    }
    if (!n) emptyErr(it, `${name}()`);
    if (name === 'front') return new ElemBox(recv, 0, it);
    if (name === 'back' || name === 'top') return new ElemBox(recv, n - 1, it);
  }
  if (typeof recv === 'string') {
    const sb = strBox(recvBox, recv);
    if (name === 'at') {
      const i = toInt(it.ev(e.args[0]));
      if (i < 0 || i >= recv.length) it.throwExc('out_of_range', `basic_string::at: __n (which is ${i}) >= this->size() (which is ${recv.length})`);
      return new StrCharBox(sb, i, it);
    }
    if (!recv.length) emptyErr(it, `string::${name}()`);
    if (name === 'front') return new StrCharBox(sb, 0, it);
    if (name === 'back') return new StrCharBox(sb, recv.length - 1, it);
  }
  if (recv instanceof MapV && name === 'at') {
    const k = it.ev(e.args[0]);
    if (!recv.m.has(keyOf(k, false))) it.throwExc('out_of_range', 'map::at');
    return new MapBox(recv, k, it);
  }
  return null;
}

// ---------- methods ----------
export function callMethod(it: Interp, recvBox: Box | null, recv: V, name: string, args: Args, line: number): V {
  const java = it.java;
  if (recv === null || recv === undefined) it.nullError(`invoke "${name}()"`);
  if (typeof recv === 'string') return java ? javaString(it, recv, name, args, line) : cppString(it, strBox(recvBox, recv), recv, name, args, line);
  if (recv instanceof Vec) return java ? javaList(it, recv, name, args, line) : cppVec(it, recv, name, args, line);
  if (recv instanceof MapV) return java ? javaMap(it, recv, name, args, line) : cppMap(it, recv, name, args, line);
  if (recv instanceof SetV) return java ? javaSet(it, recv, name, args, line) : cppSet(it, recv, name, args, line);
  if (recv instanceof PQ) return pqMethod(it, recv, name, args, line);
  if (recv instanceof Pair) {
    switch (name) {
      case 'getKey': return recv.first;
      case 'getValue': return recv.second;
      case 'setValue': {
        const old = recv.second;
        recv.second = ev(it, args[0]);
        return old;
      }
      case 'toString': return it.javaStr(recv);
    }
  }
  if (recv instanceof SB) return sbMethod(it, recv, name, args, line);
  if (recv instanceof Stream) return streamMethod(it, recv, name, args, line);
  if (recv instanceof Tokenizer) {
    switch (name) {
      case 'nextToken':
        if (recv.i >= recv.toks.length) it.throwExc('NoSuchElementException', '');
        return recv.toks[recv.i++];
      case 'hasMoreTokens':
      case 'hasMoreElements':
        return recv.i < recv.toks.length;
      case 'countTokens':
        return recv.toks.length - recv.i;
    }
  }
  if (recv instanceof JIter) {
    switch (name) {
      case 'hasNext': return recv.i < recv.items.length;
      case 'next':
        if (recv.i >= recv.items.length) it.throwExc('NoSuchElementException', '');
        return recv.items[recv.i++];
      case 'remove':
        recv.onRemove?.(recv.items[recv.i - 1]);
        return undefined;
    }
  }
  if (recv instanceof ExcV) {
    if (name === 'what' || name === 'getMessage' || name === 'getLocalizedMessage') return recv.msg;
    if (name === 'toString') return it.javaStr(recv);
    if (name === 'printStackTrace') {
      it.out(`${it.javaStr(recv)}\n`);
      return undefined;
    }
  }
  if (recv instanceof Closure || recv instanceof FnRef || recv instanceof Native || recv instanceof Obj) return functionalMethod(it, recv, name, args, line);
  if (java && isNum(recv)) return javaBoxed(it, recv, name, args, line);
  if (recv instanceof It || recv instanceof MIt) throw new RtError(`iterators have no method '${name}' — use *it or it->member`, line);
  throw new RtError(`a ${describe(recv)} has no method '${name}'`, line);
}

function functionalMethod(it: Interp, f: V, name: string, args: Args, line: number): V {
  switch (name) {
    case 'compare': case 'apply': case 'test': case 'accept': case 'applyAsInt': case 'applyAsLong': case 'applyAsDouble': case 'get': case 'run': case 'call':
      return it.callValue(f, evs(it, args), line);
    case 'reversed': {
      const c = it.sorter(f);
      return new Native('reversed', (a) => -c(a[0], a[1]));
    }
    case 'thenComparing':
    case 'thenComparingInt':
    case 'thenComparingLong':
    case 'thenComparingDouble': {
      const first = it.sorter(f);
      const g = ev(it, args[0]);
      const second = keyOrComparator(it, g, name !== 'thenComparing' || args.length > 0);
      return new Native('thenComparing', (a) => first(a[0], a[1]) || second(a[0], a[1]));
    }
    case 'negate':
      return new Native('negate', (a) => !it.truthy(it.callValue(f, a, line)));
    case 'and':
    case 'or': {
      const g = ev(it, args[0]);
      return new Native(name, (a) => (name === 'and' ? it.truthy(it.callValue(f, a, line)) && it.truthy(it.callValue(g, a, line)) : it.truthy(it.callValue(f, a, line)) || it.truthy(it.callValue(g, a, line))));
    }
    case 'andThen': {
      const g = ev(it, args[0]);
      return new Native('andThen', (a) => it.callValue(g, [it.callValue(f, a, line)], line));
    }
  }
  throw new RtError(`${describe(f)} has no method '${name}'`, line);
}

/** a key extractor (1 param) becomes a natural-order comparator; a 2-param function is used as-is */
function keyOrComparator(it: Interp, g: V, tryKey: boolean): (a: V, b: V) => number {
  const arity = g instanceof Closure ? g.params.length : g instanceof FnRef ? g.decls[0]?.params.length ?? 2 : 2;
  if (tryKey && arity === 1) return (a, b) => cmpVal(it.callValue(g, [a], it.line), it.callValue(g, [b], it.line));
  return it.sorter(g);
}

// --- C++ std::string ---
function cppString(it: Interp, box: Box, s: string, name: string, args: Args, line: number): V {
  const n = s.length;
  const argStr = (v: V) => (v instanceof Chr ? charStr(v) : typeof v === 'string' ? v : typeof v === 'number' ? String.fromCharCode(v & 0xff) : it.badConcat(v));
  switch (name) {
    case 'size':
    case 'length':
      return n;
    case 'empty':
      return n === 0;
    case 'substr': {
      const pos = args[0] ? toInt(ev(it, args[0])) : 0;
      const len = args[1] ? toInt(ev(it, args[1])) : undefined;
      if (pos > n || pos < 0) it.throwExc('out_of_range', `basic_string::substr: __pos (which is ${pos}) > this->size() (which is ${n})`);
      return len === undefined || len < 0 ? s.slice(pos) : s.substr(pos, len);
    }
    case 'find':
    case 'rfind': {
      const t = argStr(ev(it, args[0]));
      const from = args[1] ? toInt(ev(it, args[1])) : undefined;
      const r = name === 'find' ? s.indexOf(t, from ?? 0) : s.lastIndexOf(t, from ?? Infinity);
      return r < 0 ? NPOS : r;
    }
    case 'find_first_of':
    case 'find_last_of':
    case 'find_first_not_of':
    case 'find_last_not_of': {
      const set = argStr(ev(it, args[0]));
      const not = name.includes('not');
      const idx = [...s].map((c, i) => ((set.includes(c) !== not) ? i : -1)).filter((i) => i >= 0);
      return (name.includes('first') ? idx[0] : idx[idx.length - 1]) ?? NPOS;
    }
    case 'push_back':
      box.set(s + argStr(ev(it, args[0])));
      return undefined;
    case 'pop_back':
      if (!n) emptyErr(it, 'string::pop_back()');
      box.set(s.slice(0, -1));
      return undefined;
    case 'append':
    case '+=': {
      const vals = evs(it, args);
      if (vals.length === 2 && isNum(vals[0]) && vals[1] instanceof Chr) box.set(s + charStr(vals[1]).repeat(toInt(vals[0])));
      else box.set(s + argStr(vals[0]));
      return box.get();
    }
    case 'insert': {
      const [p, x, y] = evs(it, args);
      const pos = p instanceof It ? p.i : toInt(p);
      if (pos > n) it.throwExc('out_of_range', 'basic_string::insert');
      const t = y !== undefined && isNum(x) ? charStr(y as Chr).repeat(toInt(x)) : argStr(x);
      box.set(s.slice(0, pos) + t + s.slice(pos));
      return p instanceof It ? p : box.get();
    }
    case 'erase': {
      const vals = evs(it, args);
      if (vals[0] instanceof It) {
        const a = vals[0].i;
        const b = vals[1] instanceof It ? vals[1].i : a + 1;
        box.set(s.slice(0, a) + s.slice(b));
        return new It(box, a);
      }
      const pos = vals.length ? toInt(vals[0]) : 0;
      if (pos > n) it.throwExc('out_of_range', 'basic_string::erase');
      const len = vals.length > 1 ? toInt(vals[1]) : n - pos;
      box.set(s.slice(0, pos) + s.slice(pos + (len < 0 ? n : len)));
      return box.get();
    }
    case 'replace': {
      const [p, l, t] = evs(it, args);
      const pos = toInt(p);
      box.set(s.slice(0, pos) + argStr(t) + s.slice(pos + toInt(l)));
      return box.get();
    }
    case 'clear':
      box.set('');
      return undefined;
    case 'resize': {
      const len = toInt(ev(it, args[0]));
      const c = args[1] ? charStr(ev(it, args[1]) as Chr) : '\0';
      box.set(len <= n ? s.slice(0, len) : s + c.repeat(len - n));
      return undefined;
    }
    case 'assign':
      box.set(argStr(ev(it, args[0])));
      return box.get();
    case 'compare': {
      const t = String(ev(it, args[0]));
      return s < t ? -1 : s > t ? 1 : 0;
    }
    case 'c_str':
    case 'data':
    case 'str':
      return s;
    case 'begin':
    case 'cbegin':
      return new It(box, 0);
    case 'end':
    case 'cend':
      return new It(box, n);
    case 'rbegin':
      return new It(box, 0, true);
    case 'rend':
      return new It(box, n, true);
    case 'front':
    case 'back':
    case 'at': {
      const i = name === 'front' ? 0 : name === 'back' ? n - 1 : toInt(ev(it, args[0]));
      if (i < 0 || i >= n) {
        if (name === 'at') it.throwExc('out_of_range', `basic_string::at: __n (which is ${i}) >= this->size() (which is ${n})`);
        emptyErr(it, `string::${name}()`);
      }
      return new Chr(s.charCodeAt(i));
    }
    case 'reserve':
    case 'shrink_to_fit':
      return undefined;
    case 'starts_with':
      return s.startsWith(argStr(ev(it, args[0])));
    case 'ends_with':
      return s.endsWith(argStr(ev(it, args[0])));
    case 'contains':
      return s.includes(argStr(ev(it, args[0])));
    case 'swap': {
      const other = it.lv(args[0]);
      const t = other.get();
      other.set(s);
      box.set(t);
      return undefined;
    }
  }
  throw new RtError(`std::string has no method '${name}' (or the tracer does not support it)`, line);
}

// --- C++ vector / deque / list / stack / queue / array ---
function cppVec(it: Interp, v: Vec, name: string, args: Args, line: number): V {
  const a = v.a;
  const k = v.kind;
  const elem = (e: Expr) => it.evTo(v.et, e);
  switch (name) {
    case 'size':
      return a.length;
    case 'empty':
      return a.length === 0;
    case 'push_back':
    case 'push':
      argc(args, 1, 1, name, line);
      a.push(elem(args[0]));
      return undefined;
    case 'emplace_back':
    case 'emplace':
      a.push(args.length === 1 ? elem(args[0]) : v.et ? it.construct(v.et, args, line) : new Vec('tuple', evs(it, args)));
      return undefined;
    case 'push_front':
    case 'emplace_front':
      a.unshift(args.length === 1 ? elem(args[0]) : it.construct(v.et!, args, line));
      return undefined;
    case 'pop_back':
      if (!a.length) emptyErr(it, `${k}::pop_back()`);
      a.pop();
      return undefined;
    case 'pop':
      if (!a.length) emptyErr(it, `${k}::pop()`);
      if (k === 'queue') a.shift();
      else a.pop();
      return undefined;
    case 'pop_front':
      if (!a.length) emptyErr(it, `${k}::pop_front()`);
      a.shift();
      return undefined;
    case 'top':
      if (!a.length) emptyErr(it, 'stack::top()');
      return a[a.length - 1];
    case 'front':
      if (!a.length) emptyErr(it, `${k}::front()`);
      return a[0];
    case 'back':
      if (!a.length) emptyErr(it, `${k}::back()`);
      return a[a.length - 1];
    case 'at': {
      const i = toInt(ev(it, args[0]));
      if (i < 0 || i >= a.length) it.throwExc('out_of_range', `vector::_M_range_check: __n (which is ${i}) >= this->size() (which is ${a.length})`);
      return a[i];
    }
    case 'clear':
      a.length = 0;
      return undefined;
    case 'begin':
    case 'cbegin':
      return new It(v, 0);
    case 'end':
    case 'cend':
      return new It(v, a.length);
    case 'rbegin':
    case 'crbegin':
      return new It(v, 0, true);
    case 'rend':
    case 'crend':
      return new It(v, a.length, true);
    case 'resize': {
      const n = toInt(ev(it, args[0]));
      const fill = args[1] ? elem(args[1]) : it.defaultVal(v.et);
      if (n < a.length) a.length = n;
      else while (a.length < n) a.push(copyVal(fill));
      return undefined;
    }
    case 'assign': {
      const vals = evs(it, args);
      if (vals[0] instanceof It || vals[0] instanceof MIt) v.a = readRange(it, vals[0], vals[1]).map((x) => it.coerce(v.et, x));
      else {
        const fill = it.coerce(v.et, vals[1]);
        v.a = Array.from({ length: toInt(vals[0]) }, () => copyVal(fill));
      }
      return undefined;
    }
    case 'insert': {
      const vals = args.map((x, i) => (i > 0 && x.k === 'init' ? it.fromInit(v.et, x) : ev(it, x)));
      const pos = toIt(it, vals[0]) as It;
      let items: V[];
      if (vals.length === 3 && (vals[1] instanceof It || vals[1] instanceof MIt)) items = readRange(it, vals[1], vals[2]).map(copyVal);
      else if (vals.length === 3) items = Array.from({ length: toInt(vals[1]) }, () => it.coerce(v.et, vals[2]));
      else items = [it.coerce(v.et, vals[1])];
      if (pos.i < 0 || pos.i > a.length) throw new RtError('insert position is outside the vector (undefined behavior)', line);
      a.splice(pos.i, 0, ...items);
      return new It(v, pos.i);
    }
    case 'erase': {
      const vals = evs(it, args);
      const f = toIt(it, vals[0]) as It;
      const l = vals[1] !== undefined ? (toIt(it, vals[1]) as It) : new It(v, f.i + 1);
      if (f.i < 0 || l.i > a.length || f.i >= a.length + (vals[1] !== undefined ? 1 : 0)) throw new RtError('erase position is outside the vector (undefined behavior)', line);
      a.splice(f.i, l.i - f.i);
      return new It(v, f.i);
    }
    case 'swap': {
      const o = ev(it, args[0]) as Vec;
      [v.a, o.a] = [o.a, v.a];
      return undefined;
    }
    case 'reserve':
    case 'shrink_to_fit':
      return undefined;
    case 'capacity':
    case 'max_size':
      return a.length;
    case 'data':
      return v;
    case 'fill': {
      const x = ev(it, args[0]);
      for (let i = 0; i < a.length; i++) a[i] = it.coerce(v.et, x);
      return undefined;
    }
    case 'sort':
      a.sort(it.sorter(args[0] ? ev(it, args[0]) : undefined));
      return undefined;
    case 'reverse':
      a.reverse();
      return undefined;
    case 'remove': {
      const x = ev(it, args[0]);
      v.a = a.filter((y) => !eqVal(y, x));
      return undefined;
    }
  }
  throw new RtError(`std::${k} has no method '${name}' (or the tracer does not support it)`, line);
}

// --- C++ map / unordered_map ---
function cppMap(it: Interp, m: MapV, name: string, args: Args, line: number): V {
  const keyT = (e: Expr) => it.evTo(m.kt, e);
  switch (name) {
    case 'size':
      return m.m.size;
    case 'empty':
      return m.m.size === 0;
    case 'count':
      return m.m.has(keyOf(keyT(args[0]), false)) ? 1 : 0;
    case 'contains':
      return m.m.has(keyOf(keyT(args[0]), false));
    case 'find': {
      const i = keyIndex(it, m, keyT(args[0]));
      return new MIt(m, i < 0 ? m.m.size : i);
    }
    case 'at': {
      const k = keyT(args[0]);
      const e = m.m.get(keyOf(k, false));
      if (!e) it.throwExc('out_of_range', 'map::at');
      return e[1];
    }
    case 'insert':
    case 'emplace':
    case 'try_emplace': {
      let k: V;
      let v: V;
      if (args.length === 2) {
        k = keyT(args[0]);
        v = it.evTo(m.vt, args[1]);
      } else {
        const p = it.evTo(T('pair', [m.kt ?? T('auto'), m.vt ?? T('auto')]), args[0]);
        if (!(p instanceof Pair)) throw new RtError('map::insert expects a pair {key, value}', line);
        k = p.first;
        v = p.second;
      }
      const kk = keyOf(k, false);
      const existed = m.m.has(kk);
      if (!existed) mapPut(it, m, k, v);
      return new Pair(new MIt(m, m.keys().indexOf(kk)), !existed);
    }
    case 'insert_or_assign': {
      mapPut(it, m, keyT(args[0]), it.evTo(m.vt, args[1]));
      return undefined;
    }
    case 'erase': {
      const x = ev(it, args[0]);
      if (x instanceof MIt) {
        const ks = m.keys();
        const phys = x.rev ? ks.length - 1 - x.i : x.i;
        if (phys < 0 || phys >= ks.length) throw new RtError('erasing end() (undefined behavior)', line);
        m.m.delete(ks[phys]);
        m.touch();
        return new MIt(m, x.i);
      }
      const had = m.m.delete(keyOf(it.coerce(m.kt, x), false));
      m.touch();
      return had ? 1 : 0;
    }
    case 'clear':
      m.m.clear();
      m.touch();
      return undefined;
    case 'begin':
    case 'cbegin':
      return new MIt(m, 0);
    case 'end':
    case 'cend':
      return new MIt(m, m.m.size);
    case 'rbegin':
      return new MIt(m, 0, true);
    case 'rend':
      return new MIt(m, m.m.size, true);
    case 'lower_bound':
    case 'upper_bound':
      return new MIt(m, boundIndex(it, m, keyT(args[0]), name === 'upper_bound'));
    case 'swap': {
      const o = ev(it, args[0]) as MapV;
      const t = m.m;
      m.m = o.m;
      o.m = t;
      m.touch();
      o.touch();
      return undefined;
    }
    case 'reserve':
    case 'max_load_factor':
      return undefined;
  }
  throw new RtError(`std::${m.kind} has no method '${name}' (or the tracer does not support it)`, line);
}

// --- C++ set / multiset / unordered_set ---
function cppSet(it: Interp, s: SetV, name: string, args: Args, line: number): V {
  const elem = (e: Expr) => it.evTo(s.et, e);
  switch (name) {
    case 'size':
      return s.size;
    case 'empty':
      return s.m.size === 0;
    case 'insert':
    case 'emplace': {
      if (args.length === 2) {
        for (const x of readRange(it, ev(it, args[0]), ev(it, args[1]))) setAdd(it, s, it.coerce(s.et, x));
        return undefined;
      }
      const x = elem(args[0]);
      const added = setAdd(it, s, x);
      return new Pair(new MIt(s, keyIndex(it, s, x)), added);
    }
    case 'count':
      return s.m.get(keyOf(elem(args[0]), false))?.[1] ?? 0;
    case 'contains':
      return s.m.has(keyOf(elem(args[0]), false));
    case 'find': {
      const i = keyIndex(it, s, elem(args[0]));
      return new MIt(s, i < 0 ? s.m.size : i);
    }
    case 'erase': {
      const x = ev(it, args[0]);
      if (x instanceof MIt) {
        const ks = s.keys();
        const phys = x.rev ? ks.length - 1 - x.i : x.i;
        if (phys < 0 || phys >= ks.length) throw new RtError('erasing end() (undefined behavior)', line);
        setRemove(it, s, s.m.get(ks[phys])![0], false);
        return new MIt(s, x.i);
      }
      return setRemove(it, s, it.coerce(s.et, x));
    }
    case 'clear':
      s.m.clear();
      s.touch();
      return undefined;
    case 'begin':
    case 'cbegin':
      return new MIt(s, 0);
    case 'end':
    case 'cend':
      return new MIt(s, s.m.size);
    case 'rbegin':
      return new MIt(s, 0, true);
    case 'rend':
      return new MIt(s, s.m.size, true);
    case 'lower_bound':
    case 'upper_bound':
      return new MIt(s, boundIndex(it, s, elem(args[0]), name === 'upper_bound'));
    case 'reserve':
      return undefined;
  }
  throw new RtError(`std::${s.kind} has no method '${name}' (or the tracer does not support it)`, line);
}

function pqMethod(it: Interp, q: PQ, name: string, args: Args, line: number): V {
  const java = it.java;
  switch (name) {
    case 'push':
    case 'emplace':
    case 'offer':
    case 'add':
      q.push(args.length === 1 ? it.evTo(q.et, args[0]) : it.construct(q.et!, args, line));
      return java ? true : undefined;
    case 'pop':
      if (!q.a.length) emptyErr(it, 'priority_queue::pop()');
      q.pop();
      return undefined;
    case 'poll':
      return q.a.length ? q.pop() : null;
    case 'remove':
      if (args.length) {
        const x = ev(it, args[0]);
        const i = q.a.findIndex((y) => eqVal(x, y));
        if (i < 0) return false;
        const rest = q.a.filter((_, j) => j !== i);
        q.a = [];
        rest.forEach((y) => q.push(y));
        return true;
      }
      if (!q.a.length) emptyErr(it, 'remove()');
      return q.pop();
    case 'top':
    case 'element':
      if (!q.a.length) emptyErr(it, 'priority_queue::top()');
      return q.a[0];
    case 'peek':
      return q.a.length ? q.a[0] : null;
    case 'size':
      return q.a.length;
    case 'empty':
    case 'isEmpty':
      return q.a.length === 0;
    case 'clear':
      q.a = [];
      return undefined;
    case 'contains': {
      const x = ev(it, args[0]);
      return q.a.some((y) => eqVal(x, y));
    }
    case 'toString':
      return it.javaStr(q);
    case 'iterator':
      return new JIter([...q.a]);
    case 'addAll': {
      const src = ev(it, args[0]);
      for (const x of collValues(it, src)) q.push(x);
      return true;
    }
  }
  throw new RtError(`priority queue has no method '${name}'`, line);
}

// ---------- streams ----------
function streamMethod(it: Interp, st: Stream, name: string, args: Args, line: number): V {
  switch (st.kind) {
    case 'cin':
      switch (name) {
        case 'tie': case 'sync_with_stdio': case 'exceptions': return 0;
        case 'fail': case 'bad': return st.fail;
        case 'good': return !st.fail;
        case 'eof':
          it.skipWs();
          return st.fail || it.inPos >= it.opts.stdin.length;
        case 'clear': st.fail = false; return undefined;
        case 'ignore': {
          const n = args[0] ? toInt(ev(it, args[0])) : 1;
          const delim = args[1] ? charStr(ev(it, args[1]) as Chr) : null;
          for (let i = 0; i < Math.min(n, 1 << 30) && it.inPos < it.opts.stdin.length; i++) {
            const c = it.opts.stdin[it.inPos++];
            if (delim !== null && c === delim) break;
          }
          return st;
        }
        case 'get': {
          if (args.length) {
            const b = it.lv(args[0]);
            if (it.inPos >= it.opts.stdin.length) {
              st.fail = true;
              return st;
            }
            b.set(new Chr(it.opts.stdin.charCodeAt(it.inPos++)));
            return st;
          }
          return it.inPos < it.opts.stdin.length ? it.opts.stdin.charCodeAt(it.inPos++) : -1;
        }
        case 'peek':
          return it.inPos < it.opts.stdin.length ? it.opts.stdin.charCodeAt(it.inPos) : -1;
        case 'getline': {
          const b = it.lv(args[0]);
          const l = it.readLine();
          if (l === null) st.fail = true;
          b.set(l ?? '');
          return st;
        }
      }
      break;
    case 'cout':
    case 'cerr':
      switch (name) {
        case 'tie': case 'sync_with_stdio': case 'flush': case 'setf': case 'unsetf': return st;
        case 'precision':
          if (args.length) st.precision = toInt(ev(it, args[0]));
          return st.precision;
        case 'put': {
          const v = ev(it, args[0]);
          it.out(v instanceof Chr ? charStr(v) : String.fromCharCode(toInt(v)));
          return st;
        }
        case 'write':
          it.out(String(ev(it, args[0])));
          return st;
      }
      break;
    case 'sysout':
    case 'writer':
      switch (name) {
        case 'println':
        case 'print': {
          let s = '';
          if (args.length) {
            const v = ev(it, args[0]);
            s = v instanceof Vec && v.kind === 'array' && v.et?.name === 'char' && !v.et.arr ? v.a.map((c) => charStr(c as Chr)).join('') : it.javaStr(v);
          }
          it.out(name === 'println' ? `${s}\n` : s);
          return undefined;
        }
        case 'printf':
        case 'format': {
          const vals = evs(it, args);
          it.out(sprintf(it, String(vals[0]), vals.slice(1), true));
          return st;
        }
        case 'write': {
          const v = ev(it, args[0]);
          it.out(typeof v === 'number' ? String.fromCharCode(v) : it.javaStr(v));
          return undefined;
        }
        case 'newLine':
          it.out('\n');
          return undefined;
        case 'flush':
        case 'close':
          return undefined;
        case 'append':
          it.out(it.javaStr(ev(it, args[0])));
          return st;
      }
      break;
    case 'scanner':
      return scannerMethod(it, st, name, args, line);
    case 'reader':
      switch (name) {
        case 'readLine':
          return it.readLine();
        case 'read':
          return it.inPos < it.opts.stdin.length ? it.opts.stdin.charCodeAt(it.inPos++) : -1;
        case 'ready':
          return it.inPos < it.opts.stdin.length;
        case 'close':
          return undefined;
        case 'lines':
          throw new RtError('BufferedReader.lines() streams are not supported — read with readLine() in a loop', line);
      }
      break;
  }
  throw new RtError(`${st.kind === 'sysout' ? 'System.out' : st.kind} has no method '${name}' (or the tracer does not support it)`, line);
}

function scannerMethod(it: Interp, _st: Stream, name: string, _args: Args, line: number): V {
  const tok = () => {
    const t = it.readToken();
    if (t === null) it.throwExc('NoSuchElementException', '');
    return t;
  };
  const intTok = (re: RegExp) => {
    const save = it.inPos;
    const t = tok();
    if (!re.test(t)) {
      it.inPos = save;
      it.throwExc('InputMismatchException', `For input string: "${t}"`);
    }
    return t;
  };
  switch (name) {
    case 'nextInt': {
      const t = intTok(/^[+-]?\d+$/);
      const n = Number(t);
      if (n > 2147483647 || n < -2147483648) it.throwExc('InputMismatchException', `For input string: "${t}"`);
      return n;
    }
    case 'nextLong':
      return BigInt(intTok(/^[+-]?\d+$/));
    case 'nextDouble':
    case 'nextFloat':
      return new Dbl(parseFloat(intTok(/^[+-]?(\d+\.?\d*|\.\d+)([eE][+-]?\d+)?$/)));
    case 'nextBoolean':
      return tok().toLowerCase() === 'true';
    case 'next':
      return tok();
    case 'nextLine': {
      const l = it.readLine();
      if (l === null) it.throwExc('NoSuchElementException', 'No line found');
      return l;
    }
    case 'hasNext':
      return it.peekToken() !== null;
    case 'hasNextInt':
    case 'hasNextLong': {
      const t = it.peekToken();
      return t !== null && /^[+-]?\d+$/.test(t);
    }
    case 'hasNextDouble': {
      const t = it.peekToken();
      return t !== null && !Number.isNaN(parseFloat(t));
    }
    case 'hasNextLine':
      return it.inPos < it.opts.stdin.length;
    case 'close':
      return undefined;
  }
  throw new RtError(`Scanner has no method '${name}' (or the tracer does not support it)`, line);
}

// ---------- Java ----------
function javaString(it: Interp, s: string, name: string, args: Args, line: number): V {
  const vals = () => evs(it, args);
  const str = (v: V) => (v instanceof Chr ? charStr(v) : it.javaStr(v));
  switch (name) {
    case 'length': return s.length;
    case 'charAt': {
      const i = toInt(ev(it, args[0]));
      if (i < 0 || i >= s.length) it.throwExc('StringIndexOutOfBoundsException', `Index ${i} out of bounds for length ${s.length}`);
      return new Chr(s.charCodeAt(i));
    }
    case 'isEmpty': return s.length === 0;
    case 'isBlank': return s.trim().length === 0;
    case 'substring':
    case 'subSequence': {
      const [a, b] = vals().map(toInt);
      const end = b === undefined ? s.length : b;
      if (a < 0 || end > s.length || a > end) it.throwExc('StringIndexOutOfBoundsException', `begin ${a}, end ${end}, length ${s.length}`);
      return s.slice(a, end);
    }
    case 'indexOf':
    case 'lastIndexOf': {
      const [x, from] = vals();
      const t = str(x);
      return name === 'indexOf' ? s.indexOf(t, from === undefined ? 0 : toInt(from)) : s.lastIndexOf(t, from === undefined ? Infinity : toInt(from));
    }
    case 'contains': return s.includes(str(ev(it, args[0])));
    case 'startsWith': return s.startsWith(str(ev(it, args[0])), args[1] ? toInt(ev(it, args[1])) : 0);
    case 'endsWith': return s.endsWith(str(ev(it, args[0])));
    case 'equals': return ev(it, args[0]) === s;
    case 'equalsIgnoreCase': {
      const o = ev(it, args[0]);
      return typeof o === 'string' && o.toLowerCase() === s.toLowerCase();
    }
    case 'compareTo':
    case 'compareToIgnoreCase': {
      let a = s;
      let b = String(ev(it, args[0]));
      if (name === 'compareToIgnoreCase') {
        a = a.toLowerCase();
        b = b.toLowerCase();
      }
      for (let i = 0; i < Math.min(a.length, b.length); i++) if (a[i] !== b[i]) return a.charCodeAt(i) - b.charCodeAt(i);
      return a.length - b.length;
    }
    case 'toUpperCase': return s.toUpperCase();
    case 'toLowerCase': return s.toLowerCase();
    case 'trim': return s.replace(/^[\x00-\x20]+|[\x00-\x20]+$/g, '');
    case 'strip': return s.trim();
    case 'toCharArray': return new Vec('array', [...s].map((c) => new Chr(c.charCodeAt(0))), T('char'));
    case 'chars': throw new RtError('String.chars() streams are not supported — loop over toCharArray() instead', line);
    case 'split': {
      const [re, lim] = vals();
      const limit = lim === undefined ? 0 : toInt(lim);
      let parts = s.split(javaRegex(String(re)));
      if (limit > 0 && parts.length > limit) {
        // re-split keeping the remainder in the last part
        const r = javaRegex(String(re));
        const out: string[] = [];
        let rest = s;
        while (out.length < limit - 1) {
          const m = r.exec(rest);
          if (!m) break;
          out.push(rest.slice(0, m.index));
          rest = rest.slice(m.index + m[0].length);
          r.lastIndex = 0;
        }
        out.push(rest);
        parts = out;
      }
      if (parts.length > 1 && parts[0] === '' && s.length > 0 && javaRegex(String(re)).exec(s)?.index === 0 && javaRegex(String(re)).exec(s)?.[0].length) parts.shift();
      if (limit === 0) while (parts.length > 1 && parts[parts.length - 1] === '') parts.pop();
      if (limit === 0 && parts.length === 1 && parts[0] === '' && s === '') return new Vec('array', [''], T('string'));
      return new Vec('array', parts, T('string'));
    }
    case 'replace': {
      const [a, b] = vals();
      return s.split(str(a)).join(str(b));
    }
    case 'replaceAll':
    case 'replaceFirst': {
      const [a, b] = vals().map(String);
      const r = javaRegex(a, name === 'replaceAll');
      return s.replace(r, b.replace(/\$(\d)/g, '$$$1'));
    }
    case 'matches': return new RegExp(`^(?:${javaRegex(String(ev(it, args[0]))).source})$`).test(s);
    case 'repeat': return s.repeat(Math.max(0, toInt(ev(it, args[0]))));
    case 'concat': return s + String(ev(it, args[0]));
    case 'hashCode': {
      let h = 0;
      for (let i = 0; i < s.length; i++) h = (Math.imul(31, h) + s.charCodeAt(i)) | 0;
      return h;
    }
    case 'toString':
    case 'intern':
    case 'strip_':
      return s;
    case 'codePointAt':
      return s.charCodeAt(toInt(ev(it, args[0])));
  }
  throw new RtError(`String has no method '${name}' (or the tracer does not support it)`, line);
}

function javaRegex(src: string, global = false): RegExp {
  return new RegExp(src.replace(/\\p\{Alpha\}/g, '[A-Za-z]').replace(/\\p\{Punct\}/g, '[!-/:-@[-`{-~]'), global ? 'g' : '');
}

function collValues(it: Interp, v: V): V[] {
  if (v instanceof Vec) return [...v.a];
  if (v instanceof SetV) return v.values();
  if (v instanceof PQ) return [...v.a];
  if (v instanceof MapV) return v.keys().map((k) => mapEntry(v, k, it));
  if (v === null) it.nullError('read a null collection');
  throw new RtError(`expected a collection but got a ${describe(v)}`, it.line);
}

function checkIndex(it: Interp, i: number, n: number, kind: string) {
  if (i < 0 || i >= n || !Number.isInteger(i)) it.indexError(i, n, kind);
}

function javaList(it: Interp, v: Vec, name: string, args: Args, line: number): V {
  const a = v.a;
  const k = v.kind;
  const vals = () => evs(it, args);
  const isDeque = k === 'ArrayDeque' || k === 'LinkedList';
  if (k === 'array') {
    if (name === 'clone') return new Vec('array', [...a], v.et);
    if (name === 'equals') return ev(it, args[0]) === v;
    if (name === 'length') throw new RtError('arrays use .length (a field), not .length()', line);
    throw new RtError(`arrays have no method '${name}' — use the Arrays class (Arrays.sort, Arrays.fill, …)`, line);
  }
  switch (name) {
    case 'size': return a.length;
    case 'isEmpty': return a.length === 0;
    case 'empty': return a.length === 0;
    case 'add':
    case 'addLast':
    case 'offer':
    case 'offerLast': {
      if (args.length === 2) {
        const [i, x] = vals();
        const idx = toInt(i);
        if (idx < 0 || idx > a.length) it.indexError(idx, a.length, 'list');
        a.splice(idx, 0, x);
        return undefined;
      }
      a.push(ev(it, args[0]));
      return name === 'addLast' ? undefined : true;
    }
    case 'push':
      if (k === 'Stack') {
        const x = ev(it, args[0]);
        a.push(x);
        return x;
      }
      a.unshift(ev(it, args[0]));
      return undefined;
    case 'addFirst':
    case 'offerFirst':
      a.unshift(ev(it, args[0]));
      return name === 'offerFirst' ? true : undefined;
    case 'get': {
      const i = toInt(ev(it, args[0]));
      checkIndex(it, i, a.length, 'list');
      return a[i];
    }
    case 'set': {
      const [i, x] = vals();
      const idx = toInt(i);
      checkIndex(it, idx, a.length, 'list');
      const old = a[idx];
      a[idx] = x;
      return old;
    }
    case 'remove': {
      if (!args.length) {
        if (!a.length) it.throwExc('NoSuchElementException', '');
        return a.shift();
      }
      const arg = args[0];
      const x = ev(it, arg);
      // List.remove(int index) vs remove(Object): a plain int argument means an index
      const byObject = typeof x !== 'number' || (arg.k === 'cast' && arg.ty.orig === 'Integer') || (arg.k === 'call' && arg.fn.k === 'member' && arg.fn.name === 'valueOf') || isDeque;
      if (!byObject) {
        checkIndex(it, x as number, a.length, 'list');
        return a.splice(x as number, 1)[0];
      }
      const i = a.findIndex((y) => eqVal(y, x));
      if (i < 0) return false;
      a.splice(i, 1);
      return true;
    }
    case 'pop':
      if (!a.length) it.throwExc(k === 'Stack' ? 'EmptyStackException' : 'NoSuchElementException', '');
      return k === 'Stack' ? a.pop() : a.shift();
    case 'poll':
    case 'pollFirst':
      return a.length ? a.shift() : null;
    case 'pollLast':
      return a.length ? a.pop() : null;
    case 'removeFirst':
      if (!a.length) it.throwExc('NoSuchElementException', '');
      return a.shift();
    case 'removeLast':
      if (!a.length) it.throwExc('NoSuchElementException', '');
      return a.pop();
    case 'peek':
      if (k === 'Stack') {
        if (!a.length) it.throwExc('EmptyStackException', '');
        return a[a.length - 1];
      }
      return a.length ? a[0] : null;
    case 'peekFirst':
      return a.length ? a[0] : null;
    case 'peekLast':
      return a.length ? a[a.length - 1] : null;
    case 'element':
    case 'getFirst':
    case 'firstElement':
      if (!a.length) it.throwExc('NoSuchElementException', '');
      return a[0];
    case 'getLast':
    case 'lastElement':
      if (!a.length) it.throwExc('NoSuchElementException', '');
      return a[a.length - 1];
    case 'contains': {
      const x = ev(it, args[0]);
      return a.some((y) => eqVal(y, x));
    }
    case 'indexOf':
    case 'lastIndexOf': {
      const x = ev(it, args[0]);
      return name === 'indexOf' ? a.findIndex((y) => eqVal(y, x)) : a.map((y) => eqVal(y, x)).lastIndexOf(true);
    }
    case 'search': {
      const x = ev(it, args[0]);
      const i = a.map((y) => eqVal(y, x)).lastIndexOf(true);
      return i < 0 ? -1 : a.length - i;
    }
    case 'clear':
      a.length = 0;
      return undefined;
    case 'addAll': {
      const vs = vals();
      if (vs.length === 2) {
        a.splice(toInt(vs[0]), 0, ...collValues(it, vs[1]));
        return true;
      }
      a.push(...collValues(it, vs[0]));
      return true;
    }
    case 'removeAll': {
      const rm = collValues(it, ev(it, args[0]));
      v.a = a.filter((x) => !rm.some((y) => eqVal(x, y)));
      return true;
    }
    case 'retainAll': {
      const keep = collValues(it, ev(it, args[0]));
      v.a = a.filter((x) => keep.some((y) => eqVal(x, y)));
      return true;
    }
    case 'removeIf': {
      const p = ev(it, args[0]);
      const before = a.length;
      v.a = a.filter((x) => !it.truthy(it.callValue(p, [x], line)));
      return v.a.length !== before;
    }
    case 'sort':
      a.sort(it.sorter(args.length ? ev(it, args[0]) : undefined));
      return undefined;
    case 'forEach': {
      const f = ev(it, args[0]);
      for (const x of [...a]) it.callValue(f, [x], line);
      return undefined;
    }
    case 'replaceAll': {
      const f = ev(it, args[0]);
      for (let i = 0; i < a.length; i++) a[i] = it.callValue(f, [a[i]], line);
      return undefined;
    }
    case 'iterator':
    case 'listIterator':
      return new JIter([...a], (x) => {
        const i = v.a.indexOf(x);
        if (i >= 0) v.a.splice(i, 1);
      });
    case 'descendingIterator':
      return new JIter([...a].reverse());
    case 'subList': {
      const [x, y] = vals().map(toInt);
      return new Vec('ArrayList', a.slice(x, y), v.et);
    }
    case 'toArray':
      return new Vec('array', [...a], v.et);
    case 'equals': {
      const o = ev(it, args[0]);
      return o instanceof Vec && eqVal(o, v);
    }
    case 'hashCode':
      return v.id;
    case 'toString':
      return it.javaStr(v);
    case 'reversed':
      return new Vec(k, [...a].reverse(), v.et);
    case 'stream':
      throw new RtError('streams are not supported by the tracer — use a for loop', line);
  }
  throw new RtError(`${k} has no method '${name}' (or the tracer does not support it)`, line);
}

function javaMap(it: Interp, m: MapV, name: string, args: Args, line: number): V {
  const vals = () => evs(it, args);
  switch (name) {
    case 'put': {
      const [k, v] = vals();
      if (k === null && m.sorted) it.nullError('use a null key in a TreeMap');
      return mapPut(it, m, k, v);
    }
    case 'get': return mapGet(it, m, ev(it, args[0]));
    case 'getOrDefault': {
      const [k, d] = vals();
      const e = m.m.get(keyOf(k, true));
      return e ? e[1] : d;
    }
    case 'containsKey': return m.m.has(keyOf(ev(it, args[0]), true));
    case 'containsValue': {
      const x = ev(it, args[0]);
      return [...m.m.values()].some(([, v]) => eqVal(v, x));
    }
    case 'remove': {
      const kk = keyOf(ev(it, args[0]), true);
      const e = m.m.get(kk);
      if (!e) return null;
      m.m.delete(kk);
      m.touch();
      return e[1];
    }
    case 'size': return m.m.size;
    case 'isEmpty': return m.m.size === 0;
    case 'clear':
      m.m.clear();
      m.touch();
      return undefined;
    case 'putIfAbsent': {
      const [k, v] = vals();
      const e = m.m.get(keyOf(k, true));
      if (e && e[1] !== null) return e[1];
      mapPut(it, m, k, v);
      return null;
    }
    case 'merge': {
      const [k, v, f] = vals();
      const e = m.m.get(keyOf(k, true));
      const nv = e && e[1] !== null ? it.callValue(f, [e[1], v], line) : v;
      if (nv === null) {
        m.m.delete(keyOf(k, true));
        m.touch();
      } else mapPut(it, m, k, nv, true, !e);
      return nv;
    }
    case 'computeIfAbsent': {
      const [k, f] = vals();
      const e = m.m.get(keyOf(k, true));
      if (e && e[1] !== null) return e[1];
      const nv = it.callValue(f, [k], line);
      if (nv !== null) mapPut(it, m, k, nv, true, true);
      return nv;
    }
    case 'computeIfPresent':
    case 'compute': {
      const [k, f] = vals();
      const e = m.m.get(keyOf(k, true));
      if (name === 'computeIfPresent' && (!e || e[1] === null)) return null;
      const nv = it.callValue(f, [k, e ? e[1] : null], line);
      if (nv === null) {
        m.m.delete(keyOf(k, true));
        m.touch();
      } else mapPut(it, m, k, nv, true, !e);
      return nv;
    }
    case 'keySet':
    case 'navigableKeySet': {
      const s = new SetV(m.sorted ? 'TreeSet' : m.kind === 'LinkedHashMap' ? 'LinkedHashSet' : 'keySet', false, m.kt);
      for (const k of m.keys()) s.m.set(k, [m.m.get(k)![0], 1]);
      return s;
    }
    case 'values':
      return new Vec('ArrayList', m.keys().map((k) => m.m.get(k)![1]), m.vt);
    case 'entrySet':
      return new Vec('entrySet', m.keys().map((k) => mapEntry(m, k, it)), null);
    case 'forEach': {
      const f = ev(it, args[0]);
      for (const k of [...m.keys()]) {
        const e = m.m.get(k);
        if (e) it.callValue(f, [e[0], e[1]], line);
      }
      return undefined;
    }
    case 'putAll': {
      const o = ev(it, args[0]) as MapV;
      for (const k of o.keys()) mapPut(it, m, o.m.get(k)![0], o.m.get(k)![1]);
      return undefined;
    }
    case 'firstKey':
    case 'lastKey': {
      const ks = m.keys();
      if (!ks.length) it.throwExc('NoSuchElementException', '');
      return m.m.get(name === 'firstKey' ? ks[0] : ks[ks.length - 1])![0];
    }
    case 'firstEntry':
    case 'lastEntry':
    case 'pollFirstEntry':
    case 'pollLastEntry': {
      const ks = m.keys();
      if (!ks.length) return null;
      const k = name.includes('First') ? ks[0] : ks[ks.length - 1];
      const e = m.m.get(k)!;
      const p = new Pair(e[0], e[1]);
      if (name.startsWith('poll')) {
        m.m.delete(k);
        m.touch();
      }
      return p;
    }
    case 'floorKey': case 'ceilingKey': case 'lowerKey': case 'higherKey':
      return navKey(it, m, ev(it, args[0]), name.replace('Key', '') as 'floor');
    case 'floorEntry': case 'ceilingEntry': case 'lowerEntry': case 'higherEntry': {
      const k = navKey(it, m, ev(it, args[0]), name.replace('Entry', '') as 'floor');
      return k === null ? null : new Pair(k, mapGet(it, m, k));
    }
    case 'headMap':
    case 'tailMap': {
      const [x, incl] = vals();
      const out = new MapV(m.kind, m.sorted, m.kt, m.vt, m.cmp);
      const c = m.cmp ?? cmpVal;
      for (const k of m.keys()) {
        const [kk, vv] = m.m.get(k)!;
        const d = c(kk, x);
        if (name === 'headMap' ? d < 0 || (incl === true && d === 0) : d >= 0 && !(incl === false && d === 0)) out.m.set(k, [kk, vv]);
      }
      out.touch();
      return out;
    }
    case 'toString': return it.javaStr(m);
    case 'equals': return eqVal(m, ev(it, args[0]));
  }
  throw new RtError(`${m.kind} has no method '${name}' (or the tracer does not support it)`, line);
}

function javaSet(it: Interp, s: SetV, name: string, args: Args, line: number): V {
  switch (name) {
    case 'add': {
      const x = ev(it, args[0]);
      if (x === null && s.sorted) it.nullError('add null to a TreeSet');
      return setAdd(it, s, x);
    }
    case 'remove': return setRemove(it, s, ev(it, args[0])) > 0;
    case 'contains': return s.m.has(keyOf(ev(it, args[0]), true));
    case 'size': return s.m.size;
    case 'isEmpty': return s.m.size === 0;
    case 'clear':
      s.m.clear();
      s.touch();
      return undefined;
    case 'addAll': {
      let changed = false;
      for (const x of collValues(it, ev(it, args[0]))) changed = setAdd(it, s, x) || changed;
      return changed;
    }
    case 'removeAll': {
      let changed = false;
      for (const x of collValues(it, ev(it, args[0]))) changed = setRemove(it, s, x) > 0 || changed;
      return changed;
    }
    case 'retainAll': {
      const keep = new Set(collValues(it, ev(it, args[0])).map((x) => keyOf(x, true)));
      for (const k of [...s.m.keys()]) if (!keep.has(k)) s.m.delete(k);
      s.touch();
      return true;
    }
    case 'containsAll':
      return collValues(it, ev(it, args[0])).every((x) => s.m.has(keyOf(x, true)));
    case 'iterator':
      return new JIter(s.values(), (x) => setRemove(it, s, x));
    case 'first':
    case 'last': {
      const v = s.values();
      if (!v.length) it.throwExc('NoSuchElementException', '');
      return name === 'first' ? v[0] : v[v.length - 1];
    }
    case 'pollFirst':
    case 'pollLast': {
      const v = s.values();
      if (!v.length) return null;
      const x = name === 'pollFirst' ? v[0] : v[v.length - 1];
      setRemove(it, s, x);
      return x;
    }
    case 'floor': case 'ceiling': case 'lower': case 'higher':
      return navKey(it, s, ev(it, args[0]), name);
    case 'forEach': {
      const f = ev(it, args[0]);
      for (const x of s.values()) it.callValue(f, [x], line);
      return undefined;
    }
    case 'removeIf': {
      const p = ev(it, args[0]);
      let changed = false;
      for (const x of s.values()) if (it.truthy(it.callValue(p, [x], line))) changed = setRemove(it, s, x) > 0 || changed;
      return changed;
    }
    case 'toString': return it.javaStr(s);
    case 'equals': return eqVal(s, ev(it, args[0]));
    case 'stream': throw new RtError('streams are not supported by the tracer — use a for loop', line);
  }
  throw new RtError(`${s.kind} has no method '${name}' (or the tracer does not support it)`, line);
}

function sbMethod(it: Interp, sb: SB, name: string, args: Args, line: number): V {
  const vals = () => evs(it, args);
  switch (name) {
    case 'append': {
      const v = ev(it, args[0]);
      sb.s += v instanceof Vec && v.et?.name === 'char' ? v.a.map((c) => charStr(c as Chr)).join('') : it.javaStr(v);
      return sb;
    }
    case 'toString': return sb.s;
    case 'length': return sb.s.length;
    case 'charAt': {
      const i = toInt(ev(it, args[0]));
      if (i < 0 || i >= sb.s.length) it.throwExc('StringIndexOutOfBoundsException', `index ${i},length ${sb.s.length}`);
      return new Chr(sb.s.charCodeAt(i));
    }
    case 'setCharAt': {
      const [i, c] = vals();
      const idx = toInt(i);
      if (idx < 0 || idx >= sb.s.length) it.throwExc('StringIndexOutOfBoundsException', `index ${idx},length ${sb.s.length}`);
      sb.s = sb.s.slice(0, idx) + charStr(c as Chr) + sb.s.slice(idx + 1);
      return undefined;
    }
    case 'insert': {
      const [i, x] = vals();
      const idx = toInt(i);
      sb.s = sb.s.slice(0, idx) + it.javaStr(x) + sb.s.slice(idx);
      return sb;
    }
    case 'deleteCharAt': {
      const i = toInt(ev(it, args[0]));
      if (i < 0 || i >= sb.s.length) it.throwExc('StringIndexOutOfBoundsException', `index ${i},length ${sb.s.length}`);
      sb.s = sb.s.slice(0, i) + sb.s.slice(i + 1);
      return sb;
    }
    case 'delete': {
      const [a, b] = vals().map(toInt);
      sb.s = sb.s.slice(0, a) + sb.s.slice(Math.min(b, sb.s.length));
      return sb;
    }
    case 'replace': {
      const [a, b, t] = vals();
      sb.s = sb.s.slice(0, toInt(a)) + String(t) + sb.s.slice(Math.min(toInt(b), sb.s.length));
      return sb;
    }
    case 'reverse':
      sb.s = [...sb.s].reverse().join('');
      return sb;
    case 'setLength': {
      const n = toInt(ev(it, args[0]));
      sb.s = n <= sb.s.length ? sb.s.slice(0, n) : sb.s + '\0'.repeat(n - sb.s.length);
      return undefined;
    }
    case 'indexOf': return sb.s.indexOf(String(ev(it, args[0])));
    case 'lastIndexOf': return sb.s.lastIndexOf(String(ev(it, args[0])));
    case 'isEmpty': return sb.s.length === 0;
    case 'substring': {
      const [a, b] = vals().map(toInt);
      return sb.s.slice(a, b);
    }
    case 'equals': return ev(it, args[0]) === sb;
    case 'compareTo': {
      const o = ev(it, args[0]) as SB;
      return sb.s < o.s ? -1 : sb.s > o.s ? 1 : 0;
    }
  }
  throw new RtError(`StringBuilder has no method '${name}' (or the tracer does not support it)`, line);
}

function javaBoxed(it: Interp, v: V, name: string, args: Args, line: number): V {
  switch (name) {
    case 'intValue': return toInt(v);
    case 'longValue': return toBig(v);
    case 'doubleValue': return new Dbl(toNumber(v));
    case 'charValue': case 'booleanValue': return v;
    case 'equals': {
      const o = ev(it, args[0]);
      return isNum(o) && typeof o === typeof v && cmpVal(v, o) === 0;
    }
    case 'compareTo': return cmpVal(v, ev(it, args[0]));
    case 'hashCode': return toInt(v);
    case 'toString': return it.javaStr(v);
  }
  throw new RtError(`${describe(v)} has no method '${name}'`, line);
}

// ---------- Java static classes ----------
export function staticField(it: Interp, cls: string, name: string, line: number): V {
  const key = `${cls}.${name}`;
  switch (key) {
    case 'Integer.MAX_VALUE': return 2147483647;
    case 'Integer.MIN_VALUE': return -2147483648;
    case 'Long.MAX_VALUE': return 9223372036854775807n;
    case 'Long.MIN_VALUE': return -9223372036854775808n;
    case 'Short.MAX_VALUE': return 32767;
    case 'Short.MIN_VALUE': return -32768;
    case 'Byte.MAX_VALUE': return 127;
    case 'Byte.MIN_VALUE': return -128;
    case 'Double.MAX_VALUE': return new Dbl(Number.MAX_VALUE);
    case 'Double.MIN_VALUE': return new Dbl(Number.MIN_VALUE);
    case 'Double.POSITIVE_INFINITY': return new Dbl(Infinity);
    case 'Double.NEGATIVE_INFINITY': return new Dbl(-Infinity);
    case 'Double.NaN': return new Dbl(NaN);
    case 'Float.MAX_VALUE': return new Dbl(3.4028234663852886e38);
    case 'Character.MAX_VALUE': return new Chr(0xffff);
    case 'Character.MIN_VALUE': return new Chr(0);
    case 'Math.PI': return new Dbl(Math.PI);
    case 'Math.E': return new Dbl(Math.E);
    case 'Boolean.TRUE': return true;
    case 'Boolean.FALSE': return false;
    case 'System.out': return sysout(it);
    case 'System.err': return sysout(it);
    case 'System.in': return new Stream('system');
  }
  throw new RtError(`unknown static field ${key}`, line);
}

let SYSOUT: Stream | null = null;
function sysout(it: Interp): Stream {
  void it;
  if (!SYSOUT) SYSOUT = new Stream('sysout');
  return SYSOUT;
}

function parseIntJ(it: Interp, s: V, radix: number, long: boolean): V {
  const str = String(s);
  const ok = radix === 10 ? /^[+-]?\d+$/ : radix === 16 ? /^[+-]?[0-9a-fA-F]+$/ : radix === 2 ? /^[+-]?[01]+$/ : /^[+-]?[0-9a-zA-Z]+$/;
  if (s === null || !ok.test(str)) it.throwExc('NumberFormatException', s === null ? 'Cannot parse null string: null' : `For input string: "${str}"${radix !== 10 ? ` under radix ${radix}` : ''}`);
  const neg = str.startsWith('-');
  const digits = str.replace(/^[+-]/, '');
  let big = 0n;
  for (const c of digits.toLowerCase()) big = big * BigInt(radix) + BigInt(parseInt(c, radix));
  if (neg) big = -big;
  if (long) {
    if (big > 9223372036854775807n || big < -9223372036854775808n) it.throwExc('NumberFormatException', `For input string: "${str}"`);
    return big;
  }
  if (big > 2147483647n || big < -2147483648n) it.throwExc('NumberFormatException', `For input string: "${str}"`);
  return Number(big);
}

export function callStatic(it: Interp, cls: string, name: string, args: Args, line: number): V {
  const vals = () => evs(it, args);
  const v0 = () => ev(it, args[0]);
  if (!it.java) {
    if (name === 'sync_with_stdio') return true;
    return callBuiltinFn(it, name, args, line, { k: 'id', line, name });
  }
  switch (cls) {
    case 'Math':
    case 'StrictMath':
      switch (name) {
        case 'max':
        case 'min': {
          const [a, b] = vals();
          const pick = cmpVal(a, b) >= 0 === (name === 'max') ? a : b;
          // numeric promotion: max(int, long) is a long, max(int, double) is a double
          if (a instanceof Dbl || b instanceof Dbl) return new Dbl(toNumber(pick));
          if (typeof a === 'bigint' || typeof b === 'bigint') return toBig(pick);
          return pick instanceof Chr ? pick.c : pick;
        }
        case 'abs': {
          const a = v0();
          if (typeof a === 'bigint') return a < 0n ? BigInt.asIntN(64, -a) : a;
          if (a instanceof Dbl) return new Dbl(Math.abs(a.v));
          return Math.abs(toNumber(a)) | 0;
        }
        case 'pow': return mathD(it, args, Math.pow);
        case 'sqrt': return mathD(it, args, Math.sqrt);
        case 'cbrt': return mathD(it, args, Math.cbrt);
        case 'floor': return mathD(it, args, Math.floor);
        case 'ceil': return mathD(it, args, Math.ceil);
        case 'rint': return mathD(it, args, (x) => (Math.abs(x % 1) === 0.5 ? 2 * Math.round(x / 2) : Math.round(x)));
        case 'log': return mathD(it, args, Math.log);
        case 'log10': return mathD(it, args, Math.log10);
        case 'exp': return mathD(it, args, Math.exp);
        case 'sin': return mathD(it, args, Math.sin);
        case 'cos': return mathD(it, args, Math.cos);
        case 'tan': return mathD(it, args, Math.tan);
        case 'atan': return mathD(it, args, Math.atan);
        case 'atan2': return mathD(it, args, Math.atan2);
        case 'hypot': return mathD(it, args, Math.hypot);
        case 'toRadians': return mathD(it, args, (x) => (x * Math.PI) / 180);
        case 'toDegrees': return mathD(it, args, (x) => (x * 180) / Math.PI);
        case 'signum': return mathD(it, args, Math.sign);
        case 'random': return new Dbl(it.rand() / 0x80000000);
        case 'round': {
          const a = v0();
          const r = Math.floor(toNumber(a) + 0.5);
          return a instanceof Dbl ? BigInt(r) : r;
        }
        case 'floorDiv':
        case 'floorMod': {
          const [a, b] = vals();
          if (typeof a === 'bigint' || typeof b === 'bigint') {
            const x = toBig(a);
            const y = toBig(b);
            if (y === 0n) it.throwExc('ArithmeticException', '/ by zero');
            let q = x / y;
            if ((x % y !== 0n) && ((x < 0n) !== (y < 0n))) q -= 1n;
            return name === 'floorDiv' ? q : x - q * y;
          }
          const x = toNumber(a);
          const y = toNumber(b);
          if (y === 0) it.throwExc('ArithmeticException', '/ by zero');
          const q = Math.floor(x / y);
          return name === 'floorDiv' ? q | 0 : (x - q * y) | 0;
        }
        case 'addExact':
        case 'multiplyExact':
        case 'subtractExact': {
          const [a, b] = vals();
          const big = name === 'addExact' ? toBig(a) + toBig(b) : name === 'subtractExact' ? toBig(a) - toBig(b) : toBig(a) * toBig(b);
          const long = typeof a === 'bigint' || typeof b === 'bigint';
          if (long ? big !== BigInt.asIntN(64, big) : big > 2147483647n || big < -2147483648n) it.throwExc('ArithmeticException', `${long ? 'long' : 'integer'} overflow`);
          return long ? big : Number(big);
        }
      }
      break;
    case 'Integer':
    case 'Long':
    case 'Short':
    case 'Byte': {
      const long = cls === 'Long';
      switch (name) {
        case 'parseInt':
        case 'parseLong':
        case 'valueOf':
        case 'parseShort':
        case 'parseByte': {
          const [s, r] = vals();
          if (name === 'valueOf' && isNum(s)) return long ? toBig(s) : toInt(s);
          return parseIntJ(it, s, r === undefined ? 10 : toInt(r), long);
        }
        case 'toString': {
          const [x, r] = vals();
          return r === undefined ? String(x) : (typeof x === 'bigint' ? x : BigInt(toInt(x))).toString(toInt(r));
        }
        case 'toBinaryString':
        case 'toHexString':
        case 'toOctalString': {
          const x = v0();
          const u = long || typeof x === 'bigint' ? BigInt.asUintN(64, toBig(x)) : BigInt(toInt(x) >>> 0);
          return u.toString(name === 'toBinaryString' ? 2 : name === 'toHexString' ? 16 : 8);
        }
        case 'bitCount': {
          let u = long ? BigInt.asUintN(64, toBig(v0())) : BigInt(toInt(v0()) >>> 0);
          let c = 0;
          while (u) {
            c += Number(u & 1n);
            u >>= 1n;
          }
          return c;
        }
        case 'compare': {
          const [a, b] = vals();
          return cmpVal(a, b);
        }
        case 'max':
        case 'min': {
          const [a, b] = vals();
          return (cmpVal(a, b) >= 0) === (name === 'max') ? a : b;
        }
        case 'sum': {
          const [a, b] = vals();
          return it.binop('+', a, b, line);
        }
        case 'signum': return Math.sign(toNumber(v0()));
        case 'abs': return Math.abs(toNumber(v0()));
        case 'highestOneBit': {
          const x = toInt(v0());
          return x === 0 ? 0 : (1 << (31 - Math.clz32(x))) | 0;
        }
        case 'numberOfTrailingZeros': {
          const x = toInt(v0());
          return x === 0 ? 32 : 31 - Math.clz32(x & -x);
        }
        case 'numberOfLeadingZeros': return Math.clz32(toInt(v0()));
        case 'reverse': {
          let x = toInt(v0()) >>> 0;
          let r = 0;
          for (let i = 0; i < 32; i++) {
            r = (r << 1) | (x & 1);
            x >>>= 1;
          }
          return r | 0;
        }
      }
      break;
    }
    case 'Double':
    case 'Float':
      switch (name) {
        case 'parseDouble':
        case 'valueOf':
        case 'parseFloat': {
          const s = v0();
          if (isNum(s)) return new Dbl(toNumber(s));
          const x = Number(String(s).trim());
          if (Number.isNaN(x) && String(s).trim() !== 'NaN') it.throwExc('NumberFormatException', `For input string: "${s}"`);
          return new Dbl(x);
        }
        case 'compare': {
          const [a, b] = vals();
          return cmpVal(a, b);
        }
        case 'isNaN': return Number.isNaN(toNumber(v0()));
        case 'isInfinite': return !Number.isFinite(toNumber(v0())) && !Number.isNaN(toNumber(v0()));
        case 'toString': return javaDouble(toNumber(v0()));
        case 'max': case 'min': return mathD(it, args, name === 'max' ? Math.max : Math.min);
        case 'sum': return mathD(it, args, (a, b) => a + b);
      }
      break;
    case 'Character': {
      const c = () => {
        const v = v0();
        return String.fromCharCode(v instanceof Chr ? v.c : toInt(v));
      };
      switch (name) {
        case 'isDigit': return /[0-9]/.test(c());
        case 'isLetter': return /\p{L}/u.test(c());
        case 'isLetterOrDigit': return /[\p{L}0-9]/u.test(c());
        case 'isAlphabetic': return /\p{L}/u.test(c());
        case 'isUpperCase': return /\p{Lu}/u.test(c());
        case 'isLowerCase': return /\p{Ll}/u.test(c());
        case 'isWhitespace':
        case 'isSpaceChar': return /\s/.test(c());
        case 'toUpperCase': {
          const v = v0();
          const r = c().toUpperCase().charCodeAt(0);
          return v instanceof Chr ? new Chr(r) : r;
        }
        case 'toLowerCase': {
          const v = v0();
          const r = c().toLowerCase().charCodeAt(0);
          return v instanceof Chr ? new Chr(r) : r;
        }
        case 'getNumericValue': {
          const ch = c();
          return /[0-9]/.test(ch) ? Number(ch) : /[a-z]/i.test(ch) ? ch.toLowerCase().charCodeAt(0) - 87 : -1;
        }
        case 'valueOf': return v0();
        case 'toString': return c();
        case 'compare': {
          const [a, b] = vals();
          return toNumber(a) - toNumber(b);
        }
        case 'isDefined': return true;
        case 'toChars': return new Vec('array', [new Chr(toInt(v0()))], T('char'));
        case 'forDigit': {
          const [d, r] = vals().map(toInt);
          return new Chr(d.toString(r).charCodeAt(0));
        }
      }
      break;
    }
    case 'Boolean':
      if (name === 'parseBoolean' || name === 'valueOf') {
        const v = v0();
        return typeof v === 'boolean' ? v : String(v).toLowerCase() === 'true';
      }
      if (name === 'toString') return String(v0());
      if (name === 'compare') {
        const [a, b] = vals();
        return Number(a) - Number(b);
      }
      break;
    case 'String':
      switch (name) {
        case 'valueOf':
        case 'copyValueOf': {
          const v = v0();
          if (v instanceof Vec && v.et?.name === 'char') return v.a.map((c) => charStr(c as Chr)).join('');
          return it.javaStr(v);
        }
        case 'format': {
          const vs = vals();
          return sprintf(it, String(vs[0]), vs.slice(1), true);
        }
        case 'join': {
          const vs = vals();
          const items = vs.length === 2 && (vs[1] instanceof Vec || vs[1] instanceof SetV) ? collValues(it, vs[1]) : vs.slice(1);
          return items.map((x) => it.javaStr(x)).join(String(vs[0]));
        }
      }
      break;
    case 'Arrays':
      return arraysStatic(it, name, args, line);
    case 'Collections':
      return collectionsStatic(it, name, args, line);
    case 'List':
    case 'Set':
      if (name === 'of' || name === 'copyOf') {
        const items = name === 'copyOf' ? collValues(it, v0()) : vals();
        if (cls === 'List') return new Vec('ArrayList', items);
        const s = new SetV('HashSet', false);
        items.forEach((x) => setAdd(it, s, x));
        return s;
      }
      break;
    case 'Map':
      if (name === 'of') {
        const vs = vals();
        const m = new MapV('HashMap', false);
        for (let i = 0; i + 1 < vs.length; i += 2) mapPut(it, m, vs[i], vs[i + 1]);
        return m;
      }
      if (name === 'entry') {
        const [k, v] = vals();
        return new Pair(k, v);
      }
      break;
    case 'Objects':
      switch (name) {
        case 'equals': {
          const [a, b] = vals();
          return a === b || (a !== null && b !== null && (typeof a === 'string' || isNum(a) ? eqVal(a, b) : a === b));
        }
        case 'hash': return vals().reduce((h: number, x) => (Math.imul(31, h) + (isNum(x) ? toInt(x) : typeof x === 'string' ? x.length : 0)) | 0, 1);
        case 'isNull': return v0() === null;
        case 'nonNull': return v0() !== null;
        case 'requireNonNull': {
          const v = v0();
          if (v === null) it.throwExc('NullPointerException', '');
          return v;
        }
        case 'toString': return it.javaStr(v0());
      }
      break;
    case 'System':
      switch (name) {
        case 'exit': throw new ExitSignal(toInt(v0()));
        case 'currentTimeMillis': return BigInt(1_700_000_000_000 + it.clock++);
        case 'nanoTime': return BigInt(it.clock++ * 1000);
        case 'arraycopy': {
          const [src, sp, dst, dp, n] = vals();
          const s = src as Vec;
          const d = dst as Vec;
          const a = toInt(sp);
          const b = toInt(dp);
          const len = toInt(n);
          if (a < 0 || b < 0 || len < 0 || a + len > s.a.length || b + len > d.a.length) it.throwExc('ArrayIndexOutOfBoundsException', `arraycopy: last source index ${a + len} out of bounds for length ${s.a.length}`);
          const part = s.a.slice(a, a + len);
          for (let i = 0; i < len; i++) d.a[b + i] = part[i];
          return undefined;
        }
        case 'lineSeparator': return '\n';
        case 'identityHashCode': return (v0() as { id?: number })?.id ?? 0;
      }
      break;
    case 'Comparator':
      switch (name) {
        case 'naturalOrder': return new Native('naturalOrder', (a) => cmpVal(a[0], a[1]));
        case 'reverseOrder': return new Native('reverseOrder', (a) => cmpVal(a[1], a[0]));
        case 'comparing':
        case 'comparingInt':
        case 'comparingLong':
        case 'comparingDouble': {
          const [f, c] = vals();
          const cmp = c !== undefined ? it.sorter(c) : cmpVal;
          return new Native(name, (a) => cmp(it.callValue(f, [a[0]], line), it.callValue(f, [a[1]], line)));
        }
      }
      break;
    case 'Thread':
      if (name === 'sleep') return undefined;
      break;
  }
  throw new RtError(`${cls}.${name}() is not supported by the tracer`, line);
}

function arraysStatic(it: Interp, name: string, args: Args, line: number): V {
  const vals = evs(it, args);
  const arr = vals[0] as Vec;
  if (name !== 'asList' && (arr === null || arr === undefined)) it.nullError(`call Arrays.${name} on a null array`);
  switch (name) {
    case 'sort':
    case 'parallelSort': {
      let from = 0;
      let to = arr.a.length;
      let cmp: V | undefined;
      if (vals.length >= 3) {
        from = toInt(vals[1]);
        to = toInt(vals[2]);
        cmp = vals[3];
      } else cmp = vals[1];
      if (from < 0 || to > arr.a.length || from > to) it.throwExc('ArrayIndexOutOfBoundsException', `Array index out of range: ${to}`);
      if (cmp !== undefined && arr.et && !arr.et.arr && ['int', 'long', 'double', 'char', 'bool'].includes(arr.et.name) && !/^[A-Z]/.test(arr.et.orig ?? '')) {
        throw new RtError('Arrays.sort with a comparator needs an object array (Integer[], int[][], …), not a primitive array', line);
      }
      const part = arr.a.slice(from, to).sort(it.sorter(cmp ?? null));
      arr.a.splice(from, part.length, ...part);
      return undefined;
    }
    case 'fill': {
      if (vals.length === 4) {
        for (let i = toInt(vals[1]); i < toInt(vals[2]); i++) arr.a[i] = it.coerce(arr.et, vals[3]);
      } else for (let i = 0; i < arr.a.length; i++) arr.a[i] = it.coerce(arr.et, vals[1]);
      return undefined;
    }
    case 'toString':
      if (arr === null) return 'null';
      return `[${arr.a.map((x) => it.javaStr(x)).join(', ')}]`;
    case 'deepToString': {
      const deep = (v: V): string => (v instanceof Vec && v.kind === 'array' ? `[${v.a.map(deep).join(', ')}]` : it.javaStr(v));
      return deep(arr);
    }
    case 'asList':
      return new Vec('ArrayList', vals.length === 1 && vals[0] instanceof Vec && vals[0].kind === 'array' && !(vals[0].et && ['int', 'long', 'double', 'char', 'bool'].includes(vals[0].et.name) && !/^[A-Z]/.test(vals[0].et.orig ?? '')) ? [...vals[0].a] : vals);
    case 'copyOf': {
      const n = toInt(vals[1]);
      return new Vec('array', Array.from({ length: n }, (_, i) => (i < arr.a.length ? arr.a[i] : it.defaultVal(arr.et))), arr.et);
    }
    case 'copyOfRange': {
      const a = toInt(vals[1]);
      const b = toInt(vals[2]);
      if (a < 0 || a > arr.a.length) it.throwExc('ArrayIndexOutOfBoundsException', `${a}`);
      return new Vec('array', Array.from({ length: b - a }, (_, i) => (a + i < arr.a.length ? arr.a[a + i] : it.defaultVal(arr.et))), arr.et);
    }
    case 'equals': {
      const b = vals[1] as Vec;
      return arr.a.length === b.a.length && arr.a.every((x, i) => eqVal(x, b.a[i]));
    }
    case 'deepEquals':
      return eqVal(arr, vals[1]);
    case 'binarySearch': {
      const x = vals[vals.length - 1];
      const i = lowerBound(arr.a, x, (a, b) => cmpVal(a, b) < 0, false);
      return i < arr.a.length && eqVal(arr.a[i], x) ? i : -(i + 1);
    }
    case 'hashCode':
      return arr.a.reduce((h: number, x) => (Math.imul(31, h) + (isNum(x) ? toInt(x) : 0)) | 0, 1);
    case 'stream':
      throw new RtError('Arrays.stream() is not supported by the tracer — use a for loop', line);
  }
  throw new RtError(`Arrays.${name}() is not supported by the tracer`, line);
}

function collectionsStatic(it: Interp, name: string, args: Args, line: number): V {
  const vals = evs(it, args);
  const list = vals[0] as Vec;
  switch (name) {
    case 'sort':
      list.a.sort(it.sorter(vals[1] ?? null));
      return undefined;
    case 'reverse':
      list.a.reverse();
      return undefined;
    case 'swap': {
      const i = toInt(vals[1]);
      const j = toInt(vals[2]);
      checkIndex(it, i, list.a.length, 'list');
      checkIndex(it, j, list.a.length, 'list');
      [list.a[i], list.a[j]] = [list.a[j], list.a[i]];
      return undefined;
    }
    case 'max':
    case 'min': {
      const items = collValues(it, vals[0]);
      if (!items.length) it.throwExc('NoSuchElementException', '');
      const c = it.sorter(vals[1] ?? null);
      return items.reduce((a, b) => (name === 'max' ? (c(b, a) > 0 ? b : a) : c(b, a) < 0 ? b : a));
    }
    case 'reverseOrder':
      if (vals.length) {
        const c = it.sorter(vals[0]);
        return new Native('reverseOrder', (a) => c(a[1], a[0]));
      }
      return new Native('reverseOrder', (a) => cmpVal(a[1], a[0]));
    case 'frequency': {
      const items = collValues(it, vals[0]);
      return items.filter((x) => eqVal(x, vals[1])).length;
    }
    case 'nCopies':
      return new Vec('ArrayList', Array.from({ length: toInt(vals[0]) }, () => vals[1]));
    case 'emptyList':
      return new Vec('ArrayList', []);
    case 'emptyMap':
      return new MapV('HashMap', false);
    case 'emptySet':
      return new SetV('HashSet', false);
    case 'singletonList':
      return new Vec('ArrayList', [vals[0]]);
    case 'unmodifiableList':
    case 'unmodifiableSet':
    case 'unmodifiableMap':
    case 'synchronizedList':
      return vals[0];
    case 'addAll': {
      const c = vals[0];
      for (const x of vals.slice(1)) {
        if (c instanceof Vec) c.a.push(x);
        else if (c instanceof SetV) setAdd(it, c, x);
      }
      return true;
    }
    case 'fill':
      for (let i = 0; i < list.a.length; i++) list.a[i] = vals[1];
      return undefined;
    case 'shuffle':
      return undefined;
    case 'binarySearch': {
      const i = lowerBound(list.a, vals[1], (a, b) => cmpVal(a, b) < 0, false);
      return i < list.a.length && eqVal(list.a[i], vals[1]) ? i : -(i + 1);
    }
  }
  throw new RtError(`Collections.${name}() is not supported by the tracer`, line);
}

export function makeJavaNew(it: Interp, ty: TypeNode, args: Args, line: number): V {
  const n = ty.orig ?? ty.name;
  const vals = evs(it, args);
  const et = ty.args[0] ?? null;
  const isCmp = (v: V) => v instanceof Closure || v instanceof FnRef || v instanceof Native || v instanceof Obj;
  switch (n) {
    case 'ArrayList':
    case 'LinkedList':
    case 'Vector':
    case 'ArrayDeque':
    case 'Stack': {
      const v = new Vec(n === 'Vector' ? 'ArrayList' : n, [], et);
      if (vals.length && !isNum(vals[0])) v.a = collValues(it, vals[0]).map((x) => (x instanceof Pair ? x : x));
      return v;
    }
    case 'HashMap':
    case 'TreeMap':
    case 'LinkedHashMap':
    case 'Hashtable': {
      const cmpArg = vals.find(isCmp);
      const m = new MapV(n === 'Hashtable' ? 'HashMap' : n, n === 'TreeMap', et, ty.args[1] ?? null, n === 'TreeMap' && cmpArg ? it.sorter(cmpArg) : null);
      const src = vals.find((x) => x instanceof MapV) as MapV | undefined;
      if (src) for (const k of src.keys()) mapPut(it, m, src.m.get(k)![0], src.m.get(k)![1]);
      return m;
    }
    case 'HashSet':
    case 'TreeSet':
    case 'LinkedHashSet': {
      const cmpArg = vals.find(isCmp);
      const s = new SetV(n, n === 'TreeSet', et, n === 'TreeSet' && cmpArg ? it.sorter(cmpArg) : null);
      const src = vals.find((x) => x instanceof Vec || x instanceof SetV || x instanceof PQ);
      if (src) for (const x of collValues(it, src)) setAdd(it, s, x);
      return s;
    }
    case 'PriorityQueue': {
      const cmpArg = vals.find(isCmp);
      const c = it.sorter(cmpArg ?? null);
      const q = new PQ('PriorityQueue', (a, b) => c(a, b) < 0, et);
      const src = vals.find((x) => x instanceof Vec || x instanceof SetV || x instanceof PQ);
      if (src) for (const x of collValues(it, src)) q.push(x);
      return q;
    }
    case 'StringBuilder':
    case 'StringBuffer':
      return new SB(vals.length && !isNum(vals[0]) ? it.javaStr(vals[0]) : '');
    case 'String':
    case 'string': {
      if (!vals.length) return '';
      const v = vals[0];
      if (v instanceof Vec) {
        const from = vals.length === 3 ? toInt(vals[1]) : 0;
        const cnt = vals.length === 3 ? toInt(vals[2]) : v.a.length;
        return v.a.slice(from, from + cnt).map((c) => charStr(c as Chr)).join('');
      }
      return it.javaStr(v);
    }
    case 'Scanner':
      return new Stream('scanner');
    case 'BufferedReader':
    case 'InputStreamReader':
      return new Stream('reader');
    case 'PrintWriter':
    case 'BufferedWriter':
    case 'OutputStreamWriter':
    case 'PrintStream':
      return new Stream('writer');
    case 'StringTokenizer': {
      const s = String(vals[0] ?? '');
      const delims = vals[1] !== undefined ? String(vals[1]) : ' \t\n\r\f';
      const toks = s.split(new RegExp(`[${delims.replace(/[\]\\^-]/g, '\\$&')}]+`)).filter((x) => x.length);
      return new Tokenizer(toks);
    }
    case 'Random':
      return new Native('Random', () => it.rand());
    case 'Integer': case 'int':
      return toInt(vals[0]);
    case 'Object':
      return new Obj({ name: 'Object', base: null, decl: null, statics: new Map() });
  }
  if (/Exception$|Error$|^Throwable$/.test(n)) {
    const msg = vals.length ? (vals[0] instanceof ExcV ? it.javaStr(vals[0]) : vals[0] === null ? '' : it.javaStr(vals[0])) : '';
    return new ExcV(n, msg);
  }
  throw new RtError(`cannot find symbol: class ${n} (the tracer supports java.util collections, String, StringBuilder, Scanner, BufferedReader and your own classes)`, line);
}
