import { useEffect, useMemo, useRef, useState } from 'react';
import CodeMirror from '@uiw/react-codemirror';
import { python } from '@codemirror/lang-python';
import { javascript } from '@codemirror/lang-javascript';
import type { Lang, TraceResult, TFrame, TStep } from '../tracer/types';
import { MAX_STEPS } from '../tracer/types';
import { runTrace, warmPython, type Status } from '../tracer/run';
import { examples, defaultExample } from '../tracer/examples';
import { explain, indexPointers } from '../tracer/explain';
import { ValueView } from '../tracer/ValueView';
import { highlightLine } from '../tracer/highlight';
import { usePlayer, usePlayerKeys } from '../lib/usePlayer';
import { Timeline, PlayButtons, KeyHint } from '../components/PlayerControls';
import { IconCode, IconNext, IconPlay, IconPrev } from '../components/Icons';

const DRAFT_KEY = 'tracer-draft-v1';

function loadDraft(): { lang: Lang; code: string; stdin: string } | null {
  try {
    const raw = localStorage.getItem(DRAFT_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

/** Follows the app theme (explicit toggle or OS preference) so the editor colours stay readable. */
function useIsDark() {
  const get = () => {
    const t = document.documentElement.dataset.theme;
    return t ? t === 'dark' : matchMedia('(prefers-color-scheme: dark)').matches;
  };
  const [dark, setDark] = useState(get);
  useEffect(() => {
    const obs = new MutationObserver(() => setDark(get()));
    obs.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });
    const mq = matchMedia('(prefers-color-scheme: dark)');
    const onMq = () => setDark(get());
    mq.addEventListener('change', onMq);
    return () => {
      obs.disconnect();
      mq.removeEventListener('change', onMq);
    };
  }, []);
  return dark;
}

function FrameView({ f, prev, top, lang, showFns }: { f: TFrame; prev?: TFrame; top: boolean; lang: Lang; showFns: boolean }) {
  const entries = Object.entries(f.locals).filter(([, v]) => showFns || v.t !== 'fn');
  return (
    <div className={`frame ${top ? 'top' : ''}`}>
      <div className="frame-h">
        <span>{f.name === 'global' ? 'Global frame' : `${f.name}()`}</span>
        <span className="muted">line {f.line}</span>
      </div>
      <div className="frame-b">
        {entries.length === 0 && (
          <span className="muted" style={{ fontSize: 11 }}>
            {Object.keys(f.locals).length ? 'only function definitions so far (tick "show functions")' : 'no variables yet'}
          </span>
        )}
        {entries.map(([k, v]) => {
          const pv = prev?.locals[k];
          const changed = prev !== undefined && JSON.stringify(pv) !== JSON.stringify(v);
          const ptrs = v.t === 'list' ? indexPointers(f, v.items.length) : undefined;
          return (
            <div className="vrow" key={k}>
              <div className={`vname ${changed ? 'changed' : ''}`}>{k}</div>
              <div className="vval">
                <ValueView v={v} prev={prev ? (pv ?? { t: 'none', v: '' }) : undefined} pointers={ptrs} lang={lang} />
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function matchPrevFrame(prev: TStep | undefined, i: number, f: TFrame) {
  const p = prev?.frames[i];
  return p && p.name === f.name ? p : undefined;
}

export default function TracerPage() {
  const draft = useMemo(loadDraft, []);
  const [lang, setLang] = useState<Lang>(draft?.lang ?? 'python');
  const [code, setCode] = useState(draft?.code ?? defaultExample('python').code);
  const [stdin, setStdin] = useState(draft?.stdin ?? '');
  const [status, setStatus] = useState<Status>('idle');
  const [result, setResult] = useState<TraceResult | null>(null);
  const [tracedCode, setTracedCode] = useState<string[]>([]);
  const [tracedLang, setTracedLang] = useState<Lang>('python');
  const [mode, setMode] = useState<'edit' | 'trace'>('edit');
  const [showFns, setShowFns] = useState(false);
  const [showStdin, setShowStdin] = useState(!!draft?.stdin);
  const codeRef = useRef<HTMLDivElement>(null);
  const dark = useIsDark();

  useEffect(() => {
    document.title = 'Code Tracer · AlgoTrace';
  }, []);

  useEffect(() => {
    if (lang === 'python') warmPython(setStatus);
  }, [lang]);

  useEffect(() => {
    const t = setTimeout(() => {
      try {
        localStorage.setItem(DRAFT_KEY, JSON.stringify({ lang, code, stdin }));
      } catch {
        /* storage unavailable */
      }
    }, 400);
    return () => clearTimeout(t);
  }, [lang, code, stdin]);

  const steps = result?.steps ?? [];
  const p = usePlayer(steps.length, result, false);
  usePlayerKeys(p, mode === 'trace');
  const step = steps[p.idx];
  const prevStep = steps[p.idx - 1];
  const ex = useMemo(() => (step ? explain(steps, p.idx, tracedCode, tracedLang) : null), [steps, p.idx, tracedCode, tracedLang, step]);

  useEffect(() => {
    if (mode !== 'trace' || !step) return;
    codeRef.current?.querySelector('.ln.cur')?.scrollIntoView({ block: 'nearest' });
  }, [mode, step]);

  const run = async () => {
    setResult(null);
    const r = await runTrace(lang, code, stdin, setStatus);
    setTracedCode(code.split('\n'));
    setTracedLang(lang);
    setResult(r);
    setMode(r.steps.length ? 'trace' : 'edit');
  };

  const pickExample = (title: string) => {
    const e = examples.find((x) => x.title === title);
    if (!e) return;
    setLang(e.lang);
    setCode(e.code);
    setStdin(e.stdin ?? '');
    setShowStdin(!!e.stdin);
    setResult(null);
    setMode('edit');
  };

  const switchLang = (l: Lang) => {
    if (l === lang) return;
    setLang(l);
    setCode(defaultExample(l).code);
    setStdin('');
    setResult(null);
    setMode('edit');
  };

  const extensions = useMemo(() => [lang === 'python' ? python() : javascript()], [lang]);
  const busy = status !== 'idle';
  const errLine = result?.error?.line ?? undefined;

  return (
    <div className="tracer">
      <div className="col">
        <div>
          <div className="crumbs">Code Tracer</div>
          <div className="title-row">
            <h1>Step through your own code</h1>
          </div>
          <p className="lede">
            Paste a solution, press Run, then walk through it line by line. You see every variable, array index, call frame and printed line. It all runs in your browser; your code is never uploaded.
          </p>
        </div>

        <div className="card">
          <div className="editor-head">
            <div className="seg" role="tablist" aria-label="Language">
              <button className={lang === 'python' ? 'on' : ''} onClick={() => switchLang('python')}>
                Python
              </button>
              <button className={lang === 'javascript' ? 'on' : ''} onClick={() => switchLang('javascript')}>
                JavaScript
              </button>
            </div>
            <select className="select" style={{ width: 'auto', maxWidth: 260 }} value="" onChange={(e) => pickExample(e.target.value)} aria-label="Load an example">
              <option value="">Load an example…</option>
              {examples
                .filter((e) => e.lang === lang)
                .map((e) => (
                  <option key={e.title} value={e.title}>
                    {e.title}
                  </option>
                ))}
            </select>
            <span style={{ flex: 1 }} />
            {mode === 'trace' ? (
              <button className="btn" onClick={() => setMode('edit')}>
                <IconCode /> Edit code
              </button>
            ) : (
              <button className="btn primary" onClick={run} disabled={busy || !code.trim()}>
                {busy ? <span className="spinner" /> : <IconPlay />} {status === 'loading-python' ? 'Loading Python…' : status === 'running' ? 'Running…' : 'Run & trace'}
              </button>
            )}
          </div>

          {mode === 'edit' ? (
            <>
              <div className="cm-wrap">
                <CodeMirror value={code} height="380px" extensions={extensions} onChange={setCode} basicSetup={{ foldGutter: false, highlightActiveLine: true }} theme={dark ? 'dark' : 'light'} />
              </div>
              <div style={{ marginTop: 8 }}>
                <button className="btn ghost" onClick={() => setShowStdin((s) => !s)}>
                  {showStdin ? '▾' : '▸'} Standard input {stdin ? `(${stdin.split('\n').length} lines)` : ''}
                </button>
                {showStdin && (
                  <textarea className="textarea" rows={3} value={stdin} onChange={(e) => setStdin(e.target.value)} placeholder={lang === 'python' ? 'Lines returned by input()' : "Text returned by require('fs').readFileSync(0) / input()"} spellCheck={false} style={{ marginTop: 6 }} />
                )}
              </div>
            </>
          ) : (
            <div className="code trace-code" ref={codeRef}>
              {tracedCode.map((l, i) => {
                const no = i + 1;
                const cur = step?.line === no;
                const prev = !cur && prevStep?.line === no;
                return (
                  <div key={i} className={`ln ${cur ? 'cur' : prev ? 'prev' : ''}`} style={errLine === no && step?.event === 'exception' ? { background: 'var(--rose)' } : undefined}>
                    <span className="arrow-mark">{cur ? '➜' : prev ? '·' : ''}</span>
                    <span className="no">{no}</span>
                    <span>{highlightLine(l, tracedLang)}</span>
                  </div>
                );
              })}
            </div>
          )}

          {result?.error && (
            <div className="preset-note" style={{ background: 'var(--rose)', borderColor: 'var(--rust)', marginTop: 10 }}>
              <b>{result.error.msg}</b>
              {result.error.line ? ` — line ${result.error.line}` : ''}
            </div>
          )}
          {result?.truncated && !result.error && (
            <div className="preset-note" style={{ marginTop: 10 }}>
              Showing the first {MAX_STEPS} steps; the program kept running after that. Try a smaller input to see the end.
            </div>
          )}
          {mode === 'edit' && !result && (
            <div className="tip" style={{ marginTop: 10 }}>
              Tip: call your function at the bottom of the file, e.g. <code>print(solve([3, -1, 2]))</code>. Edge-case calls (empty input, negatives, missing values) are great to trace. Python runs on Pyodide, which downloads about 10 MB the first time.
            </div>
          )}
        </div>

        {mode === 'trace' && steps.length > 0 && <Timeline p={p} total={steps.length} label="Execution" />}
      </div>

      <div className="col">
        {mode === 'trace' && step && ex ? (
          <>
            <div className="card">
              <div className="step-head">
                <span className="eyebrow">
                  Step {p.idx + 1} / {steps.length}
                </span>
                <PlayButtons p={p} total={steps.length} />
              </div>
              <div className="explain" aria-live="polite">
                {ex.headline}
              </div>
              {prevStep && (ex.changes.length > 0 || ex.printed) && (
                <>
                  <div className="eyebrow" style={{ marginTop: 10 }}>
                    What line {prevStep.line} just did
                  </div>
                  <ul className="changes">
                    {ex.changes.map((c, i) => (
                      <li key={i}>{c}</li>
                    ))}
                    {ex.printed && <li>printed {JSON.stringify(ex.printed.replace(/\n$/, ''))}</li>}
                  </ul>
                </>
              )}
              {prevStep && !ex.changes.length && !ex.printed && step.event === 'line' && (
                <div className="muted" style={{ marginTop: 6, fontSize: 12 }}>
                  Line {prevStep.line} changed no variables (a condition check, call or control flow).
                </div>
              )}
              <div className="nav-btns">
                <button className="btn" onClick={p.prev} disabled={p.idx === 0}>
                  <IconPrev /> Back
                </button>
                <button className="btn primary" onClick={p.next} disabled={p.idx >= steps.length - 1}>
                  Next <IconNext />
                </button>
              </div>
              <KeyHint />
            </div>

            <div className="card">
              <div className="step-head">
                <span className="eyebrow">Frames & variables</span>
                <label className="muted" style={{ fontSize: 11, display: 'flex', gap: 5, alignItems: 'center' }}>
                  <input type="checkbox" checked={showFns} onChange={(e) => setShowFns(e.target.checked)} /> show functions
                </label>
              </div>
              <div className="frames">
                {step.frames.length === 0 && <span className="muted">No frames, because the program ended with an error.</span>}
                {[...step.frames]
                  .map((f, i) => ({ f, i }))
                  .reverse()
                  .map(({ f, i }) => (
                    <FrameView key={`${i}-${f.name}`} f={f} prev={matchPrevFrame(prevStep, i, f)} top={i === step.frames.length - 1} lang={tracedLang} showFns={showFns} />
                  ))}
              </div>
              {step.event === 'return' && step.ret && (
                <div className="preset-note" style={{ marginTop: 10 }}>
                  ↩ return value: <ValueView v={step.ret} lang={tracedLang} />
                </div>
              )}
            </div>

            <div className="card">
              <span className="eyebrow">Output</span>
              <div className="console" style={{ marginTop: 6 }}>
                {step.stdout ? (
                  <>
                    {prevStep && step.stdout.startsWith(prevStep.stdout) ? (
                      <>
                        {prevStep.stdout}
                        <span className="new">{step.stdout.slice(prevStep.stdout.length)}</span>
                      </>
                    ) : (
                      step.stdout
                    )}
                  </>
                ) : (
                  <span style={{ opacity: 0.5 }}>(nothing printed yet)</span>
                )}
                {step.error && <div className="err">{step.error}</div>}
              </div>
            </div>
          </>
        ) : (
          <div className="card">
            <span className="eyebrow">How it works</span>
            <ol className="changes" style={{ marginTop: 8, lineHeight: 1.7 }}>
              <li>Write or paste a program in Python or JavaScript, or load an example.</li>
              <li>
                Press <b>Run & trace</b>. Every executed line, function call and return value is recorded (up to {MAX_STEPS} steps).
              </li>
              <li>
                Step with <span className="kbd">←</span> <span className="kbd">→</span> or press play. Changed values flash amber, and index variables such as <code>i</code>, <code>lo</code> and <code>mid</code> appear as pointers under arrays.
              </li>
              <li>Recursion shows one frame per call, so you can watch the call stack grow and unwind.</li>
            </ol>
            <div className="tip" style={{ marginTop: 10 }}>
              Supported: functions, recursion, classes, lists/dicts/sets, Maps, 2-D grids, <code>input()</code> and stdin. Limits: 2000 steps and a few seconds of run time. Async code and network or file access are not traced.
            </div>
            {result && !result.steps.length && !result.error && <div className="preset-note" style={{ marginTop: 10 }}>The program ran but executed no traceable lines.</div>}
            {result && result.stdout && !result.steps.length && (
              <div className="console" style={{ marginTop: 10 }}>
                {result.stdout}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
