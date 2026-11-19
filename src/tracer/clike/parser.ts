import { CompileError, lex, type CLang, type Tok } from './lexer';
import type { ClassDecl, Declarator, Expr, FieldDecl, FnDecl, Param, Program, Stmt, TypeNode } from './ast';
import { T } from './ast';

const CPP_TYPES = `int long short double float char bool void auto unsigned signed size_t int64_t int32_t int16_t int8_t uint64_t uint32_t uint16_t uint8_t
string vector map unordered_map set unordered_set multiset unordered_multiset multimap pair stack queue priority_queue deque list array tuple bitset
greater less greater_equal less_equal function exception runtime_error logic_error invalid_argument out_of_range ostream istream`.split(/\s+/);

const JAVA_TYPES = `int long short byte double float char boolean void var String Integer Long Short Byte Double Float Character Boolean Object Number
List ArrayList LinkedList Map HashMap TreeMap LinkedHashMap Set HashSet TreeSet LinkedHashSet Stack Queue Deque ArrayDeque PriorityQueue Vector
StringBuilder StringBuffer Scanner BufferedReader InputStreamReader StringTokenizer PrintWriter BufferedWriter OutputStreamWriter Iterator Comparator
Collection Iterable Exception RuntimeException IllegalArgumentException IllegalStateException ArithmeticException IndexOutOfBoundsException
ArrayIndexOutOfBoundsException NullPointerException UnsupportedOperationException IOException NumberFormatException Random Math Arrays Collections
Optional Function BiFunction Runnable Supplier Consumer Predicate`.split(/\s+/);

/** Java classes that can't appear as declaration types (so `Math.max(...)` statements aren't read as declarations). */
const JAVA_STATIC_ONLY = new Set(['Math', 'Arrays', 'Collections']);

const CPP_QUALIFIERS = new Set(['const', 'constexpr', 'static', 'inline', 'volatile', 'mutable', 'register', 'typename', 'extern', 'thread_local']);
const JAVA_MODIFIERS = new Set(['public', 'private', 'protected', 'static', 'final', 'abstract', 'synchronized', 'transient', 'volatile', 'native', 'strictfp', 'default', 'sealed']);

function normalize(name: string, lang: CLang): string {
  if (lang === 'java') {
    switch (name) {
      case 'Integer': return 'int';
      case 'Long': return 'long';
      case 'Short': return 'short';
      case 'Byte': return 'byte';
      case 'Double': case 'Float': case 'float': return 'double';
      case 'Character': return 'char';
      case 'Boolean': case 'boolean': return 'bool';
      case 'String': return 'string';
      case 'var': return 'auto';
      case 'Vector': return 'ArrayList';
    }
    return name;
  }
  switch (name) {
    case 'long long': case 'long': case 'long int': case 'long long int': case 'int64_t': case 'signed long long':
      return 'long';
    case 'unsigned long long': case 'unsigned long': case 'uint64_t': case 'unsigned long long int':
      return 'ulong';
    case 'unsigned': case 'unsigned int': case 'size_t': case 'uint32_t': case 'uint16_t': case 'uint8_t': case 'unsigned short': case 'unsigned char':
      return 'uint';
    case 'int32_t': case 'signed': case 'signed int': case 'short': case 'short int': case 'int16_t': case 'int8_t': case 'signed char':
      return 'int';
    case 'float': case 'long double':
      return 'double';
  }
  return name;
}

interface State {
  pos: number;
  pending: number;
}

class Parser {
  toks: Tok[];
  pos = 0;
  /** virtual '>' tokens left over from splitting '>>' / '>>>' when closing template args */
  pending = 0;
  types: Set<string>;
  aliases = new Map<string, TypeNode>();
  cls: ClassDecl | null = null;

  constructor(
    src: string,
    public lang: CLang,
  ) {
    this.toks = lex(src, lang);
    this.types = new Set(lang === 'cpp' ? CPP_TYPES : JAVA_TYPES);
    this.prescan();
  }

  /** collect user type names first, so declarations that use a class before its definition still parse */
  prescan() {
    const t = this.toks;
    for (let i = 0; i < t.length - 1; i++) {
      const w = t[i].v;
      if (t[i].k !== 'id') continue;
      if ((w === 'struct' || w === 'class' || w === 'interface' || w === 'enum' || w === 'record') && t[i + 1].k === 'id') {
        let j = i + 1;
        if (t[j].v === 'class' || t[j].v === 'struct') j++; // enum class X
        this.types.add(t[j].v);
      }
      if (w === 'typedef') {
        let j = i + 1;
        let d = 0;
        while (j < t.length && !(t[j].v === ';' && d === 0)) {
          if (t[j].v === '(' || t[j].v === '<') d++;
          if (t[j].v === ')' || t[j].v === '>') d--;
          if (t[j].v === '>>') d -= 2;
          j++;
        }
        if (t[j - 1]?.k === 'id') this.types.add(t[j - 1].v);
      }
      if (w === 'using' && t[i + 1].k === 'id' && t[i + 2]?.v === '=') this.types.add(t[i + 1].v);
      if (w === 'template' && t[i + 1].v === '<') {
        let j = i + 2;
        for (; j < t.length && t[j].v !== '>'; j++) if ((t[j].v === 'typename' || t[j].v === 'class') && t[j + 1]?.k === 'id') this.types.add(t[j + 1].v);
        // the templated function's name: the first `name (` after the header, so `name<T>(…)` parses as a call
        for (; j < t.length && t[j].v !== '{' && t[j].v !== ';'; j++) if (t[j].k === 'id' && t[j + 1]?.v === '(') {
          this.templateFns.add(t[j].v);
          break;
        }
      }
    }
    if (this.lang === 'java') {
      // generic type params: <T>, <K, V>, <T extends Comparable<T>> (single capital letters, optionally with a digit)
      for (let i = 1; i < t.length - 1; i++) {
        const prev = t[i - 1].v;
        const nxt = t[i + 1].v;
        if (t[i].k === 'id' && /^[A-Z]\d?$/.test(t[i].v) && (prev === '<' || prev === ',') && (nxt === '>' || nxt === ',' || nxt === 'extends' || nxt === '>>')) this.types.add(t[i].v);
      }
    }
  }

  templateFns = new Set<string>();

