import { useEffect, useMemo, useState } from 'react';
import type { Algorithm, InputField, Params, Preset, Step } from '../lib/types';
import { categoryOf } from '../algorithms';
import { usePlayer, usePlayerKeys } from '../lib/usePlayer';
import { ViewRenderer, Legend } from '../components/viz/Viz';
import { PlayButtons, Timeline, KeyHint } from '../components/PlayerControls';
import { IconNext, IconPrev, IconShuffle } from '../components/Icons';

const MAX_LEN = 24;

const toText = (v: Params[string] | undefined) => (Array.isArray(v) ? v.join(', ') : v === undefined ? '' : String(v));

/** Parse the form; returns params or a per-field error map. Empty arrays are allowed — they are edge cases. */
function parseForm(fields: InputField[], form: Record<string, string>): { params?: Params; errors: Record<string, string> } {
  const errors: Record<string, string> = {};
  const params: Params = {};
  for (const f of fields) {
    const raw = form[f.key] ?? '';
    if (f.kind === 'numbers') {
      const toks = raw.split(/[\s,;]+/).filter(Boolean);
      const vals = toks.map(Number);
      const bad = toks.filter((_, i) => !Number.isFinite(vals[i]));
      if (bad.length) errors[f.key] = `Not a number: ${bad.slice(0, 3).join(', ')}`;
      else if (vals.length > MAX_LEN) errors[f.key] = `At most ${MAX_LEN} values (got ${vals.length})`;
      else params[f.key] = vals;
    } else if (f.kind === 'number') {
      const t = raw.trim();
      const v = Number(t);
      if (!t || !Number.isFinite(v)) errors[f.key] = 'Enter a number';
      else if (f.min !== undefined && v < f.min) errors[f.key] = `Minimum is ${f.min}`;
      else if (f.max !== undefined && v > f.max) errors[f.key] = `Maximum is ${f.max}`;
      else params[f.key] = v;
    } else {
      params[f.key] = raw;
    }
  }
  return Object.keys(errors).length ? { errors } : { params, errors };
}

function safeRun(algo: Algorithm, params: Params): Step[] {
  try {
    const s = algo.run(params);
    return s.length ? s : [{ msg: 'No steps for this input.', views: [] }];
  } catch (e) {
    return [{ msg: `This input broke the visualizer: ${(e as Error).message}`, views: [] }];
  }
}

