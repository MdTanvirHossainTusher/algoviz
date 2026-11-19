import { CompileError, type CLang } from './lexer';
import { parse } from './parser';
import { Interp, type RunOpts } from './interp';
import type { TraceResult } from '../types';

/** Parse and run C++ or Java source, recording a step per executed statement. */
export function traceCLike(code: string, lang: CLang, opts: RunOpts): TraceResult {
  let prog;
  try {
    prog = parse(code, lang);
  } catch (err) {
    if (err instanceof CompileError) return { steps: [], stdout: '', error: { msg: `Compile error: ${err.message}`, line: err.line } };
    return { steps: [], stdout: '', error: { msg: `Compile error: ${(err as Error).message}` } };
  }
  return new Interp(prog, opts).run();
}