  // ---------- token helpers ----------
  peek(o = 0): Tok {
    if (this.pending > 0) {
      if (o < this.pending) return { k: 'op', v: '>', line: this.toks[this.pos - 1].line };
      return this.toks[Math.min(this.pos + o - this.pending, this.toks.length - 1)];
    }
    return this.toks[Math.min(this.pos + o, this.toks.length - 1)];
  }
  next(): Tok {
    if (this.pending > 0) {
      this.pending--;
      return { k: 'op', v: '>', line: this.toks[this.pos - 1].line };
    }
    return this.toks[Math.min(this.pos++, this.toks.length - 1)];
  }
  get line() {
    return this.peek().line;
  }
  is(v: string, o = 0) {
    const t = this.peek(o);
    return t.v === v && (t.k === 'op' || t.k === 'id');
  }
  eat(v: string) {
    if (this.is(v)) {
      this.next();
      return true;
    }
    return false;
  }
  expect(v: string, what?: string): Tok {
    if (!this.is(v)) {
      const t = this.peek();
      const prev = this.toks[this.pos - 1];
      // a missing ';' belongs to the end of the previous line, as compilers report it
      if (v === ';' && prev && prev.line < t.line) throw new CompileError(`expected ';' at the end of line ${prev.line} (before '${t.v}')`, prev.line);
      throw new CompileError(`expected '${v}'${what ? ` ${what}` : ''} but found '${t.v}'`, t.line);
    }
    return this.next();
  }
  ident(what = 'a name'): string {
    const t = this.peek();
    if (t.k !== 'id') throw new CompileError(`expected ${what} but found '${t.v}'`, t.line);
    this.next();
    return t.v;
  }
  save(): State {
    return { pos: this.pos, pending: this.pending };
  }
  restore(s: State) {
    this.pos = s.pos;
    this.pending = s.pending;
  }
  closeAngle() {
    const t = this.peek();
    if (t.v === '>') {
      this.next();
      return;
    }
    if (t.k === 'op' && (t.v === '>>' || t.v === '>>>')) {
      this.pos++;
      this.pending = t.v.length - 1;
      return;
    }
    throw new CompileError(`expected '>' to close template arguments but found '${t.v}'`, t.line);
  }
  err(msg: string, line = this.line): never {
    throw new CompileError(msg, line);
  }

  // ---------- types ----------
  isTypeName(name: string) {
    return this.types.has(name) || this.aliases.has(name);
  }

  /** Parses a type at the cursor, or returns null (cursor restored) when there is none. */
  tryType(allowStaticOnly = false): TypeNode | null {
    const s = this.save();
    try {
      const t = this.type(allowStaticOnly);
      if (t) return t;
    } catch (e) {
      if (!(e instanceof CompileError)) throw e;
    }
    this.restore(s);
    return null;
  }

  type(allowStaticOnly = false): TypeNode | null {
    const java = this.lang === 'java';
    let sawQualifier = false;
    for (;;) {
      const t = this.peek();
      if (t.k !== 'id') break;
      if (!java && CPP_QUALIFIERS.has(t.v)) {
        this.next();
        sawQualifier = true;
        continue;
      }
      if (java && t.v === 'final') {
        this.next();
        sawQualifier = true;
        continue;
      }
      break;
    }
    if (!java && this.is('decltype') && this.is('(', 1)) {
      this.next();
      this.skipBalanced('(', ')');
      return this.typeSuffix({ ...T('auto'), orig: 'decltype' });
    }
    if (!java && (this.is('struct') || this.is('class') || this.is('enum'))) {
      this.next();
      const name = this.ident();
      this.types.add(name);
      return this.typeSuffix(T(name));
    }
    if (!java && this.is('std') && this.is('::', 1)) {
      this.next();
      this.next();
    }
    const first = this.peek();
    if (first.k !== 'id') return sawQualifier && !java ? this.err(`expected a type but found '${first.v}'`) : null;
    let name = first.v;

    if (!java && ['unsigned', 'signed', 'long', 'short'].includes(name)) {
      // multi-word builtin types
      const words: string[] = [];
      while (this.peek().k === 'id' && ['unsigned', 'signed', 'long', 'short', 'int', 'char', 'double'].includes(this.peek().v)) words.push(this.next().v);
      name = words.join(' ');
      return this.typeSuffix({ ...T(normalize(name, 'cpp')), orig: name });
    }
    if (!this.isTypeName(name)) return null;
    if (java && JAVA_STATIC_ONLY.has(name) && !allowStaticOnly) return null;
    this.next();
    if (java && this.is('.') && this.peek(1).k === 'id' && this.isTypeName(`${name}.${this.peek(1).v}`)) {
      this.next();
      name = `${name}.${this.next().v}`;
    }
    if (java && name === 'Map' && this.is('.') && this.peek(1).v === 'Entry') {
      this.next();
      this.next();
      name = 'Map.Entry';
    }
    if (name === 'function' && this.is('<')) {
      // std::function<R(Args...)>: the signature is not needed at runtime
      this.skipBalanced('<', '>');
      return this.typeSuffix({ ...T('function'), orig: 'function' });
    }
    const alias = this.aliases.get(name);
    let ty: TypeNode;
    if (alias) ty = { ...alias, args: [...alias.args] };
    else ty = { ...T(normalize(name, this.lang)), orig: name };
    if (this.is('<')) {
      const st = this.save();
      try {
        this.next();
        const args: TypeNode[] = [];
        if (!this.is('>')) {
          do {
            const a = this.tryType(true);
            if (a) args.push(a);
            else {
              // value template argument: array<int, 5>, bitset<32>
              const v = this.binary(7);
              ty.value = v;
            }
          } while (this.eat(','));
        }
        this.closeAngle();
        ty.args = args;
      } catch (e) {
        if (!(e instanceof CompileError)) throw e;
        this.restore(st);
        return null;
      }
    }
    return this.typeSuffix(ty);
  }

  typeSuffix(ty: TypeNode): TypeNode {
    if (this.lang === 'java') {
      while (this.is('[') && this.is(']', 1)) {
        this.next();
        this.next();
        ty.arr++;
      }
      if (this.is('...')) {
        this.next();
        ty.arr++;
      }
      return ty;
    }
    for (;;) {
      if (this.is('*')) {
        this.next();
        ty.ptr++;
      } else if (this.is('const') || this.is('volatile')) this.next();
      else if (this.is('&') || this.is('&&')) {
        this.next();
        ty.ref = true;
      } else break;
    }
    return ty;
  }

  // ---------- program ----------
  program(): Program {
    const prog: Program = { lang: this.lang, classes: [], functions: [], globals: [] };
    if (this.lang === 'java') {
      while (this.peek().k !== 'eof') {
        if (this.eat(';')) continue;
        if (this.is('package') || this.is('import')) {
          while (!this.is(';') && this.peek().k !== 'eof') this.next();
          this.eat(';');
          continue;
        }
        this.skipModifiers();
        if (this.is('class') || this.is('interface') || this.is('enum') || this.is('record')) {
          prog.classes.push(this.javaClass(null));
          continue;
        }
        this.err(`expected a class declaration but found '${this.peek().v}' — Java code must be inside a class`);
      }
      return prog;
    }
    while (this.peek().k !== 'eof') this.cppTop(prog);
    return prog;
  }

  skipModifiers() {
    for (;;) {
      if (this.is('@') && !this.is('interface', 1)) {
        this.next();
        this.ident();
        if (this.is('(')) this.skipBalanced('(', ')');
        continue;
      }
      if (this.peek().k === 'id' && JAVA_MODIFIERS.has(this.peek().v) && !(this.peek().v === 'default' && this.is(':', 1))) {
        this.next();
        continue;
      }
      break;
    }
  }