export function AlgorithmPage({ algo }: { algo: Algorithm }) {
  const cat = categoryOf(algo);
  const [params, setParams] = useState<Params>(algo.defaults);
  const [form, setForm] = useState<Record<string, string>>({});
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [preset, setPreset] = useState<Preset | null>(null);

  const loadParams = (p: Params, pr: Preset | null = null) => {
    setParams(p);
    setForm(Object.fromEntries(algo.fields.map((f) => [f.key, toText(p[f.key])])));
    setErrors({});
    setPreset(pr);
  };

  useEffect(() => {
    loadParams(algo.defaults);
    document.title = `${algo.name} · AlgoTrace`;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [algo]);

  const steps = useMemo(() => safeRun(algo, params), [algo, params]);
  const p = usePlayer(steps.length, steps);
  usePlayerKeys(p);
  const step = steps[p.idx];
  const prevLine = p.idx > 0 ? steps[p.idx - 1].line : undefined;

  const apply = () => {
    const r = parseForm(algo.fields, form);
    setErrors(r.errors);
    if (r.params) {
      setParams(r.params);
      setPreset(null);
    }
  };

  const idxInCat = cat.items.indexOf(algo);
  const statEntries = Object.entries(step.stats ?? {});

  return (
    <>
      <main className="main">
        <div>
          <div className="crumbs">
            <a href="/">{cat.name}</a> <span>/</span> <span>
              {idxInCat + 1} of {cat.items.length}
            </span>
          </div>
          <div className="title-row">
            <h1>{algo.name}</h1>
            <div className="chips">
              <span className="chip">⏱ {algo.time.avg}</span>
              <span className="chip green">{algo.difficulty}</span>
              <span className="chip violet">{steps.length} steps</span>
            </div>
          </div>
          <p className="lede">{algo.summary}</p>
        </div>

        <section className="stage card">
          <div className="stage-top">
            <div className="stats">
              {statEntries.map(([k, v]) => (
                <div className="stat" key={k}>
                  <div className="k">{k}</div>
                  <div className="v">{v}</div>
                </div>
              ))}
              <div className="stat hl">
                <div className="k">step</div>
                <div className="v">
                  {p.idx + 1}/{steps.length}
                </div>
              </div>
            </div>
            <PlayButtons p={p} total={steps.length} />
          </div>
          <div className="canvas">
            <ViewRenderer views={step.views} />
          </div>
          {algo.legend && <Legend tones={algo.legend} />}
        </section>

        <Timeline p={p} total={steps.length} label="In this run" />
      </main>

      <aside className="panel">
        <div className="card">
          <div className="step-head">
            <span className="eyebrow">
              Step {p.idx + 1} / {steps.length}
            </span>
            {step.line !== undefined && <span className="chip blue">line {step.line + 1}</span>}
          </div>
          <div className="step-msg" aria-live="polite">
            {step.msg}
          </div>
          {step.vars && (
            <div className="vars">
              {Object.entries(step.vars).map(([k, v]) => (
                <span className="var" key={k}>
                  {k} = <b>{String(v)}</b>
                </span>
              ))}
            </div>
          )}
          <div className="code" aria-label="Pseudocode">
            {algo.code.map((l, i) => (
              <div key={i} className={`ln ${i === step.line ? 'cur' : i === prevLine ? 'prev' : ''}`}>
                <span className="no">{i + 1}</span>
                {l}
              </div>
            ))}
          </div>
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
            <span className="eyebrow">Input</span>
            {algo.random && (
              <button className="btn ghost" onClick={() => loadParams(algo.random!())}>
                <IconShuffle /> Random
              </button>
            )}
          </div>
          <form
            className="fields"
            onSubmit={(e) => {
              e.preventDefault();
              apply();
            }}
          >
            {algo.fields.map((f) => (
              <div className="field" key={f.key}>
                <label htmlFor={`f-${f.key}`}>
                  {f.label} {f.hint && <span>{f.hint}</span>}
                </label>
                {f.kind === 'text' && (f.key === 'grid' || f.key === 'graph' || f.key === 'intervals') ? (
                  <textarea id={`f-${f.key}`} className="textarea" rows={f.key === 'grid' ? 5 : 3} value={form[f.key] ?? ''} onChange={(e) => setForm({ ...form, [f.key]: e.target.value })} spellCheck={false} />
                ) : (
                  <input id={`f-${f.key}`} className="input" value={form[f.key] ?? ''} onChange={(e) => setForm({ ...form, [f.key]: e.target.value })} spellCheck={false} inputMode={f.kind === 'text' ? 'text' : 'numeric'} />
                )}
                {errors[f.key] && <div className="error-text">{errors[f.key]}</div>}
              </div>
            ))}
            <div style={{ display: 'flex', gap: 8 }}>
              <button type="submit" className="btn primary">
                Visualize
              </button>
              <button type="button" className="btn" onClick={() => loadParams(algo.defaults)}>
                Reset
              </button>
            </div>
          </form>
          {algo.presets && algo.presets.length > 0 && (
            <>
              <div className="eyebrow" style={{ marginTop: 14 }}>
                Edge cases
              </div>
              <div className="presets">
                {algo.presets.map((pr) => (
                  <button key={pr.label} className={`preset ${preset?.label === pr.label ? 'on' : ''}`} title={pr.note} onClick={() => loadParams(pr.params, pr)}>
                    {pr.label}
                  </button>
                ))}
              </div>
              {preset?.note && <div className="preset-note">💡 {preset.note}</div>}
            </>
          )}
        </div>

        <div className="card about">
          <span className="eyebrow">How it works</span>
          {algo.about.map((t, i) => (
            <p key={i}>{t}</p>
          ))}
          <table className="cx">
            <tbody>
              <tr>
                <td>Best time</td>
                <td>{algo.time.best}</td>
              </tr>
              <tr>
                <td>Average time</td>
                <td>{algo.time.avg}</td>
              </tr>
              <tr>
                <td>Worst time</td>
                <td>{algo.time.worst}</td>
              </tr>
              <tr>
                <td>Extra space</td>
                <td>{algo.space}</td>
              </tr>
            </tbody>
          </table>
        </div>
      </aside>
    </>
  );
}
