import { useEffect, useState } from 'react';
import { categories } from '../algorithms';

export function CheatsheetPage() {
  const [filter, setFilter] = useState('');
  useEffect(() => {
    document.title = 'Complexity cheatsheet · AlgoTrace';
  }, []);
  const f = filter.trim().toLowerCase();
  return (
    <main className="main">
      <div className="title-row">
        <div>
          <h1>Complexity cheatsheet</h1>
          <p className="lede">Time and space for every algorithm in the app. Click a name to watch it run.</p>
        </div>
        <input className="input" style={{ maxWidth: 260 }} placeholder="Filter…" value={filter} onChange={(e) => setFilter(e.target.value)} aria-label="Filter algorithms" />
      </div>
      <div className="card" style={{ overflowX: 'auto' }}>
        <table className="cheat">
          <thead>
            <tr>
              <th>Algorithm</th>
              <th>Category</th>
              <th>Best</th>
              <th>Average</th>
              <th>Worst</th>
              <th>Space</th>
              <th>Level</th>
            </tr>
          </thead>
          <tbody>
            {categories.flatMap((c) =>
              c.items
                .filter((a) => !f || `${a.name} ${c.name}`.toLowerCase().includes(f))
                .map((a) => (
                  <tr key={a.id}>
                    <td>
                      <a href={`/algo/${a.id}`}>
                        <b>{a.name}</b>
                      </a>
                    </td>
                    <td>
                      <span className="dot" style={{ background: c.color, marginRight: 6 }} />
                      {c.name}
                    </td>
                    <td>{a.time.best}</td>
                    <td>{a.time.avg}</td>
                    <td>{a.time.worst}</td>
                    <td>{a.space}</td>
                    <td className="muted">{a.difficulty}</td>
                  </tr>
                )),
            )}
          </tbody>
        </table>
      </div>
    </main>
  );
}
