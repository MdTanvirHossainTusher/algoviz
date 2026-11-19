# AlgoTrace

Interactive, step-by-step algorithm visualizer plus a line-by-line code tracer for your own Python or JavaScript.

## Features

- **47 algorithms in 8 categories**: sorting (10), searching (6), graphs (9), dynamic programming (8), greedy (5), backtracking (3), trees (2), techniques (4).
- For each algorithm: highlighted pseudocode, live counters, play/pause/scrub, speed control, keyboard shortcuts (`←` `→` `Space` `R`), and editable input.
- **Edge-case presets** on every algorithm: empty input, a single element, duplicates, all-equal values, already sorted/reversed, negative numbers, target missing or out of range, disconnected graphs, negative edges and cycles, impossible amounts, and more. Steps explain how the algorithm handles each case.
- **Negative numbers everywhere**: bars draw below a zero line. Counting sort offsets by `min`, and radix sort shifts the values before sorting and back afterwards.
- **Code Tracer** (`/tracer`): paste code, press Run, step through every line with call frames, variables, array index pointers, diffs ("`seen[4] = 0` (new key)") and stdout. Supports `input()`/stdin.
  - Python runs in [Pyodide](https://pyodide.org) inside a Web Worker using `sys.settrace`.
  - JavaScript is instrumented with [acorn](https://github.com/acornjs/acorn) and run in a Web Worker.
  - Code never leaves the browser. Runs stop at 2000 steps or a few seconds, so infinite loops can't freeze the page.
- Complexity cheatsheet, search (`Ctrl K`), light and dark themes.

## Stack

Vite + React 19 + TypeScript, CodeMirror 6, acorn, Pyodide (loaded from the jsDelivr CDN on first Python run). Static site with no backend.

## Develop

```bash
npm install
npm run dev        # http://localhost:5173
npm run build      # type-check + production build into dist/
npm run preview    # serve dist/
```

## Docker

Multi-stage image: Node builds `dist/`, then nginx serves it on port 8080, with SPA fallback, gzip, immutable caching for `/assets/` and a `/healthz` endpoint.

```bash
docker compose up -d --build          # http://localhost:8080
# or
docker build -t algotrace . && docker run -p 8080:8080 algotrace
```

## Deploy to Vercel

`vercel.json` is already configured: Vite framework, `dist` output, an SPA rewrite so `/algo/...` and `/tracer` deep links work, and long-term caching for hashed assets.

**Option A: Git integration.** Push this folder to a GitHub, GitLab or Bitbucket repo, then go to vercel.com → *Add New Project* → import the repo. No settings need changing (set *Root Directory* to `algoviz` if the repo contains more than this app).

**Option B: CLI.**

```bash
npm i -g vercel
vercel          # first run links/creates the project (preview deploy)
vercel --prod   # production deploy
```

## Project layout

```
src/algorithms/   one file per category; each algorithm records Step[] snapshots
src/components/   top bar, sidebar, player controls, visualizers (bars, cells, tables, graphs, lists)
src/pages/        home, algorithm page, cheatsheet, tracer
src/tracer/       JS instrumenter + worker, Pyodide runner, diff/explanations, value renderer, examples
public/py-worker.js   Python tracer worker (Pyodide + sys.settrace)
```

### Adding an algorithm

Create an `Algorithm` object (see `src/lib/types.ts`). Its `run(params)` uses a `Recorder` to `push(line, message, views, vars)` at each interesting moment, and `presets` lists the edge cases. Add it to the category's exported array; the sidebar, search and cheatsheet pick it up automatically.
