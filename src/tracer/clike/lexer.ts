export type CLang = 'cpp' | 'java';

export interface Tok {
  k: 'id' | 'num' | 'str' | 'chr' | 'op' | 'eof';
  v: string;
  line: number;
  /** numeric literal flags */
  float?: boolean;
  long?: boolean;
}

export class CompileError extends Error {
  constructor(
    msg: string,
    public line?: number,
  ) {
    super(msg);
  }
}

const OPS = [
  '>>>=', '<<=', '>>=', '>>>', '...', '->*', '<=>',
  '::', '->', '++', '--', '<<', '>>', '<=', '>=', '==', '!=', '&&', '||',
  '+=', '-=', '*=', '/=', '%=', '&=', '|=', '^=',
];
const SINGLE = '+-*/%=<>!&|^~?:;,.(){}[]@#';

interface Macro {
  params?: string[];
  body: Tok[];
}

function unescape(s: string, line: number): string {
  let out = '';
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (c !== '\\') {
      out += c;
      continue;
    }
    const n = s[++i];
    switch (n) {
      case 'n': out += '\n'; break;
      case 't': out += '\t'; break;
      case 'r': out += '\r'; break;
      case '0': out += '\0'; break;
      case 'b': out += '\b'; break;
      case 'f': out += '\f'; break;
      case 'a': out += '\x07'; break;
      case 'v': out += '\v'; break;
      case '\\': out += '\\'; break;
      case "'": out += "'"; break;
      case '"': out += '"'; break;
      case '?': out += '?'; break;
      case 'x': {
        const m = /^[0-9a-fA-F]+/.exec(s.slice(i + 1));
        if (!m) throw new CompileError('bad \\x escape', line);
        out += String.fromCharCode(parseInt(m[0], 16));
        i += m[0].length;
        break;
      }
      case 'u': {
        out += String.fromCharCode(parseInt(s.slice(i + 1, i + 5), 16));
        i += 4;
        break;
      }
      default:
        out += n ?? '';
    }
  }
  return out;
}

