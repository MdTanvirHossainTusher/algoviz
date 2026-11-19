import { parse } from 'acorn';

/* eslint-disable @typescript-eslint/no-explicit-any */
type N = any;

interface Ins {
  pos: number;
  text: string;
  rank: number;
}

const SKIP_KEYS = new Set(['type', 'start', 'end', 'loc', 'range', 'raw']);
const FN_TYPES = new Set(['FunctionDeclaration', 'FunctionExpression', 'ArrowFunctionExpression']);
const LOOP_TYPES = new Set(['ForStatement', 'ForInStatement', 'ForOfStatement', 'WhileStatement', 'DoWhileStatement']);

function children(n: N): N[] {
  const out: N[] = [];
  for (const k of Object.keys(n)) {
    if (SKIP_KEYS.has(k)) continue;
    const v = n[k];
    if (Array.isArray(v)) {
      for (const x of v) if (x && typeof x.type === 'string') out.push(x);
    } else if (v && typeof v.type === 'string') out.push(v);
  }
  return out;
}

function patternNames(p: N, out: string[]) {
  if (!p) return;
  switch (p.type) {
    case 'Identifier':
      out.push(p.name);
      break;
    case 'ObjectPattern':
      for (const prop of p.properties) patternNames(prop.type === 'RestElement' ? prop.argument : prop.value, out);
      break;
    case 'ArrayPattern':
      for (const el of p.elements) patternNames(el, out);
      break;
    case 'RestElement':
      patternNames(p.argument, out);
      break;
    case 'AssignmentPattern':
      patternNames(p.left, out);
      break;
  }
}

/** `var` names anywhere inside a function body (they are function-scoped), not descending into nested functions. */
function hoistedVars(n: N, out: string[] = []): string[] {
  if (FN_TYPES.has(n.type)) return out;
  if (n.type === 'VariableDeclaration' && n.kind === 'var') for (const d of n.declarations) patternNames(d.id, out);
  for (const c of children(n)) hoistedVars(c, out);
  return out;
}

/** Block-scoped names declared directly in a statement list. */
function lexicalOf(stmts: N[]): string[] {
  const out: string[] = [];
  for (const s of stmts) {
    if (s.type === 'VariableDeclaration' && s.kind !== 'var') for (const d of s.declarations) patternNames(d.id, out);
    if ((s.type === 'ClassDeclaration' || s.type === 'FunctionDeclaration') && s.id) out.push(s.id.name);
  }
  return out;
}

const uniq = (a: string[]) => [...new Set(a)].filter((x) => !x.startsWith('__at_'));

/** A closure that reads every visible name; TDZ / undeclared names are skipped by the try/catch. */
const snap = (names: string[]) => `() => { const o = {}; ${names.map((n) => `try { o[${JSON.stringify(n)}] = ${n}; } catch (_) {}`).join(' ')} return o; }`;

function fnName(n: N, parent: N | undefined): string {
  if (n.id?.name) return n.id.name;
  if (parent?.type === 'VariableDeclarator' && parent.id?.type === 'Identifier') return parent.id.name;
  if ((parent?.type === 'Property' || parent?.type === 'MethodDefinition' || parent?.type === 'PropertyDefinition') && parent.key) return parent.key.name ?? String(parent.key.value ?? 'fn');
  if (parent?.type === 'AssignmentExpression' && parent.left?.type === 'Identifier') return parent.left.name;
  if (parent?.type === 'AssignmentExpression' && parent.left?.type === 'MemberExpression' && parent.left.property?.name) return parent.left.property.name;
  return n.type === 'ArrowFunctionExpression' ? '(arrow)' : '(anonymous)';
}

export interface Instrumented {
  code: string;
}

export class InstrumentError extends Error {
  line?: number;
  constructor(msg: string, line?: number) {
    super(msg);
    this.line = line;
  }
}

/**
 * Rewrite user JavaScript so it reports every statement (with a snapshot of the variables visible there),
 * function entry/exit and return values. Insertions never add newlines, so trace line numbers match the source.
 */