  skipBalanced(open: string, close: string) {
    let d = 0;
    do {
      const t = this.next();
      if (t.k === 'eof') this.err(`unbalanced '${open}'`);
      if (t.v === open) d++;
      else if (t.v === close) d--;
      else if (open === '<' && t.k === 'op' && (t.v === '>>' || t.v === '>>>')) {
        // a '>>' that closes more levels than we opened leaves virtual '>' tokens for the caller
        const n = t.v.length;
        if (n > d) this.pending = n - d;
        d -= Math.min(n, d);
      }
    } while (d > 0);
  }

  cppTop(prog: Program) {
    if (this.eat(';')) return;
    const line = this.line;
    if (this.is('using')) {
      this.next();
      if (this.is('namespace')) {
        while (!this.eat(';')) this.next();
        return;
      }
      if (this.peek().k === 'id' && this.is('=', 1)) {
        const name = this.next().v;
        this.next();
        const ty = this.type(true) ?? this.err('expected a type after using … =');
        this.aliases.set(name, ty);
        this.types.add(name);
        this.expect(';');
        return;
      }
      while (!this.eat(';')) this.next(); // using std::cout;
      return;
    }
    if (this.is('typedef')) {
      this.next();
      const ty = this.type(true) ?? this.err('expected a type after typedef');
      const name = this.ident();
      while (this.is('[')) {
        this.next();
        ty.dims = [...(ty.dims ?? []), this.expr()];
        ty.arr++;
        this.expect(']');
      }
      this.aliases.set(name, ty);
      this.types.add(name);
      this.expect(';');
      return;
    }
    if (this.is('template')) {
      this.next();
      this.expect('<');
      while (!this.is('>')) {
        if (this.is('typename') || this.is('class')) {
          this.next();
          const n = this.ident();
          this.aliases.set(n, T('auto'));
          this.types.add(n);
        } else this.next();
      }
      this.next();
      return; // the templated declaration follows; type params behave like auto
    }
    if (this.is('namespace')) {
      this.next();
      if (this.peek().k === 'id') this.next();
      this.expect('{');
      while (!this.eat('}')) this.cppTop(prog);
      return;
    }
    if ((this.is('struct') || this.is('class')) && this.peek(1).k === 'id' && (this.is('{', 2) || this.is(':', 2) || this.is(';', 2) || this.is('final', 2))) {
      this.next();
      const name = this.next().v;
      if (this.eat(';')) return; // forward declaration
      const c = this.cppClass(name, line);
      prog.classes.push(c);
      // struct X {...} a, b;
      if (!this.eat(';')) {
        const decls: Declarator[] = [];
        do decls.push(this.declarator(T(name))); while (this.eat(','));
        this.expect(';');
        prog.globals.push({ k: 'decl', line, decls });
      }
      return;
    }
    if (this.is('enum')) {
      this.next();
      if (this.is('class') || this.is('struct')) this.next();
      const name = this.peek().k === 'id' ? this.next().v : '';
      if (name) this.types.add(name);
      if (this.eat(':')) this.type(true);
      this.expect('{');
      let v = 0;
      const decls: Declarator[] = [];
      while (!this.eat('}')) {
        const l = this.line;
        const n = this.ident('an enum constant');
        let init: Expr = { k: 'num', line: l, v, float: false };
        if (this.eat('=')) {
          init = this.ternary();
          if (init.k === 'num') v = Number(init.v);
        }
        decls.push({ name: n, ty: T('int'), init });
        v++;
        this.eat(',');
      }
      this.eat(';');
      if (decls.length) prog.globals.push({ k: 'decl', line, decls });
      if (name) this.aliases.set(name, T('int'));
      return;
    }
    const ty = this.type(true);
    if (!ty) this.err(`unexpected '${this.peek().v}' at the top level — expected a declaration`);
    // operator overload as a free function
    if (this.is('operator')) {
      const name = this.operatorName();
      prog.functions.push(this.fnRest(ty, name, line, false));
      return;
    }
    const nameTok = this.peek();
    if (nameTok.k !== 'id') this.err(`expected a name after the type but found '${nameTok.v}'`);
    // ClassName::method(...) out-of-line definition
    if (this.is('::', 1) && this.peek(2).k === 'id') {
      const owner = this.next().v;
      this.next();
      const mname = this.is('operator') ? this.operatorName() : this.next().v;
      const fn = this.fnRest(ty, mname, line, false);
      const c = prog.classes.find((x) => x.name === owner);
      if (!c) this.err(`unknown class '${owner}'`);
      const existing = c.methods.findIndex((m) => m.name === mname && m.params.length === fn.params.length && !m.body);
      fn.owner = c;
      if (existing >= 0) c.methods[existing] = fn;
      else c.methods.push(fn);
      return;
    }
    if (this.is('(', 1) && this.looksLikeParams(2)) {
      this.next();
      const fn = this.fnRest(ty, nameTok.v, line, false);
      if (fn.body) {
        const i = prog.functions.findIndex((f) => f.name === fn.name && !f.body && f.params.length === fn.params.length);
        if (i >= 0) prog.functions.splice(i, 1);
        prog.functions.push(fn);
      } else if (!prog.functions.some((f) => f.name === fn.name && f.params.length === fn.params.length)) prog.functions.push(fn);
      return;
    }
    const decls: Declarator[] = [];
    do decls.push(this.declarator(ty)); while (this.eat(','));
    this.expect(';');
    prog.globals.push({ k: 'decl', line, decls });
  }

  /** after '(' — is this a parameter list (function) rather than constructor arguments? */
  looksLikeParams(o: number): boolean {
    const t = this.peek(o);
    if (t.v === ')' ) return true;
    if (t.v === 'void' && this.peek(o + 1).v === ')') return true;
    if (t.k !== 'id') return false;
    if (CPP_QUALIFIERS.has(t.v) || t.v === 'struct' || ['unsigned', 'signed', 'long', 'short'].includes(t.v)) return true;
    if (t.v === 'std' && this.peek(o + 1).v === '::') return this.isTypeName(this.peek(o + 2).v);
    return this.isTypeName(t.v);
  }

  operatorName(): string {
    this.expect('operator');
    if (this.is('(') && this.is(')', 1)) {
      this.next();
      this.next();
      return 'operator()';
    }
    if (this.is('[') && this.is(']', 1)) {
      this.next();
      this.next();
      return 'operator[]';
    }
    const t = this.next();
    return `operator${t.v}`;
  }

  params(): Param[] {
    this.expect('(');
    const ps: Param[] = [];
    if (this.eat(')')) return ps;
    if (this.is('void') && this.is(')', 1)) {
      this.next();
      this.next();
      return ps;
    }
    do {
      if (this.lang === 'java') this.skipModifiers();
      if (this.is('...')) {
        this.next();
        ps.push({ name: '...', ty: T('auto') });
        continue;
      }
      const ty = this.type(true) ?? this.err(`expected a parameter type but found '${this.peek().v}'`);
      let name = '';
      if (this.peek().k === 'id') name = this.next().v;
      while (this.is('[')) {
        this.next();
        if (!this.is(']')) this.expr();
        this.expect(']');
        ty.arr++;
      }
      let def: Expr | undefined;
      if (this.eat('=')) def = this.assign();
      ps.push({ name, ty, def });
    } while (this.eat(','));
    this.expect(')');
    return ps;
  }

