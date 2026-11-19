import type { TVal, Lang } from './types';
import { fmt, same } from './explain';

const isPrim = (v: TVal) => v.t === 'num' || v.t === 'str' || v.t === 'bool' || v.t === 'none' || v.t === 'other' || v.t === 'ref' || v.t === 'fn';

function Prim({ v, changed, lang }: { v: TVal; changed?: boolean; lang: Lang }) {
  const cls = v.t === 'str' ? 'str' : v.t === 'none' ? 'none' : '';
  return <span className={`prim ${cls} ${changed ? 'changed' : ''}`}>{fmt(v, 80, lang)}</span>;
}

export function ValueView({ v, prev, pointers, lang }: { v: TVal; prev?: TVal; pointers?: Map<number, string[]>; lang: Lang }) {
  const changed = prev !== undefined && !same(prev, v);
  if (isPrim(v)) return <Prim v={v} changed={changed} lang={lang} />;

  if (v.t === 'list') {
    const pItems = prev?.t === 'list' ? prev.items : undefined;
    if (v.items.length === 0) return <span className={`prim none ${changed ? 'changed' : ''}`}>{v.kind === 'tuple' ? '()' : v.kind === 'set' || v.kind === 'Set' ? 'empty set' : '[ ]'}</span>;
    // 2D grid of primitives
    if (v.items.every((r) => r.t === 'list' && r.items.every(isPrim)) && v.items.length > 0) {
      const cols = Math.max(...v.items.map((r) => (r.t === 'list' ? r.items.length : 0)));
      return (
        <table className="vmatrix">
          <thead>
            <tr>
              <th />
              {Array.from({ length: cols }, (_, c) => (
                <th key={c}>{c}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {v.items.map((row, r) => {
              const pr = pItems?.[r];
              return (
                <tr key={r}>
                  <th>{r}</th>
                  {row.t === 'list' &&
                    row.items.map((x, c) => {
                      const px = pr?.t === 'list' ? pr.items[c] : undefined;
                      return (
                        <td key={c} className={prev && !same(px, x) ? 'changed' : ''}>
                          {fmt(x, 10, lang)}
                        </td>
                      );
                    })}
                </tr>
              );
            })}
          </tbody>
        </table>
      );
    }
    if (v.items.every(isPrim)) {
      return (
        <div className="vcells">
          {v.items.map((x, i) => {
            const ptr = pointers?.get(i);
            return (
              <div className="vcell" key={i}>
                <div className={`box ${prev && !same(pItems?.[i], x) ? 'changed' : ''} ${ptr ? 'pointed' : ''}`}>{fmt(x, 14, lang)}</div>
                <div className="ix">{v.kind === 'set' || v.kind === 'Set' ? '' : i}</div>
                <div className="pl">{ptr?.join(',')}</div>
              </div>
            );
          })}
          {v.more ? <span className="muted">+{v.more} more</span> : null}
        </div>
      );
    }
    return (
      <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
        {v.items.map((x, i) => (
          <div key={i} style={{ display: 'flex', gap: 6, alignItems: 'start' }}>
            <span className="muted" style={{ fontSize: 10, paddingTop: 3 }}>
              [{i}]
            </span>
            <ValueView v={x} prev={pItems?.[i]} lang={lang} />
          </div>
        ))}
      </div>
    );
  }

  // dict / object / Map
  const pm = prev?.t === 'dict' ? new Map(prev.entries) : undefined;
  if (v.entries.length === 0) return <span className={`prim none ${changed ? 'changed' : ''}`}>{v.cls ? `${v.cls} { }` : '{ }'}</span>;
  return (
    <div>
      {v.cls && <div className="muted" style={{ fontSize: 10, marginBottom: 2 }}>{v.cls}</div>}
      <table className="vdict">
        <tbody>
          {v.entries.map(([k, x]) => {
            const px = pm?.get(k);
            const ch = prev !== undefined && !same(px, x);
            return (
              <tr key={k}>
                <td className={`k ${ch && px === undefined ? 'changed' : ''}`}>{k}</td>
                <td className={ch && isPrim(x) ? 'changed' : ''}>{isPrim(x) ? fmt(x, 40, lang) : <ValueView v={x} prev={px} lang={lang} />}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
      {v.more ? <span className="muted">+{v.more} more</span> : null}
    </div>
  );
}
