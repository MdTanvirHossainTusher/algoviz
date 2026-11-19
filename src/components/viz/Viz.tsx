import type { ArrayViz, GraphViz, ListViz, TableViz, Tone, Viz } from '../../lib/types';
import { edgeKey } from '../../lib/recorder';

const tc = (t?: Tone) => (t ? `t-${t}` : '');

function pointersByIndex(v: ArrayViz) {
  const m = new Map<number, string[]>();
  for (const p of v.pointers ?? []) {
    if (p.i < 0 || p.i >= v.values.length) continue;
    m.set(p.i, [...(m.get(p.i) ?? []), p.label]);
  }
  return m;
}

export function ArrayView({ v }: { v: ArrayViz }) {
  const n = v.values.length;
  const numeric = v.values.every((x) => typeof x === 'number' && Number.isFinite(x));
  const ptrs = pointersByIndex(v);
  if (n === 0) return <div className="empty-viz">[ ] — empty</div>;

  if (v.style === 'cells' || !numeric) {
    return (
      <div>
        {v.title && <div className="view-title">{v.title}</div>}
        <div className="cells">
          {v.values.map((x, i) => (
            <div className="cell-wrap" key={i}>
              <div className={`cell ${tc(v.tones?.[i])}`}>{String(x)}</div>
              <div className="cell-idx">{v.labels?.[i] ?? i}</div>
              <div className="cell-ptr">{ptrs.get(i)?.join(' ')}</div>
            </div>
          ))}
        </div>
      </div>
    );
  }

  const vals = v.values as number[];
  const H = 210;
  const PAD = 18;
  const max = Math.max(0, ...vals);
  const min = Math.min(0, ...vals);
  const span = max - min || 1;
  const zeroY = PAD + (max / span) * H;
  const hasNeg = min < 0;
  return (
    <div>
      {v.title && <div className="view-title">{v.title}</div>}
      <div className="bars" style={{ height: H + PAD * 2 }}>
        {hasNeg && (
          <div className="zero-line" style={{ top: zeroY }}>
            <span>0</span>
          </div>
        )}
        {vals.map((x, i) => {
          const h = Math.max(3, (Math.abs(x) / span) * H);
          const top = x >= 0 ? zeroY - h : zeroY;
          const key = v.ids?.[i] ?? i;
          return (
            <div key={key} className="bar-slot" style={{ width: `${100 / n}%`, transform: `translateX(${i * 100}%)` }}>
              <div className={`bar ${x < 0 ? 'neg' : ''} ${tc(v.tones?.[i])}`} style={{ top, height: h }} />
              <div className="bar-val" style={{ top: x >= 0 ? top - 16 : top + h + 2 }}>
                {x}
              </div>
            </div>
          );
        })}
      </div>
      <div className="ptrs">
        {[...ptrs].map(([i, labels]) => (
          <div key={i} className="ptr" style={{ left: `${(i / n) * 100}%`, width: `${100 / n}%` }}>
            {labels.join(' ')}
          </div>
        ))}
      </div>
    </div>
  );
}