  /** after the function name: params, qualifiers, body */
  fnRest(ret: TypeNode | null, name: string, line: number, isStatic: boolean, isCtor = false): FnDecl {
    const params = this.params();
    const fn: FnDecl = { name, ret, params, body: null, line, end: line, isStatic };
    for (;;) {
      if (this.is('const') || this.is('noexcept') || this.is('override') || this.is('final') || this.is('mutable')) this.next();
      else if (this.is('throws')) {
        this.next();
        do this.type(true) ?? this.ident(); while (this.eat(','));
      } else if (this.is('->')) {
        this.next();
        fn.ret = this.type(true);
      } else break;
    }
    if (isCtor && this.is(':')) {
      this.next();
      fn.inits = [];
      do {
        const n = this.ident('a member name');
        let args: Expr[];
        if (this.is('{')) {
          this.next();
          args = this.args('}');
          // brace-init of a member is an initializer list
          args = [{ k: 'init', line: this.line, items: args }];
        } else {
          this.expect('(');
          args = this.args(')');
        }
        fn.inits.push({ name: n, args });
      } while (this.eat(','));
    }
    if (this.is('=') && (this.is('default', 1) || this.is('delete', 1) || this.peek(1).v === '0')) {
      this.next();
      this.next();
      this.expect(';');
      return fn;
    }
    if (this.eat(';')) return fn;
    const b = this.block();
    fn.body = b.body;
    fn.end = b.end;
    return fn;
  }

  declarator(base: TypeNode): Declarator {
    const ty: TypeNode = { ...base, args: base.args, dims: base.dims ? [...base.dims] : undefined };
    if (this.lang === 'cpp') {
      // per-declarator pointer/reference: int *p, &r
      for (;;) {
        if (this.is('*')) {
          this.next();
          ty.ptr++;
        } else if (this.is('&') || this.is('&&')) {
          this.next();
          ty.ref = true;
        } else if (this.is('const')) this.next();
        else break;
      }
      if (this.is('[')) {
        // structured binding
        this.next();
        const names: string[] = [];
        do names.push(this.ident()); while (this.eat(','));
        this.expect(']');
        const d: Declarator = { name: names.join(','), ty, binding: names };
        if (this.eat('=')) d.init = this.assign();
        else if (this.is('{') || this.is('(')) {
          const close = this.next().v === '{' ? '}' : ')';
          d.init = this.args(close)[0];
        }
        return d;
      }
    }
    const name = this.ident('a variable name');
    while (this.is('[')) {
      this.next();
      const size = this.is(']') ? null : this.expr();
      this.expect(']');
      ty.arr++;
      if (this.lang === 'cpp') ty.dims = [...(ty.dims ?? []), size];
    }
    const d: Declarator = { name, ty };
    if (this.eat('=')) d.init = this.is('{') ? this.initList() : this.assign();
    else if (this.lang === 'cpp' && this.is('(')) {
      this.next();
      d.ctorArgs = this.args(')');
    } else if (this.lang === 'cpp' && this.is('{')) {
      d.init = this.initList();
      d.ctorArgs = undefined;
    }
    return d;
  }

  initList(): Expr {
    const line = this.expect('{').line;
    const items: Expr[] = [];
    while (!this.is('}')) {
      items.push(this.is('{') ? this.initList() : this.assign());
      if (!this.eat(',')) break;
    }
    this.expect('}');
    return { k: 'init', line, items };
  }

  args(close: string): Expr[] {
    const out: Expr[] = [];
    if (this.eat(close)) return out;
    do out.push(this.is('{') ? this.initList() : this.assign()); while (this.eat(','));
    this.expect(close);
    return out;
  }

  // ---------- classes ----------
  newClass(name: string, line: number, outer: ClassDecl | null): ClassDecl {
    return { name, fields: [], methods: [], ctors: [], inner: [], staticInit: [], isInterface: false, line, outer: outer ?? undefined };
  }

  cppClass(name: string, line: number): ClassDecl {
    const c = this.newClass(name, line, this.cls);
    this.types.add(name);
    if (this.eat('final')) {
      /* ignore */
    }
    if (this.eat(':')) {
      do {
        while (this.is('public') || this.is('private') || this.is('protected') || this.is('virtual')) this.next();
        const b = this.type(true);
        if (b && !c.base) c.base = b.name;
      } while (this.eat(','));
    }
    this.expect('{');
    const prevCls = this.cls;
    this.cls = c;
    while (!this.eat('}')) {
      const l = this.line;
      if (this.eat(';')) continue;
      if ((this.is('public') || this.is('private') || this.is('protected')) && this.is(':', 1)) {
        this.next();
        this.next();
        continue;
      }
      if (this.is('friend')) this.next();
      if (this.is('virtual') || this.is('explicit') || this.is('inline')) this.next();
      if ((this.is('struct') || this.is('class')) && this.peek(1).k === 'id' && (this.is('{', 2) || this.is(':', 2))) {
        this.next();
        const n = this.next().v;
        c.inner.push(this.cppClass(n, l));
        this.eat(';');
        continue;
      }
      if (this.is('~')) {
        this.next();
        this.ident();
        this.fnRest(null, `~${name}`, l, false);
        continue;
      }
      if (this.is('template')) {
        this.next();
        this.skipBalanced('<', '>');
        continue;
      }
      // constructor
      if (this.is(name) && this.is('(', 1)) {
        this.next();
        const fn = this.fnRest(null, name, l, false, true);
        fn.owner = c;
        c.ctors.push(fn);
        continue;
      }
      let isStatic = false;
      if (this.is('static')) {
        isStatic = true;
      }
      const ty = this.type(true) ?? this.err(`unexpected '${this.peek().v}' in struct ${name}`);
      if (this.is('operator')) {
        const op = this.operatorName();
        const fn = this.fnRest(ty, op, l, isStatic);
        fn.owner = c;
        c.methods.push(fn);
        continue;
      }
      if (this.peek().k === 'id' && this.is('(', 1) && this.looksLikeParams(2)) {
        const n = this.next().v;
        const fn = this.fnRest(ty, n, l, isStatic);
        fn.owner = c;
        c.methods.push(fn);
        continue;
      }
      do {
        const d = this.declarator(ty);
        c.fields.push({ name: d.name, ty: d.ty, init: d.init, ctorArgs: d.ctorArgs, isStatic, line: l });
      } while (this.eat(','));
      this.expect(';');
    }
    this.cls = prevCls;
    return c;
  }