export function instrument(src: string): Instrumented {
  let program: N;
  try {
    program = parse(src, { ecmaVersion: 'latest', sourceType: 'script', locations: true, allowHashBang: true });
  } catch (e) {
    const err = e as SyntaxError & { loc?: { line: number } };
    throw new InstrumentError(`SyntaxError: ${err.message.replace(/\s*\(\d+:\d+\)$/, '')}`, err.loc?.line);
  }
  const ins: Ins[] = [];
  const open = (pos: number, text: string, depth: number) => ins.push({ pos, text, rank: depth });
  const close = (pos: number, text: string, depth: number) => ins.push({ pos, text, rank: -10000 - depth });
  const line = (n: N) => n.loc.start.line;
  const t = (l: number, vis: string[]) => `__at_t(${l}, ${snap(vis)});`;

  const traceList = (stmts: N[], depth: number, vis: string[]) => {
    for (const s of stmts) {
      if (s.type === 'FunctionDeclaration' || s.type === 'EmptyStatement') continue;
      open(s.start, t(line(s), vis), depth);
    }
  };

  /** Wrap a non-block body in braces so trace calls can precede it; loops also re-report their header line. */
  const wrapBody = (body: N, depth: number, vis: string[], headerLine?: number) => {
    if (body.type === 'BlockStatement') {
      if (headerLine !== undefined) open(body.start + 1, t(headerLine, uniq([...vis, ...lexicalOf(body.body)])), depth);
      return;
    }
    const pre = headerLine !== undefined ? t(headerLine, vis) : '';
    open(body.start, `{${pre}${body.type === 'EmptyStatement' ? '' : t(line(body), vis)}`, depth);
    close(body.end, '}', depth);
  };

  const visitList = (stmts: N[], parent: N, depth: number, vis: string[]) => {
    traceList(stmts, depth + 1, vis);
    for (const s of stmts) visit(s, parent, depth + 1, vis);
  };

  const visit = (n: N, parent: N | undefined, depth: number, vis: string[]): void => {
    if (FN_TYPES.has(n.type)) {
      const params: string[] = [];
      for (const prm of n.params) patternNames(prm, params);
      if (n.type === 'FunctionExpression' && n.id) params.push(n.id.name);
      // a frame shows only its own names; enclosing scopes have their own frames
      const fvis = uniq([...params, ...hoistedVars(n.body)]);
      const name = JSON.stringify(fnName(n, parent));
      for (const prm of n.params) visit(prm, n, depth + 1, fvis);
      if (n.body.type === 'BlockStatement') {
        const bvis = uniq([...fvis, ...lexicalOf(n.body.body)]);
        open(n.body.start + 1, `__at_e(${name}, ${line(n)}, ${snap(fvis)}); try {`, depth + 1);
        close(n.body.end - 1, `} catch (__at_err) { __at_ex(__at_err); throw __at_err; } finally { __at_x(); }`, depth + 1);
        visitList(n.body.body, n.body, depth + 1, bvis);
      } else {
        open(n.body.start, `__at_r(${line(n.body)}, (`, depth + 1);
        close(n.body.end, `))`, depth + 1);
        visit(n.body, n, depth + 1, fvis);
      }
      return;
    }

    switch (n.type) {
      case 'Program':
        visitList(n.body, n, depth, vis);
        return;
      case 'BlockStatement':
      case 'StaticBlock':
        visitList(n.body, n, depth, uniq([...vis, ...lexicalOf(n.body)]));
        return;
      case 'SwitchStatement': {
        const svis = uniq([...vis, ...lexicalOf(n.cases.flatMap((c: N) => c.consequent))]);
        visit(n.discriminant, n, depth + 1, vis);
        for (const c of n.cases) {
          if (c.test) visit(c.test, c, depth + 2, svis);
          visitList(c.consequent, c, depth + 1, svis);
        }
        return;
      }
      case 'CatchClause': {
        const names: string[] = [];
        if (n.param) patternNames(n.param, names);
        visit(n.body, n, depth + 1, uniq([...vis, ...names]));
        return;
      }
      case 'IfStatement':
        visit(n.test, n, depth + 1, vis);
        wrapBody(n.consequent, depth + 1, vis);
        visit(n.consequent, n, depth + 1, vis);
        if (n.alternate) {
          wrapBody(n.alternate, depth + 1, vis);
          visit(n.alternate, n, depth + 1, vis);
        }
        return;
    }

    if (LOOP_TYPES.has(n.type)) {
      const head = n.type === 'ForStatement' ? n.init : n.type === 'ForInStatement' || n.type === 'ForOfStatement' ? n.left : null;
      const names: string[] = [];
      if (head?.type === 'VariableDeclaration') for (const d of head.declarations) patternNames(d.id, names);
      const lvis = uniq([...vis, ...names]);
      wrapBody(n.body, depth + 1, lvis, line(n));
      for (const c of children(n)) visit(c, n, depth + 1, lvis);
      return;
    }

    if (n.type === 'ReturnStatement' && n.argument) {
      open(n.argument.start, `__at_r(${line(n)}, (`, depth + 1);
      close(n.argument.end, `))`, depth + 1);
    }
    for (const c of children(n)) visit(c, n, depth + 1, vis);
  };

  const gvis = uniq([...hoistedVars(program), ...lexicalOf(program.body)]);
  visit(program, undefined, 0, gvis);
  const head = `__at_e("global", 1, ${snap(gvis)});`;

  ins.sort((a, b) => a.pos - b.pos || a.rank - b.rank);
  let out = head;
  let last = 0;
  for (const i of ins) {
    out += src.slice(last, i.pos) + i.text;
    last = i.pos;
  }
  out += src.slice(last);
  return { code: out };
}
