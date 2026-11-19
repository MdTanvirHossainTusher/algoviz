import { useEffect, useMemo, useRef, useState } from 'react';
import { allAlgorithms, categoryOf } from '../algorithms';
import { navigate } from '../lib/router';
import { IconBook, IconCode, IconGrid, IconMenu, IconMoon, IconSearch, IconSun, Logo } from './Icons';

function useTheme() {
  const [theme, setTheme] = useState<'light' | 'dark'>(() => {
    const t = document.documentElement.dataset.theme;
    if (t === 'light' || t === 'dark') return t;
    return matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
  });
  const toggle = () => {
    const next = theme === 'dark' ? 'light' : 'dark';
    document.documentElement.dataset.theme = next;
    try {
      localStorage.setItem('theme', next);
    } catch {
      /* storage unavailable */
    }
    setTheme(next);
  };
  return { theme, toggle };
}

export function TopBar({ path, onMenu }: { path: string; onMenu: () => void }) {
  const { theme, toggle } = useTheme();
  const [q, setQ] = useState('');
  const [open, setOpen] = useState(false);
  const [sel, setSel] = useState(0);
  const ref = useRef<HTMLInputElement>(null);

  const results = useMemo(() => {
    const s = q.trim().toLowerCase();
    if (!s) return [];
    return allAlgorithms.filter((a) => `${a.name} ${a.category} ${a.summary}`.toLowerCase().includes(s)).slice(0, 10);
  }, [q]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        ref.current?.focus();
        setOpen(true);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  const go = (id: string) => {
    navigate(`/algo/${id}`);
    setQ('');
    setOpen(false);
    ref.current?.blur();
  };

  const section = path.startsWith('/tracer') ? 'tracer' : path.startsWith('/cheatsheet') ? 'cheat' : 'learn';

  return (
    <header className="topbar">
      <button className="btn ghost icon menu-btn" onClick={onMenu} aria-label="Open algorithm list">
        <IconMenu />
      </button>
      <a href="/" className="logo">
        <Logo />
        <span>
          Algo<mark>Trace</mark>
        </span>
      </a>
      <nav className="nav">
        <a href="/" className={section === 'learn' ? 'active' : ''}>
          <IconBook /> <span>Visualize</span>
        </a>
        <a href="/tracer" className={section === 'tracer' ? 'active' : ''}>
          <IconCode /> <span>Code Tracer</span>
        </a>
        <a href="/cheatsheet" className={section === 'cheat' ? 'active' : ''}>
          <IconGrid /> <span>Cheatsheet</span>
        </a>
      </nav>
      <div className="search">
        <IconSearch />
        <input
          ref={ref}
          className="input"
          placeholder="Search algorithms…"
          value={q}
          onChange={(e) => {
            setQ(e.target.value);
            setSel(0);
            setOpen(true);
          }}
          onFocus={() => setOpen(true)}
          onBlur={() => setTimeout(() => setOpen(false), 150)}
          onKeyDown={(e) => {
            if (e.key === 'ArrowDown') setSel((s) => Math.min(s + 1, results.length - 1));
            if (e.key === 'ArrowUp') setSel((s) => Math.max(s - 1, 0));
            if (e.key === 'Enter' && results[sel]) go(results[sel].id);
            if (e.key === 'Escape') ref.current?.blur();
          }}
          aria-label="Search algorithms"
        />
        <span className="kbd">Ctrl K</span>
        {open && results.length > 0 && (
          <div className="search-results card">
            {results.map((a, i) => (
              <a key={a.id} href={`/algo/${a.id}`} className={i === sel ? 'sel' : ''} onMouseDown={(e) => { e.preventDefault(); go(a.id); }}>
                <span>{a.name}</span>
                <span className="muted">{categoryOf(a).name}</span>
              </a>
            ))}
          </div>
        )}
      </div>
      <button className="btn icon" onClick={toggle} aria-label="Toggle dark mode">
        {theme === 'dark' ? <IconSun /> : <IconMoon />}
      </button>
    </header>
  );
}
