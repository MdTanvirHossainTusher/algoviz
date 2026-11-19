import { lazy, Suspense, useEffect, useState } from 'react';
import { usePath } from './lib/router';
import { algorithmById } from './algorithms';
import { TopBar } from './components/TopBar';
import { Sidebar } from './components/Sidebar';
import { AlgorithmPage } from './pages/AlgorithmPage';
import { HomePage } from './pages/HomePage';
import { CheatsheetPage } from './pages/CheatsheetPage';

// The tracer pulls in CodeMirror + the JS parser, so load it only when needed.
const TracerPage = lazy(() => import('./pages/TracerPage'));

export default function App() {
  const path = usePath();
  const [menu, setMenu] = useState(false);
  useEffect(() => setMenu(false), [path]);

  const algoMatch = path.match(/^\/algo\/([\w-]+)/);
  const algo = algoMatch ? algorithmById.get(algoMatch[1]) : undefined;

  let body;
  if (path.startsWith('/tracer')) {
    body = (
      <Suspense fallback={<div className="tracer muted">Loading tracer…</div>}>
        <TracerPage />
      </Suspense>
    );
  } else if (algo) {
    body = (
      <div className="shell">
        <Sidebar activeId={algo.id} open={menu} onNavigate={() => setMenu(false)} />
        <AlgorithmPage key={algo.id} algo={algo} />
      </div>
    );
  } else {
    body = (
      <div className="shell two">
        <Sidebar open={menu} onNavigate={() => setMenu(false)} />
        {path.startsWith('/cheatsheet') ? (
          <CheatsheetPage />
        ) : algoMatch || path !== '/' ? (
          <main className="main">
            <div className="card" style={{ padding: 24 }}>
              <h1 style={{ marginTop: 0 }}>Not found</h1>
              <p className="muted">There is no page at {path}.</p>
              <a className="btn primary" href="/">
                Back to all algorithms
              </a>
            </div>
          </main>
        ) : (
          <HomePage />
        )}
      </div>
    );
  }

  return (
    <>
      <TopBar path={path} onMenu={() => setMenu((m) => !m)} />
      {body}
    </>
  );
}