  javaClass(outer: ClassDecl | null): ClassDecl {
    const kindTok = this.next();
    const line = kindTok.line;
    const name = this.ident('a class name');
    const c = this.newClass(name, line, outer);
    c.isInterface = kindTok.v === 'interface';
    c.isEnum = kindTok.v === 'enum';
    this.types.add(name);
    if (this.is('<')) this.skipBalanced('<', '>');
    if (kindTok.v === 'record') {
      for (const p of this.params()) c.fields.push({ name: p.name, ty: p.ty!, isStatic: false, line });
      const ctor: FnDecl = {
        name, ret: null, params: c.fields.map((f) => ({ name: f.name, ty: f.ty })), line, end: line, isStatic: false, owner: c,
        body: c.fields.map((f) => ({ k: 'expr', line, e: { k: 'assign', line, op: '=', a: { k: 'member', line, a: { k: 'this', line }, name: f.name, arrow: false }, b: { k: 'id', line, name: f.name } } }) as Stmt),
      };
      c.ctors.push(ctor);
      for (const f of c.fields) c.methods.push({ name: f.name, ret: f.ty, params: [], line, end: line, isStatic: false, owner: c, body: [{ k: 'return', line, e: { k: 'member', line, a: { k: 'this', line }, name: f.name, arrow: false } }] });
    }
    if (this.eat('extends')) {
      c.base = this.looseTypeName();
      while (this.eat(',')) this.looseTypeName();
    }
    if (this.eat('implements')) {
      do this.looseTypeName(); while (this.eat(','));
    }
    this.classBody(c);
    return c;
  }

  /** a supertype name that may be a library type the tracer does not model (Comparable<T>, Serializable, Runnable) */
  looseTypeName(): string {
    const t = this.tryType(true);
    if (t) return t.orig ?? t.name;
    let name = this.ident('a type name');
    while (this.is('.') && this.peek(1).k === 'id') {
      this.next();
      name = this.next().v;
    }
    if (this.is('<')) this.skipBalanced('<', '>');
    return name;
  }

  classBody(c: ClassDecl) {
    this.expect('{');
    const prevCls = this.cls;
    this.cls = c;
    if (c.isEnum) {
      c.enumConsts = [];
      while (this.peek().k === 'id' && !this.is(';')) {
        const n = this.next().v;
        const args = this.is('(') ? (this.next(), this.args(')')) : [];
        c.enumConsts.push({ name: n, args });
        if (!this.eat(',')) break;
      }
      this.eat(';');
    }
    while (!this.eat('}')) {
      const l = this.line;
      if (this.eat(';')) continue;
      if (this.is('static') && this.is('{', 1)) {
        this.next();
        c.staticInit.push(...this.block().body);
        continue;
      }
      if (this.is('{')) {
        c.staticInit.push(...this.block().body);
        continue;
      }
      let isStatic = false;
      for (;;) {
        if (this.is('@') && !this.is('interface', 1)) {
          this.next();
          this.ident();
          if (this.is('(')) this.skipBalanced('(', ')');
          continue;
        }
        const t = this.peek();
        if (t.k === 'id' && JAVA_MODIFIERS.has(t.v)) {
          if (t.v === 'static') isStatic = true;
          this.next();
          continue;
        }
        break;
      }
      if (this.is('class') || this.is('interface') || this.is('enum') || this.is('record')) {
        c.inner.push(this.javaClass(c));
        continue;
      }
      if (this.is('<')) this.skipBalanced('<', '>'); // generic method type params
      if (this.is(c.name) && this.is('(', 1)) {
        this.next();
        const fn = this.fnRest(null, c.name, l, false);
        fn.owner = c;
        c.ctors.push(fn);
        continue;
      }
      const ty = this.type(true) ?? this.err(`unexpected '${this.peek().v}' in class ${c.name}`);
      if (this.peek().k === 'id' && this.is('(', 1)) {
        const n = this.next().v;
        const fn = this.fnRest(ty, n, l, isStatic);
        fn.owner = c;
        c.methods.push(fn);
        continue;
      }
      do {
        const d = this.declarator(ty);
        c.fields.push({ name: d.name, ty: d.ty, init: d.init, isStatic: isStatic || c.isInterface, line: l });
      } while (this.eat(','));
      this.expect(';');
    }
    this.cls = prevCls;
  }

  // ---------- statements ----------
  block(): { body: Stmt[]; end: number; line: number } {
    const line = this.expect('{').line;
    const body: Stmt[] = [];
    while (!this.is('}')) {
      if (this.peek().k === 'eof') this.err("missing '}' — the block opened here is never closed", line);
      body.push(this.stmt());
    }
    const end = this.next().line;
    return { body, end, line };
  }

  /** Is the cursor at a local declaration? Leaves the cursor in place. */
  declAhead(): boolean {
    const s = this.save();
    try {
      if (this.lang === 'java') this.skipModifiers();
      const ty = this.tryType();
      if (!ty) return false;
      const t = this.peek();
      if (this.lang === 'cpp' && (t.v === '*' || t.v === '&' || t.v === '&&')) return true;
      if (this.lang === 'cpp' && t.v === '[' && ty.name === 'auto') return true;
      if (t.k !== 'id') return false;
      const after = this.peek(1).v;
      return ['=', ';', ',', '(', '[', '{', ':'].includes(after);
    } finally {
      this.restore(s);
    }
  }

  localDecl(): Stmt {
    const line = this.line;
    let isStatic = false;
    if (this.lang === 'java') this.skipModifiers();
    if (this.is('static')) isStatic = true;
    const ty = this.type(true) ?? this.err('expected a type');
    const decls: Declarator[] = [];
    do decls.push(this.declarator(ty)); while (this.eat(','));
    return { k: 'decl', line, decls, isStatic };
  }

