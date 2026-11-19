import type { ReactNode } from 'react';
import type { Lang } from './types';

const KW: Record<Lang, Set<string>> = {
  python: new Set('def return if elif else for while in not and or is None True False class import from as with try except finally raise break continue pass lambda yield global nonlocal del assert'.split(' ')),
  javascript: new Set('function return if else for while do in of const let var new class extends super this null undefined true false import export from try catch finally throw break continue switch case default typeof instanceof delete void yield async await'.split(' ')),
  cpp: new Set('int long short double float char bool void auto unsigned signed const constexpr static struct class public private protected return if else for while do switch case default break continue new delete this nullptr true false using namespace template typename include define vector string map set pair try catch throw sizeof'.split(' ')),
  java: new Set('int long short byte double float char boolean void var final static public private protected class interface extends implements return if else for while do switch case default break continue new this super null true false import package try catch finally throw throws instanceof'.split(' ')),
};

const REST = String.raw`|("(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*'|` + '`(?:[^`\\\\]|\\\\.)*`' + String.raw`)|(\b\d+(?:\.\d+)?\b)|([A-Za-z_$][\w$]*)(?=\s*\()|([A-Za-z_$][\w$]*)`;
const TOKEN: Record<Lang, RegExp> = {
  python: new RegExp(String.raw`(#.*$)` + REST, 'g'),
  javascript: new RegExp(String.raw`(\/\/.*$)` + REST, 'g'),
  cpp: new RegExp(String.raw`(\/\/.*$|^\s*#.*$)` + REST, 'g'),
  java: new RegExp(String.raw`(\/\/.*$)` + REST, 'g'),
};

/** Tiny single-line highlighter — good enough for the read-only trace view. */
export function highlightLine(line: string, lang: Lang): ReactNode[] {
  const out: ReactNode[] = [];
  let last = 0;
  let m: RegExpExecArray | null;
  const re = TOKEN[lang];
  re.lastIndex = 0;
  while ((m = re.exec(line))) {
    if (m.index > last) out.push(line.slice(last, m.index));
    const [tok, com, s, n, fn, id] = m;
    const k = out.length;
    if (com) out.push(<span key={k} className="tok-com">{tok}</span>);
    else if (s) out.push(<span key={k} className="tok-str">{tok}</span>);
    else if (n) out.push(<span key={k} className="tok-num">{tok}</span>);
    else if (fn) out.push(KW[lang].has(fn) ? <span key={k} className="tok-kw">{tok}</span> : <span key={k} className="tok-fn">{tok}</span>);
    else if (id && KW[lang].has(id)) out.push(<span key={k} className="tok-kw">{tok}</span>);
    else out.push(tok);
    last = m.index + tok.length;
  }
  if (last < line.length) out.push(line.slice(last));
  return out;
}
