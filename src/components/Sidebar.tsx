import { useEffect, useState } from 'react';
import { categories } from '../algorithms';
import { IconFile, IconFolder } from './Icons';

export function Sidebar({ activeId, open, onNavigate }: { activeId?: string; open: boolean; onNavigate: () => void }) {
  const activeCat = categories.find((c) => c.items.some((a) => a.id === activeId))?.id;
  const [expanded, setExpanded] = useState<Set<string>>(() => new Set(activeCat ? [activeCat] : ['sorting']));

  useEffect(() => {
    if (activeCat) setExpanded((s) => (s.has(activeCat) ? s : new Set([...s, activeCat])));
  }, [activeCat]);

  const toggle = (id: string) =>
    setExpanded((s) => {
      const n = new Set(s);
      if (n.has(id)) n.delete(id);
      else n.add(id);
      return n;
    });

  const total = categories.reduce((s, c) => s + c.items.length, 0);

  return (
    <aside className={`sidebar ${open ? 'open' : ''}`}>
      <div className="side-head">
        <span>Algorithms</span>
        <span className="muted" style={{ fontSize: 11, fontWeight: 500 }}>{total} total</span>
      </div>
      {categories.map((c, ci) => (
        <div key={c.id} className={`folder ${expanded.has(c.id) ? 'open' : ''}`}>
          <button onClick={() => toggle(c.id)} aria-expanded={expanded.has(c.id)}>
            <span className="caret">▸</span>
            <IconFolder color={c.color} />
            <span>
              {String(ci + 1).padStart(2, '0')}. {c.name}
            </span>
            <span className="count">{c.items.length}</span>
          </button>
          {expanded.has(c.id) && (
            <ul>
              {c.items.map((a) => (
                <li key={a.id}>
                  <a href={`/algo/${a.id}`} className={a.id === activeId ? 'active' : ''} onClick={onNavigate}>
                    <IconFile /> {a.name}
                  </a>
                </li>
              ))}
            </ul>
          )}
        </div>
      ))}
      <a href="/tracer" className="side-foot card" onClick={onNavigate}>
        <span>TRACE YOUR OWN CODE</span>
        <span>→</span>
      </a>
    </aside>
  );
}