export function TableView({ v }: { v: TableViz }) {
  if (!v.cells.length) return <div className="empty-viz">empty table</div>;
  return (
    <div style={{ overflowX: 'auto', maxWidth: '100%' }}>
      {v.title && <div className="view-title">{v.title}</div>}
      <table className={`tbl ${v.grid ? 'grid' : ''}`}>
        {v.colHeaders && (
          <thead>
            <tr>
              {v.rowHeaders && <th />}
              {v.colHeaders.map((h, i) => (
                <th key={i}>{h}</th>
              ))}
            </tr>
          </thead>
        )}
        <tbody>
          {v.cells.map((row, r) => (
            <tr key={r}>
              {v.rowHeaders && <th style={{ textAlign: 'right' }}>{v.rowHeaders[r]}</th>}
              {row.map((c, k) => {
                const tone = v.tones?.[`${r},${k}`];
                return (
                  <td key={k} className={`${c === null && !tone ? 'empty' : ''} ${tc(tone)}`}>
                    {c ?? ''}
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function ListView({ v }: { v: ListViz }) {
  return (
    <div className="listv">
      <div className="view-title">
        {v.title}
        {v.mode === 'stack' && v.items.length > 0 ? ' (top →)' : v.mode === 'queue' && v.items.length > 1 ? ' (front →)' : ''}
      </div>
      <div className={`list-items ${v.mode ?? ''}`}>
        {v.items.length === 0 && <span className="list-empty">empty</span>}
        {v.items.map((x, i) => (
          <span key={i} className={`list-item ${tc(v.tones?.[i])}`}>
            {x}
          </span>
        ))}
      </div>
    </div>
  );
}

const R = 19;

export function GraphView({ v }: { v: GraphViz }) {
  if (!v.nodes.length) return <div className="empty-viz">no vertices</div>;
  const pos = new Map(v.nodes.map((n) => [n.id, n]));
  const xs = v.nodes.map((n) => n.x);
  const ys = v.nodes.map((n) => n.y);
  const x0 = Math.min(...xs) - 40;
  const y0 = Math.min(...ys) - 34;
  const W = Math.max(v.width ?? 0, Math.max(...xs) + 40) - x0;
  const H = Math.max(Math.max(...ys) + 46 - y0, 120);
  const arcSet = new Set(v.edges.filter((e) => !e.both).map((e) => `${e.a}->${e.b}`));
  const toneOf = (a: string, b: string, both?: boolean): Tone | undefined => {
    const t = v.edgeTones ?? {};
    if (!v.directed) return t[edgeKey(a, b)];
    return t[`${a}->${b}`] ?? (both ? t[`${b}->${a}`] : undefined);
  };
  const markerId = `arrow-${Math.random().toString(36).slice(2, 8)}`;

  return (
    <div className="graph">
      {v.title && <div className="view-title">{v.title}</div>}
      <svg viewBox={`${x0} ${y0} ${W} ${H}`} style={{ maxHeight: 420 }} role="img" aria-label={v.title ?? 'graph'}>
        <defs>
          {['base', 'compare', 'path', 'bad'].map((k) => (
            <marker key={k} id={`${markerId}-${k}`} viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
              <path d="M0 0L10 5L0 10z" fill={k === 'path' ? 'var(--rust)' : k === 'compare' ? '#d9a521' : k === 'bad' ? '#d04a4a' : 'var(--line-strong)'} />
            </marker>
          ))}
        </defs>
        {v.edges.map((e, i) => {
          const A = pos.get(e.a);
          const B = pos.get(e.b);
          if (!A || !B) return null;
          const tone = toneOf(e.a, e.b, e.both);
          const mk = `url(#${markerId}-${tone === 'path' || tone === 'compare' || tone === 'bad' ? tone : 'base'})`;
          if (e.a === e.b) {
            const d = `M ${A.x - 8} ${A.y - R + 2} C ${A.x - 34} ${A.y - 62}, ${A.x + 34} ${A.y - 62}, ${A.x + 8} ${A.y - R + 2}`;
            return (
              <g key={i}>
                <path d={d} className={`g-edge ${tc(tone)}`} markerEnd={v.directed ? mk : undefined} />
                {e.w !== undefined && <WeightLabel x={A.x} y={A.y - 50} w={e.w} />}
              </g>
            );
          }
          const dx = B.x - A.x;
          const dy = B.y - A.y;
          const len = Math.hypot(dx, dy) || 1;
          const ux = dx / len;
          const uy = dy / len;
          const curved = v.directed && !e.both && arcSet.has(`${e.b}->${e.a}`);
          const off = curved ? 22 : 0;
          const nx = -uy * off;
          const ny = ux * off;
          const sx = A.x + ux * R + nx * 0.35;
          const sy = A.y + uy * R + ny * 0.35;
          const tx = B.x - ux * (R + (v.directed && !e.both ? 2 : 0)) + nx * 0.35;
          const ty = B.y - uy * (R + (v.directed && !e.both ? 2 : 0)) + ny * 0.35;
          const mx = (A.x + B.x) / 2 + nx;
          const my = (A.y + B.y) / 2 + ny;
          const d = curved ? `M ${sx} ${sy} Q ${mx} ${my} ${tx} ${ty}` : `M ${sx} ${sy} L ${tx} ${ty}`;
          return (
            <g key={i}>
              <path d={d} className={`g-edge ${tc(tone)}`} markerEnd={v.directed && !e.both ? mk : undefined} />
              {e.w !== undefined && <WeightLabel x={curved ? (sx + 2 * mx + tx) / 4 : mx} y={curved ? (sy + 2 * my + ty) / 4 : my} w={e.w} />}
            </g>
          );
        })}
        {v.nodes.map((n) => {
          const tone = v.nodeTones?.[n.id];
          const badge = v.badges?.[n.id];
          const label = n.label ?? n.id;
          return (
            <g key={n.id} className={`g-node ${tc(tone)}`}>
              <circle className="shadow" cx={n.x + 1.5} cy={n.y + 2.5} r={R} />
              <circle className="body" cx={n.x} cy={n.y} r={R} />
              <text x={n.x} y={n.y} style={label.length > 4 ? { fontSize: 9 } : label.length > 2 ? { fontSize: 10.5 } : undefined}>
                {label}
              </text>
              {badge && (
                <g className="g-badge">
                  <rect x={n.x - Math.max(14, badge.length * 3.6 + 6)} y={n.y + R + 3} width={Math.max(28, badge.length * 7.2 + 12)} height={15} rx={5} />
                  <text x={n.x} y={n.y + R + 10.5}>
                    {badge}
                  </text>
                </g>
              )}
            </g>
          );
        })}
      </svg>
    </div>
  );
}

function WeightLabel({ x, y, w }: { x: number; y: number; w: number }) {
  const s = String(w);
  const wd = s.length * 7 + 8;
  return (
    <g className="g-w">
      <rect x={x - wd / 2} y={y - 8} width={wd} height={16} rx={4} />
      <text x={x} y={y} textAnchor="middle" dominantBaseline="central">
        {s}
      </text>
    </g>
  );
}

export function ViewRenderer({ views }: { views: Viz[] }) {
  if (!views.length) return <div className="empty-viz">Nothing to draw for this input.</div>;
  const big = views.filter((v) => v.kind === 'graph' || (v.kind === 'array' && v.style !== 'cells'));
  const small = views.filter((v) => !big.includes(v));
  const one = (v: Viz, i: number) =>
    v.kind === 'array' ? <ArrayView key={i} v={v} /> : v.kind === 'table' ? <TableView key={i} v={v} /> : v.kind === 'graph' ? <GraphView key={i} v={v} /> : <ListView key={i} v={v} />;
  return (
    <>
      {big.map(one)}
      {small.length > 0 && <div className="views-row">{small.map(one)}</div>}
    </>
  );
}

export const TONE_LABEL: Record<Tone, string> = {
  compare: 'comparing',
  swap: 'swapping',
  active: 'current',
  sorted: 'final / settled',
  found: 'found / written',
  pivot: 'pivot / key',
  visited: 'visited',
  frontier: 'frontier / in queue',
  path: 'chosen / path',
  dim: 'discarded',
  bad: 'rejected / conflict',
  range: 'active range',
  wall: 'wall',
  start: 'start',
  goal: 'goal',
};

export function Legend({ tones }: { tones: Tone[] }) {
  return (
    <div className="legend">
      {tones.map((t) => (
        <span key={t} className={tc(t)}>
          <i /> {TONE_LABEL[t]}
        </span>
      ))}
    </div>
  );
}