  stmt(): Stmt {
    const t = this.peek();
    const line = t.line;
    if (t.k === 'op' && t.v === '{') {
      const b = this.block();
      return { k: 'block', line, body: b.body, end: b.end };
    }
    if (t.k === 'op' && t.v === ';') {
      this.next();
      return { k: 'empty', line };
    }
    if (t.k === 'id') {
      switch (t.v) {
        case 'if': {
          this.next();
          if (this.is('constexpr')) this.next();
          this.expect('(');
          const c = this.condition();
          this.expect(')');
          const th = this.stmt();
          const el = this.eat('else') ? this.stmt() : undefined;
          return { k: 'if', line, c, t: th, f: el };
        }
        case 'while': {
          this.next();
          this.expect('(');
          const c = this.condition();
          this.expect(')');
          return { k: 'while', line, c, body: this.stmt() };
        }
        case 'do': {
          this.next();
          const body = this.stmt();
          const condLine = this.expect('while').line;
          this.expect('(');
          const c = this.expr();
          this.expect(')');
          this.expect(';');
          return { k: 'do', line, c, body, condLine };
        }
        case 'for':
          return this.forStmt();
        case 'switch':
          return this.switchStmt();
        case 'return': {
          this.next();
          if (this.eat(';')) return { k: 'return', line };
          const e = this.is('{') ? this.initList() : this.expr();
          this.expect(';');
          return { k: 'return', line, e };
        }
        case 'break':
        case 'continue': {
          this.next();
          const label = this.peek().k === 'id' ? this.next().v : undefined;
          this.expect(';');
          return { k: t.v, line, label };
        }
        case 'throw': {
          this.next();
          if (this.eat(';')) return { k: 'throw', line };
          const e = this.expr();
          this.expect(';');
          return { k: 'throw', line, e };
        }
        case 'try':
          return this.tryStmt();
        case 'goto':
          this.err('goto is not supported by the tracer');
          break;
        case 'class':
        case 'struct':
        case 'interface':
        case 'record':
          if (this.lang === 'java') {
            const c = this.javaClass(this.cls);
            this.localClasses.push(c);
            return { k: 'empty', line };
          }
          break;
        case 'using':
          if (this.lang === 'cpp') {
            this.cppTop({ lang: 'cpp', classes: [], functions: [], globals: [] });
            return { k: 'empty', line };
          }
          break;
        case 'typedef':
          if (this.lang === 'cpp') {
            this.cppTop({ lang: 'cpp', classes: [], functions: [], globals: [] });
            return { k: 'empty', line };
          }
      }
      if (this.peek(1).v === ':' && this.peek(1).k === 'op' && this.lang === 'java' && !this.isTypeName(t.v)) {
        this.next();
        this.next();
        return { k: 'label', line, label: t.v, body: this.stmt() };
      }
    }
    if (this.declAhead()) {
      const d = this.localDecl();
      this.expect(';');
      return d;
    }
    const e = this.exprList();
    this.expect(';', 'after the statement');
    return { k: 'expr', line, e };
  }

  localClasses: ClassDecl[] = [];
  inCaseLabel = false;

  /** condition of if/while; C++ allows a declaration there (if (auto it = m.find(x); ...) is not supported) */
  condition(): Expr {
    return this.expr();
  }

  forStmt(): Stmt {
    const line = this.next().line;
    this.expect('(');
    // range-for / enhanced for
    const s = this.save();
    if (this.lang === 'java') this.skipModifiers();
    const ty = this.tryType();
    if (ty) {
      let ok = false;
      let decl: Declarator | null = null;
      try {
        decl = this.declaratorNoInit(ty);
        ok = this.is(':');
      } catch (e) {
        if (!(e instanceof CompileError)) throw e;
      }
      if (ok && decl) {
        this.next();
        const e = this.is('{') ? this.initList() : this.expr();
        this.expect(')');
        return { k: 'foreach', line, decl, e, body: this.stmt() };
      }
    }
    this.restore(s);
    let init: Stmt | undefined;
    if (!this.is(';')) {
      if (this.declAhead()) init = this.localDecl();
      else init = { k: 'expr', line, e: this.exprList() };
    }
    this.expect(';');
    const c = this.is(';') ? undefined : this.expr();
    this.expect(';');
    const step = this.is(')') ? undefined : this.exprList();
    this.expect(')');
    return { k: 'for', line, init, c, step, body: this.stmt() };
  }

  declaratorNoInit(base: TypeNode): Declarator {
    const ty: TypeNode = { ...base };
    if (this.lang === 'cpp') {
      for (;;) {
        if (this.is('*')) {
          this.next();
          ty.ptr++;
        } else if (this.is('&') || this.is('&&')) {
          this.next();
          ty.ref = true;
        } else if (this.is('const')) this.next();
        else break;
      }
      if (this.is('[')) {
        this.next();
        const names: string[] = [];
        do names.push(this.ident()); while (this.eat(','));
        this.expect(']');
        return { name: names.join(','), ty, binding: names };
      }
    }
    return { name: this.ident(), ty };
  }

  switchStmt(): Stmt {
    const line = this.next().line;
    this.expect('(');
    const e = this.expr();
    this.expect(')');
    this.expect('{');
    const cases: { test: Expr | null; body: Stmt[]; line: number }[] = [];
    while (!this.eat('}')) {
      const l = this.line;
      let tests: (Expr | null)[] = [];
      if (this.eat('default')) tests = [null];
      else {
        this.expect('case');
        this.inCaseLabel = true; // `case UP -> …` is an arrow case, not a lambda
        try {
          do tests.push(this.ternary()); while (this.eat(','));
        } finally {
          this.inCaseLabel = false;
        }
      }
      if (this.is('->')) {
        // Java arrow case: no fall-through
        this.next();
        let body: Stmt[];
        if (this.is('{')) body = this.block().body;
        else if (this.is('throw')) body = [this.stmt()];
        else {
          const ex = this.expr();
          this.expect(';');
          body = [{ k: 'expr', line: l, e: ex }];
        }
        body.push({ k: 'break', line: l });
        tests.forEach((t, i) => cases.push({ test: t, body: i === tests.length - 1 ? body : [], line: l }));
        continue;
      }
      this.expect(':');
      const body: Stmt[] = [];
      while (!this.is('case') && !this.is('default') && !this.is('}')) body.push(this.stmt());
      tests.forEach((t, i) => cases.push({ test: t, body: i === tests.length - 1 ? body : [], line: l }));
    }
    return { k: 'switch', line, e, cases };
  }

  tryStmt(): Stmt {
    const line = this.next().line;
    if (this.is('(')) this.err('try-with-resources is not supported by the tracer');
    const b = this.block();
    const body: Stmt = { k: 'block', line, body: b.body, end: b.end };
    const catches: { ty: TypeNode | null; name?: string; body: Stmt; line: number }[] = [];
    while (this.is('catch')) {
      const l = this.next().line;
      this.expect('(');
      let ty: TypeNode | null = null;
      let name: string | undefined;
      if (this.is('...')) this.next();
      else {
        if (this.lang === 'java') this.skipModifiers();
        ty = this.type(true) ?? T(this.ident());
        while (this.eat('|')) this.type(true) ?? this.ident();
        if (this.peek().k === 'id') name = this.next().v;
        // multi-catch keeps the first type; matching treats unknown types as catch-all
        if (this.lang === 'java' && catches.length === 0 && this.toks[this.pos - 3]?.v === '|') ty = null;
      }
      this.expect(')');
      const cb = this.block();
      catches.push({ ty, name, body: { k: 'block', line: l, body: cb.body, end: cb.end }, line: l });
    }
    let fin: Stmt | undefined;
    if (this.eat('finally')) {
      const fb = this.block();
      fin = { k: 'block', line: fb.line, body: fb.body, end: fb.end };
    }
    return { k: 'try', line, body, catches, fin };
  }

  // ---------- expressions ----------
  exprList(): Expr {
    const line = this.line;
    const first = this.expr();
    if (!this.is(',')) return first;
    const items = [first];
    while (this.eat(',')) items.push(this.expr());
    return { k: 'comma', line, items };
  }

  expr(): Expr {
    return this.assign();
  }

  assign(): Expr {
    const a = this.ternary();
    const t = this.peek();
    if (t.k === 'op' && ['=', '+=', '-=', '*=', '/=', '%=', '&=', '|=', '^=', '<<=', '>>=', '>>>='].includes(t.v)) {
      this.next();
      const b = this.is('{') ? this.initList() : this.assign();
      return { k: 'assign', line: t.line, op: t.v, a, b };
    }
    return a;
  }

