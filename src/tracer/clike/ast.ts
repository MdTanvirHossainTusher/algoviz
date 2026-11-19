/** A (possibly generic) type as written in the source. `name` is normalized: int, long, double, char, bool, string, void, auto, or a class/library name. */
export interface TypeNode {
  name: string;
  args: TypeNode[];
  /** pointer depth (C++) */
  ptr: number;
  /** C++ reference (&, &&) */
  ref: boolean;
  /** array dimensions: Java `int[][]`, C++ `int a[3][4]` (sizes in `dims`) */
  arr: number;
  dims?: (Expr | null)[];
  /** template value argument, e.g. array<int, 5> */
  value?: Expr;
  /** the name as written, before normalization (Integer, long long, ...) */
  orig?: string;
}

export type Expr =
  | { k: 'num'; line: number; v: number | bigint; float: boolean }
  | { k: 'str'; line: number; v: string }
  | { k: 'chr'; line: number; v: string }
  | { k: 'bool'; line: number; v: boolean }
  | { k: 'null'; line: number }
  | { k: 'this'; line: number }
  | { k: 'id'; line: number; name: string }
  /** `Foo::bar`, `std::max`, `Map.Entry` style qualified names that are not member accesses */
  | { k: 'scope'; line: number; path: string[]; targs?: TypeNode[] }
  | { k: 'bin'; line: number; op: string; a: Expr; b: Expr }
  | { k: 'un'; line: number; op: string; a: Expr }
  | { k: 'post'; line: number; op: string; a: Expr }
  | { k: 'assign'; line: number; op: string; a: Expr; b: Expr }
  | { k: 'cond'; line: number; c: Expr; a: Expr; b: Expr }
  | { k: 'call'; line: number; fn: Expr; args: Expr[] }
  | { k: 'index'; line: number; a: Expr; i: Expr }
  | { k: 'member'; line: number; a: Expr; name: string; arrow: boolean }
  | { k: 'cast'; line: number; ty: TypeNode; a: Expr }
  /** C++ functional cast / temporary construction: vector<int>(3), pair<int,int>{1,2}, Node(5) */
  | { k: 'construct'; line: number; ty: TypeNode; args: Expr[]; brace: boolean }
  | { k: 'new'; line: number; ty: TypeNode; args: Expr[]; dims?: Expr[]; init?: Expr; body?: ClassDecl }
  | { k: 'init'; line: number; items: Expr[] }
  | { k: 'lambda'; line: number; params: Param[]; body: Stmt[] | Expr; ret?: TypeNode }
  | { k: 'mref'; line: number; owner: string; name: string }
  | { k: 'sizeof'; line: number; a?: Expr; ty?: TypeNode }
  | { k: 'instanceof'; line: number; a: Expr; ty: TypeNode }
  | { k: 'comma'; line: number; items: Expr[] }
  /** an already-evaluated runtime value (used when library code calls back into the interpreter) */
  | { k: 'lit'; line: number; v: unknown };

export interface Param {
  name: string;
  ty: TypeNode | null;
  def?: Expr;
}

export interface Declarator {
  name: string;
  ty: TypeNode;
  init?: Expr;
  /** C++ `T x(a, b)` constructor arguments */
  ctorArgs?: Expr[];
  /** C++ structured binding names: auto [a, b] = ... */
  binding?: string[];
}

export type Stmt =
  | { k: 'block'; line: number; body: Stmt[]; end: number }
  | { k: 'expr'; line: number; e: Expr }
  | { k: 'decl'; line: number; decls: Declarator[]; isStatic?: boolean }
  | { k: 'if'; line: number; c: Expr; t: Stmt; f?: Stmt }
  | { k: 'while'; line: number; c: Expr; body: Stmt }
  | { k: 'do'; line: number; c: Expr; body: Stmt; condLine: number }
  | { k: 'for'; line: number; init?: Stmt; c?: Expr; step?: Expr; body: Stmt }
  | { k: 'foreach'; line: number; decl: Declarator; e: Expr; body: Stmt }
  | { k: 'switch'; line: number; e: Expr; cases: { test: Expr | null; body: Stmt[]; line: number }[] }
  | { k: 'return'; line: number; e?: Expr }
  | { k: 'break'; line: number; label?: string }
  | { k: 'continue'; line: number; label?: string }
  | { k: 'throw'; line: number; e?: Expr }
  | { k: 'try'; line: number; body: Stmt; catches: { ty: TypeNode | null; name?: string; body: Stmt; line: number }[]; fin?: Stmt }
  | { k: 'label'; line: number; label: string; body: Stmt }
  | { k: 'empty'; line: number };

export interface FnDecl {
  name: string;
  ret: TypeNode | null;
  params: Param[];
  body: Stmt[] | null;
  line: number;
  end: number;
  isStatic: boolean;
  /** C++ constructor initializer list */
  inits?: { name: string; args: Expr[] }[];
  owner?: ClassDecl;
  variadic?: boolean;
}

export interface FieldDecl {
  name: string;
  ty: TypeNode;
  init?: Expr;
  ctorArgs?: Expr[];
  isStatic: boolean;
  line: number;
}

export interface ClassDecl {
  name: string;
  base?: string;
  fields: FieldDecl[];
  methods: FnDecl[];
  ctors: FnDecl[];
  inner: ClassDecl[];
  staticInit: Stmt[];
  isInterface: boolean;
  isEnum?: boolean;
  enumConsts?: { name: string; args: Expr[] }[];
  line: number;
  outer?: ClassDecl;
}

export interface Program {
  lang: 'cpp' | 'java';
  classes: ClassDecl[];
  functions: FnDecl[];
  globals: Stmt[];
}

export const T = (name: string, args: TypeNode[] = []): TypeNode => ({ name, args, ptr: 0, ref: false, arr: 0 });
