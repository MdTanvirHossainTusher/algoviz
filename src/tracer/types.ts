/** Language-neutral encoding of a runtime value, produced by both the Python and JS tracers. */
export type TVal =
  | { t: 'num'; v: number }
  | { t: 'str'; v: string }
  | { t: 'bool'; v: boolean }
  | { t: 'none'; v: string }
  | { t: 'list'; kind: string; items: TVal[]; more?: number }
  | { t: 'dict'; kind: string; cls?: string; entries: [string, TVal][]; more?: number }
  | { t: 'ref'; label: string }
  | { t: 'fn'; name: string }
  | { t: 'other'; repr: string };

export interface TFrame {
  name: string;
  line: number;
  locals: Record<string, TVal>;
}

export interface TStep {
  line: number;
  event: 'line' | 'call' | 'return' | 'exception';
  /** outermost first */
  frames: TFrame[];
  stdout: string;
  ret?: TVal;
  error?: string;
}

export interface TraceResult {
  steps: TStep[];
  error?: { msg: string; line?: number | null };
  truncated?: boolean;
  stdout: string;
}

export type Lang = 'python' | 'javascript' | 'cpp' | 'java';

export const LANG_LABEL: Record<Lang, string> = { python: 'Python', javascript: 'JavaScript', cpp: 'C++', java: 'Java' };

export const MAX_STEPS = 2000;