  ternary(): Expr {
    const c = this.binary(0);
    if (this.is('?')) {
      const line = this.next().line;
      const a = this.assign();
      this.expect(':');
      const b = this.assign();
      return { k: 'cond', line, c, a, b };
    }
    return c;
  }

  static PREC: Record<string, number> = {
    '||': 1, '&&': 2, '|': 3, '^': 4, '&': 5, '==': 6, '!=': 6,
    '<': 7, '>': 7, '<=': 7, '>=': 7, instanceof: 7,
    '<<': 8, '>>': 8, '>>>': 8, '+': 9, '-': 9, '*': 10, '/': 10, '%': 10,
  };

  binary(min: number): Expr {
    let a = this.unary();
    for (;;) {
      const t = this.peek();
      const p = t.k === 'op' || t.v === 'instanceof' ? Parser.PREC[t.v] : undefined;
      if (p === undefined || p <= min) return a;
      this.next();
      if (t.v === 'instanceof') {
        const ty = this.type(true) ?? T(this.ident());
        if (this.peek().k === 'id' && !Parser.PREC[this.peek().v]) this.next(); // pattern variable
        a = { k: 'instanceof', line: t.line, a, ty };
        continue;
      }
      const b = this.binary(p);
      a = { k: 'bin', line: t.line, op: t.v, a, b };
    }
  }

  unary(): Expr {
    const t = this.peek();
    const line = t.line;
    if (t.k === 'op') {
      switch (t.v) {
        case '!':
        case '~':
        case '-':
        case '+':
        case '++':
        case '--':
        case '*':
        case '&':
          this.next();
          return { k: 'un', line, op: t.v, a: this.unary() };
        case '(': {
          const s = this.save();
          this.next();
          const ty = this.tryType(true);
          if (ty && this.is(')')) {
            this.next();
            const n = this.peek();
            const startsOperand = n.k === 'id' || n.k === 'num' || n.k === 'str' || n.k === 'chr' || (n.k === 'op' && ['(', '!', '~', '-', '+', '*', '&', '++', '--'].includes(n.v));
            if (startsOperand) return { k: 'cast', line, ty, a: this.unary() };
          }
          this.restore(s);
        }
      }
    }
    if (t.k === 'id') {
      if (t.v === 'sizeof') {
        this.next();
        if (this.is('(')) {
          const s = this.save();
          this.next();
          const ty = this.tryType(true);
          if (ty && this.eat(')')) return { k: 'sizeof', line, ty };
          this.restore(s);
        }
        return { k: 'sizeof', line, a: this.unary() };
      }
      if (t.v === 'new') return this.postfix(this.newExpr());
      if (t.v === 'delete') {
        this.next();
        if (this.is('[')) {
          this.next();
          this.expect(']');
        }
        this.unary();
        return { k: 'null', line };
      }
    }
    return this.postfix(this.primary());
  }

  newExpr(): Expr {
    const line = this.next().line;
    let ty: TypeNode;
    if (this.lang === 'java') {
      const name = this.peek();
      if (name.k !== 'id') this.err('expected a type after new');
      // allow unknown class names (declared later or anonymous)
      ty = this.tryTypeNoArray() ?? (this.next(), T(name.v));
      if (this.is('<')) this.skipBalanced('<', '>');
    } else {
      ty = this.tryType(true) ?? T(this.ident('a type after new'));
    }
    if (this.is('[')) {
      const dims: Expr[] = [];
      let extra = 0;
      while (this.is('[')) {
        this.next();
        if (this.is(']')) {
          this.next();
          extra++;
          continue;
        }
        dims.push(this.expr());
        this.expect(']');
      }
      const init = this.is('{') ? this.initList() : undefined;
      return { k: 'new', line, ty: { ...ty, arr: dims.length + extra }, args: [], dims, init };
    }
    if (this.lang === 'cpp' && this.is('{')) {
      const init = this.initList();
      return { k: 'new', line, ty, args: [init], init };
    }
    let args: Expr[] = [];
    if (this.eat('(')) args = this.args(')');
    if (this.lang === 'java' && this.is('{')) {
      const c = this.newClass(`${ty.name}$anon${line}`, line, this.cls);
      c.base = ty.name;
      this.classBody(c);
      return { k: 'new', line, ty, args, body: c };
    }
    return { k: 'new', line, ty, args };
  }

  /** Java `new X<..>` without consuming [] (they are dimension expressions) */
  tryTypeNoArray(): TypeNode | null {
    const t = this.peek();
    if (t.k !== 'id' || !this.isTypeName(t.v)) return null;
    this.next();
    let name = t.v;
    if (this.is('.') && this.peek(1).k === 'id' && this.isTypeName(`${name}.${this.peek(1).v}`)) {
      this.next();
      name = `${name}.${this.next().v}`;
    }
    const ty: TypeNode = { ...T(normalize(name, 'java')), orig: name };
    if (this.is('<')) {
      this.next();
      const args: TypeNode[] = [];
      while (!this.is('>') && !this.is('>>') && !this.is('>>>')) {
        const a = this.tryType(true);
        if (!a) break;
        args.push(a);
        if (!this.eat(',')) break;
      }
      this.closeAngle();
      ty.args = args;
    }
    return ty;
  }

  postfix(e: Expr): Expr {
    for (;;) {
      const t = this.peek();
      if (t.k !== 'op') return e;
      switch (t.v) {
        case '(':
          this.next();
          e = { k: 'call', line: t.line, fn: e, args: this.args(')') };
          continue;
        case '[':
          this.next();
          e = { k: 'index', line: t.line, a: e, i: this.expr() };
          this.expect(']');
          continue;
        case '.':
        case '->': {
          if (t.v === '->' && this.lang === 'java') return e; // Java '->' is a lambda / switch arrow, never member access
          this.next();
          if (this.is('template')) this.next();
          if (this.is('<')) this.skipBalanced('<', '>'); // Java explicit generic call: Collections.<T>foo()
          const name = this.is('operator') ? this.operatorName() : this.ident('a member name');
          e = { k: 'member', line: t.line, a: e, name, arrow: t.v === '->' };
          continue;
        }
        case '++':
        case '--':
          this.next();
          e = { k: 'post', line: t.line, op: t.v, a: e };
          continue;
        case '::':
          if (this.lang === 'java') {
            this.next();
            const name = this.is('new') ? (this.next(), 'new') : this.ident();
            const owner = e.k === 'id' ? e.name : e.k === 'this' ? 'this' : e.k === 'scope' ? e.path.join('.') : '?';
            e = { k: 'mref', line: t.line, owner, name };
            continue;
          }
          return e;
        default:
          return e;
      }
    }
  }

  isLambdaAhead(): boolean {
    // Java: (a, b) -> ..., (int a) -> ..., () -> ...
    if (!this.is('(')) return false;
    let d = 0;
    for (let o = 0; ; o++) {
      const t = this.peek(o);
      if (t.k === 'eof') return false;
      if (t.v === '(') d++;
      if (t.v === ')') {
        d--;
        if (d === 0) return this.peek(o + 1).v === '->';
      }
    }
  }

