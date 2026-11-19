import { useEffect } from 'react';
import { categories, allAlgorithms } from '../algorithms';
import { IconCode, IconPlay } from '../components/Icons';

const ART = [40, 72, 28, 110, 56, 134, 88, 18, 96, 64];
const ART_COLORS = ['var(--blue)', 'var(--green)', 'var(--violet)', 'var(--orange)', 'var(--amber)'];

export function HomePage() {
  useEffect(() => {
    document.title = 'AlgoTrace · Algorithms, step by step';
  }, []);
  return (
    <main className="main">
      <section className="hero card">
        <div>
          <h1>
            Watch algorithms <mark>think</mark>, one step at a time.
          </h1>
          <p>
            {allAlgorithms.length} interactive visualizations across sorting, searching, graphs, dynamic programming, greedy, backtracking, trees and classic techniques — each with
            pseudocode, live counters and one-click edge cases (empty input, negatives, duplicates, impossible targets…). Or paste your own Python, JavaScript, C++ or Java and step through it line by
            line.
          </p>
          <div className="hero-actions">
            <a className="btn primary" href="/algo/quick-sort">
              <IconPlay /> Start with Quick Sort
            </a>
            <a className="btn" href="/tracer">
              <IconCode /> Trace my code
            </a>
          </div>
        </div>
        <div className="hero-art" aria-hidden>
          {ART.map((h, i) => (
            <div key={i} style={{ height: h, background: ART_COLORS[i % ART_COLORS.length], animationDelay: `${i * 0.15}s` }} />
          ))}
        </div>
      </section>
      <div className="cat-grid">
        {categories.map((c, i) => (
          <div key={c.id} className="cat-card card">
            <h3>
              <span className="dot" style={{ background: c.color }} />
              {String(i + 1).padStart(2, '0')}. {c.name}
              <span className="muted" style={{ marginLeft: 'auto', fontSize: 11, fontWeight: 500 }}>
                {c.items.length}
              </span>
            </h3>
            <p>{c.blurb}</p>
            <div className="links">
              {c.items.map((a) => (
                <a key={a.id} href={`/algo/${a.id}`}>
                  {a.name}
                </a>
              ))}
            </div>
          </div>
        ))}
      </div>
    </main>
  );
}