/** Tokenizes C++ or Java source. C++ object- and function-like #define macros are expanded; other directives are ignored. */
export function lex(src: string, lang: CLang): Tok[] {
  const raw: Tok[] = [];
  const macros = new Map<string, Macro>();
  let i = 0;
  let line = 1;
  let atLineStart = true;
  const n = src.length;

  while (i < n) {
    const c = src[i];
    if (c === '\n') {
      line++;
      i++;
      atLineStart = true;
      continue;
    }
    if (c === ' ' || c === '\t' || c === '\r' || c === '\f' || c === '\v') {
      i++;
      continue;
    }
    if (c === '/' && src[i + 1] === '/') {
      while (i < n && src[i] !== '\n') i++;
      continue;
    }
    if (c === '/' && src[i + 1] === '*') {
      const end = src.indexOf('*/', i + 2);
      const stop = end < 0 ? n : end + 2;
      for (let j = i; j < stop; j++) if (src[j] === '\n') line++;
      i = stop;
      continue;
    }
    if (c === '#' && atLineStart && lang === 'cpp') {
      // read the whole directive (with \-continuations)
      let j = i + 1;
      let text = '';
      const startLine = line;
      while (j < n && src[j] !== '\n') {
        if (src[j] === '\\' && src[j + 1] === '\n') {
          j += 2;
          line++;
          text += ' ';
          continue;
        }
        text += src[j++];
      }
      i = j;
      const m = /^\s*define\s+([A-Za-z_]\w*)(\(([^)]*)\))?\s*(.*)$/.exec(text.replace(/\/\/.*$/, ''));
      if (m) {
        const body = lex(m[4], lang).slice(0, -1).map((t) => ({ ...t, line: startLine }));
        macros.set(m[1], { params: m[2] !== undefined ? m[3].split(',').map((s) => s.trim()).filter(Boolean) : undefined, body });
      }
      continue;
    }
    atLineStart = false;

    if (/[A-Za-z_$]/.test(c)) {
      let j = i + 1;
      while (j < n && /[\w$]/.test(src[j])) j++;
      const word = src.slice(i, j);
      // C++ raw string R"( ... )"
      if (lang === 'cpp' && word === 'R' && src[j] === '"') {
        const open = src.indexOf('(', j);
        const delim = src.slice(j + 1, open);
        const close = src.indexOf(`)${delim}"`, open);
        if (open < 0 || close < 0) throw new CompileError('unterminated raw string', line);
        const s = src.slice(open + 1, close);
        raw.push({ k: 'str', v: s, line });
        for (const ch of s) if (ch === '\n') line++;
        i = close + delim.length + 2;
        continue;
      }
      raw.push({ k: 'id', v: word, line });
      i = j;
      continue;
    }
    if (/[0-9]/.test(c) || (c === '.' && /[0-9]/.test(src[i + 1] ?? ''))) {
      const m = /^(0[xX][0-9a-fA-F'_]+|0[bB][01'_]+|(?:[0-9][0-9'_]*)?\.?[0-9'_]*(?:[eE][+-]?[0-9]+)?)([uUlLfFdD]*)/.exec(src.slice(i));
      const body = m![1].replace(/['_]/g, '');
      const suf = m![2].toLowerCase();
      const isHex = /^0x/i.test(body);
      const isBin = /^0b/i.test(body);
      const float = !isHex && !isBin && (/[.eE]/.test(body) || suf.includes('f') || suf.includes('d'));
      raw.push({ k: 'num', v: body, line, float, long: suf.includes('l') });
      i += m![0].length;
      continue;
    }
    if (c === '"') {
      let j = i + 1;
      while (j < n && src[j] !== '"') {
        if (src[j] === '\\') j++;
        if (src[j] === '\n') throw new CompileError('unterminated string literal', line);
        j++;
      }
      raw.push({ k: 'str', v: unescape(src.slice(i + 1, j), line), line });
      i = j + 1;
      continue;
    }
    if (c === "'") {
      let j = i + 1;
      while (j < n && src[j] !== "'") {
        if (src[j] === '\\') j++;
        if (src[j] === '\n') throw new CompileError('unterminated character literal', line);
        j++;
      }
      const v = unescape(src.slice(i + 1, j), line);
      if (v.length !== 1) throw new CompileError(`character literal must hold one character: '${src.slice(i + 1, j)}'`, line);
      raw.push({ k: 'chr', v, line });
      i = j + 1;
      continue;
    }
    const op = OPS.find((o) => src.startsWith(o, i));
    if (op) {
      raw.push({ k: 'op', v: op, line });
      i += op.length;
      continue;
    }
    if (SINGLE.includes(c)) {
      raw.push({ k: 'op', v: c, line });
      i++;
      continue;
    }
    throw new CompileError(`unexpected character '${c}'`, line);
  }

  const out = macros.size ? expand(raw, macros) : raw;
  out.push({ k: 'eof', v: '<end of file>', line });
  return out;
}

function expand(toks: Tok[], macros: Map<string, Macro>, depth = 0): Tok[] {
  if (depth > 20) return toks;
  const out: Tok[] = [];
  let changed = false;
  for (let i = 0; i < toks.length; i++) {
    const t = toks[i];
    const m = t.k === 'id' ? macros.get(t.v) : undefined;
    if (!m) {
      out.push(t);
      continue;
    }
    if (!m.params) {
      out.push(...m.body.map((b) => ({ ...b, line: t.line })));
      changed = true;
      continue;
    }
    if (toks[i + 1]?.v !== '(') {
      out.push(t);
      continue;
    }
    // collect arguments
    const args: Tok[][] = [[]];
    let d = 0;
    let j = i + 2;
    for (; j < toks.length; j++) {
      const a = toks[j];
      if (a.v === '(' && a.k === 'op') d++;
      if (a.v === ')' && a.k === 'op') {
        if (d === 0) break;
        d--;
      }
      if (a.v === ',' && a.k === 'op' && d === 0) {
        args.push([]);
        continue;
      }
      args[args.length - 1].push(a);
    }
    for (const b of m.body) {
      const pi = b.k === 'id' ? m.params.indexOf(b.v) : -1;
      if (pi >= 0) out.push(...(args[pi] ?? []).map((a) => ({ ...a, line: t.line })));
      else out.push({ ...b, line: t.line });
    }
    i = j;
    changed = true;
  }
  return changed ? expand(out, macros, depth + 1) : out;
}