  lambdaBody(): Stmt[] | Expr {
    if (this.is('{')) return this.block().body;
    return this.expr();
  }

  primary(): Expr {
    const t = this.peek();
    const line = t.line;
    switch (t.k) {
      case 'num': {
        this.next();
        let v: number | bigint;
        if (t.float) v = parseFloat(t.v);
        else if (/^0[xX]/.test(t.v)) v = Number(BigInt(t.v));
        else if (/^0[bB]/.test(t.v)) v = Number(BigInt(t.v));
        else if (/^0[0-7]+$/.test(t.v)) v = parseInt(t.v, 8);
        else v = Number(t.v);
        if (!t.float && (t.long || !Number.isSafeInteger(v) || Math.abs(v as number) > 2147483647)) {
          const big = t.float ? BigInt(Math.trunc(v as number)) : /^0[0-7]+$/.test(t.v) ? BigInt('0o' + t.v.slice(1)) : BigInt(t.v);
          return { k: 'num', line, v: big, float: false };
        }
        return { k: 'num', line, v, float: !!t.float };
      }
      case 'str': {
        this.next();
        let v = t.v;
        while (this.peek().k === 'str') v += this.next().v; // "a" "b" concatenation
        return { k: 'str', line, v };
      }
      case 'chr':
        this.next();
        return { k: 'chr', line, v: t.v };
      case 'op':
        if (t.v === '(') {
          if (this.lang === 'java' && this.isLambdaAhead()) {
            const params: Param[] = [];
            this.next();
            if (!this.eat(')')) {
              do {
                this.skipModifiers();
                const ty = this.peek(1).k === 'id' ? this.tryType(true) : null;
                params.push({ name: this.ident(), ty });
              } while (this.eat(','));
              this.expect(')');
            }
            this.expect('->');
            return { k: 'lambda', line, params, body: this.lambdaBody() };
          }
          this.next();
          const e = this.exprList();
          this.expect(')');
          return e;
        }
        if (t.v === '[' && this.lang === 'cpp') return this.cppLambda();
        if (t.v === '{' && this.lang === 'cpp') return this.initList();
        if (t.v === '::') {
          this.next();
          return this.primary();
        }
        break;
      case 'id': {
        let w = t.v;
        // fully-qualified Java names: java.util.Arrays.sort(...) → Arrays.sort(...)
        if (this.lang === 'java' && (w === 'java' || w === 'javax') && this.is('.', 1)) {
          this.next();
          while (this.is('.') && this.peek(1).k === 'id' && /^[a-z]/.test(this.peek(1).v)) {
            this.next();
            this.next();
          }
          this.expect('.');
          const cls = this.peek();
          if (cls.k !== 'id') this.err('expected a class name after the package');
          w = cls.v;
          this.next();
          return { k: 'id', line, name: w };
        }
        if (this.lang === 'java' && this.is('->', 1) && !this.inCaseLabel) {
          this.next();
          this.next();
          return { k: 'lambda', line, params: [{ name: w, ty: null }], body: this.lambdaBody() };
        }
        switch (w) {
          case 'true':
          case 'false':
            this.next();
            return { k: 'bool', line, v: w === 'true' };
          case 'nullptr':
          case 'NULL':
          case 'null':
            this.next();
            return { k: 'null', line };
          case 'this':
            this.next();
            return { k: 'this', line };
          case 'static_cast':
          case 'dynamic_cast':
          case 'reinterpret_cast':
          case 'const_cast': {
            this.next();
            this.expect('<');
            const ty = this.type(true) ?? this.err('expected a type');
            this.closeAngle();
            this.expect('(');
            const a = this.expr();
            this.expect(')');
            return { k: 'cast', line, ty, a };
          }
        }
        if (this.lang === 'cpp' && w === 'std' && this.is('::', 1)) {
          this.next();
          this.next();
          return this.primary();
        }
        if (this.lang === 'cpp') {
          // template function calls: get<0>(t), max<int>(a, b), numeric_limits<int>::max()
          if ((w === 'get' || w === 'max' || w === 'min' || w === 'swap' || w === 'make_pair' || w === 'numeric_limits' || w === 'accumulate' || this.templateFns.has(w)) && this.is('<', 1)) {
            const s = this.save();
            this.next();
            this.next();
            const targs: TypeNode[] = [];
            let index: Expr | undefined;
            try {
              do {
                const ty = this.tryType(true);
                if (ty) targs.push(ty);
                else index = this.binary(7);
              } while (this.eat(','));
              this.closeAngle();
              if (w === 'numeric_limits') {
                this.expect('::');
                const m = this.ident();
                return { k: 'scope', line, path: ['numeric_limits', m], targs };
              }
              if (this.is('(')) {
                const path = index ? [w, String(index.k === 'num' ? index.v : 0)] : [w];
                return { k: 'scope', line, path, targs };
              }
            } catch (e) {
              if (!(e instanceof CompileError)) throw e;
            }
            this.restore(s);
          }
          // functional cast / temporary: vector<int>(n), pair<int,int>(a, b), Node(5), greater<int>(), string(3, 'a')
          if (this.isTypeName(w) || ['unsigned', 'long', 'short', 'signed'].includes(w)) {
            const s = this.save();
            const ty = this.tryType(true);
            if (ty && (this.is('(') || this.is('{'))) {
              const brace = this.is('{');
              this.next();
              const args = this.args(brace ? '}' : ')');
              return { k: 'construct', line, ty, args, brace };
            }
            this.restore(s);
          }
          this.next();
          if (this.is('::') && this.peek(1).k === 'id') {
            const path = [w];
            while (this.is('::') && this.peek(1).k === 'id') {
              this.next();
              path.push(this.next().v);
            }
            return { k: 'scope', line, path };
          }
          return { k: 'id', line, name: w };
        }
        this.next();
        return { k: 'id', line, name: w };
      }
    }
    this.err(t.k === 'eof' ? 'unexpected end of code — is a bracket or semicolon missing?' : `unexpected '${t.v}'`);
  }

  cppLambda(): Expr {
    const line = this.expect('[').line;
    while (!this.is(']')) this.next(); // captures: everything is captured by reference
    this.next();
    let params: Param[] = [];
    if (this.is('(')) params = this.params();
    let ret: TypeNode | undefined;
    for (;;) {
      if (this.is('mutable') || this.is('noexcept') || this.is('constexpr')) this.next();
      else if (this.is('->')) {
        this.next();
        ret = this.type(true) ?? undefined;
      } else break;
    }
    const body = this.block().body;
    return { k: 'lambda', line, params, body, ret };
  }
}

export function parse(src: string, lang: CLang): Program {
  const p = new Parser(src, lang);
  const prog = p.program();
  if (lang === 'java') prog.classes.push(...p.localClasses);
  return prog;
}

export type { FieldDecl };
