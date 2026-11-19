import type { Algorithm, Tone, Viz, TableViz, ListViz, Preset } from '../lib/types';
import { Recorder, str, randInt } from '../lib/recorder';
import { buildGraph, gview, ek, fmtDist, type Graph } from './graphUtil';

const UND = 'A-B:4, A-C:2, B-C:5, B-D:10, C-E:3, E-D:4, D-F:11, E-F:8, F-G:1, G-H:2, E-H:6';
const graphField = { key: 'graph', label: 'Edges', kind: 'text' as const, hint: 'A-B:4 undirected · A>B:4 directed · bare name = isolated node' };
const startField = { key: 'start', label: 'Start node', kind: 'text' as const };

const randomWeights = (text: string, lo = 1, hi = 12) => text.replace(/:(-?\d+)/g, () => `:${randInt(lo, hi)}`);

const UND_PRESETS: Preset[] = [
  { label: 'Disconnected', params: { graph: 'A-B:3, B-C:1, A-C:5, D-E:2, F', start: 'A' }, note: 'D, E and F can never be reached from A.' },
  { label: 'Single node', params: { graph: 'A', start: 'A' }, note: 'No edges at all — the start is the whole answer.' },
  { label: 'Self-loop + parallel', params: { graph: 'A-A:2, A-B:1, A-B:5, B-C:2, C-D:1', start: 'A' }, note: 'Loops and duplicate edges must not confuse the algorithm.' },
  { label: 'Line', params: { graph: 'A-B:1, B-C:1, C-D:1, D-E:1, E-F:1', start: 'C' }, note: 'Starting in the middle explores both directions.' },
  { label: 'Complete K5', params: { graph: 'A-B:2, A-C:9, A-D:4, A-E:7, B-C:3, B-D:8, B-E:5, C-D:1, C-E:6, D-E:2', start: 'A' }, note: 'Every pair connected — densest case, E = V(V−1)/2.' },
  { label: 'Missing start', params: { graph: 'A-B:1, B-C:2', start: 'Z' }, note: 'A start node that does not exist must be reported, not crash.' },
];

/** Validates the graph + start node; pushes an explanatory step and returns false on edge cases. */
function precheck(g: Graph, start: string | null, r: Recorder): boolean {
  if (g.errors.length) {
    r.push(0, `Input problem: ${g.errors.join('; ')}. Those tokens were ignored.`, [gview(g)]);
  }
  if (g.ids.length === 0) {
    r.push(0, 'Edge case: the graph has no vertices, so there is nothing to explore.', [gview(g)]);
    return false;
  }
  if (start !== null && !g.adj.has(start)) {
    r.push(0, `Edge case: start node "${start}" is not in the graph (nodes: ${g.ids.join(', ')}).`, [gview(g)]);
    return false;
  }
  return true;
}

const distTable = (g: Graph, dist: Map<string, number>, prev: Map<string, string | null>, hot?: string, done?: Set<string>): TableViz => {
  const tones: Record<string, Tone> = {};
  g.ids.forEach((id, i) => {
    if (done?.has(id)) tones[`${i},1`] = 'sorted';
    if (id === hot) {
      tones[`${i},0`] = 'active';
      tones[`${i},1`] = 'found';
    }
  });
  return {
    kind: 'table',
    title: 'Distances',
    colHeaders: ['dist', 'prev'],
    rowHeaders: g.ids,
    cells: g.ids.map((id) => [fmtDist(dist.get(id)!), prev.get(id) ?? '—']),
    tones,
  };
};

const list = (title: string, items: (string | number)[], mode: ListViz['mode'], hot?: number): ListViz => ({
  kind: 'list',
  title,
  items: [...items],
  mode,
  tones: hot !== undefined ? { [hot]: 'active' } : {},
});

const unreachableNote = (g: Graph, seen: Set<string> | Map<string, unknown>) => {
  const miss = g.ids.filter((id) => !seen.has(id));
  return miss.length ? ` Unreachable: ${miss.join(', ')} — they stay at ∞ / unvisited.` : '';
};

const bfs: Algorithm = {
  id: 'bfs',
  name: 'Breadth-First Search',
  category: 'graph',
  difficulty: 'Beginner',
  summary: 'Explore level by level with a queue — gives shortest paths in unweighted graphs.',
  about: [
    'BFS visits every vertex at distance 1, then distance 2, and so on. A FIFO queue guarantees that order.',
    'Marking a node visited when it is enqueued (not when dequeued) prevents the same node from entering the queue twice.',
  ],
  time: { best: 'O(V + E)', avg: 'O(V + E)', worst: 'O(V + E)' },
  space: 'O(V)',
  code: [
    'procedure BFS(G, s):',
    '  dist[s] ← 0; queue ← [s]; visited ← {s}',
    '  while queue not empty:',
    '    u ← queue.dequeue()',
    '    for each neighbor v of u:',
    '      if v not visited:',
    '        visited.add(v); dist[v] ← dist[u] + 1',
    '        queue.enqueue(v)',
    '  nodes never visited are unreachable (dist = ∞)',
  ],
  fields: [graphField, startField],
  defaults: { graph: UND, start: 'A' },
  random: () => ({ graph: UND, start: String.fromCharCode(65 + randInt(0, 7)) }),
  presets: UND_PRESETS,
  legend: ['active', 'frontier', 'visited', 'path'],
  run(p) {
    const g = buildGraph(str(p.graph, UND), false);
    const s = str(p.start, 'A').trim();
    const r = new Recorder(['visited', 'edges checked']);
    if (!precheck(g, s, r)) return r.steps;
    const dist = new Map<string, number>([[s, 0]]);
    const visited = new Set([s]);
    const queue = [s];
    const tree: Record<string, Tone> = {};
    const tones = (u?: string, v?: string) => {
      const t: Record<string, Tone> = {};
      for (const id of visited) t[id] = 'visited';
      for (const id of queue) t[id] = 'frontier';
      if (u) t[u] = 'active';
      if (v && !t[v]) t[v] = 'compare';
      return t;
    };
    const badges = () => Object.fromEntries([...dist].map(([k, d]) => [k, `d=${d}`]));
    const views = (u?: string, v?: string, e?: string): Viz[] => [gview(g, tones(u, v), e ? { ...tree, [e]: 'compare' } : tree, badges(), undefined, false), list('Queue', queue, 'queue')];
    r.inc('visited');
    r.push(1, `Start at ${s}: distance 0, put it in the queue.`, views(), { s });
    while (queue.length) {
      const u = queue.shift()!;
      r.push(3, `Dequeue ${u} (distance ${dist.get(u)}).`, views(u), { u });
      for (const { to: v } of g.adj.get(u)!) {
        r.inc('edges checked');
        if (visited.has(v)) {
          r.push(5, `${v} already visited — skip.`, views(u, v, ek(g, u, v)), { u, v });
          continue;
        }
        visited.add(v);
        dist.set(v, dist.get(u)! + 1);
        queue.push(v);
        tree[ek(g, u, v)] = 'path';
        r.inc('visited');
        r.push(7, `Discover ${v} at distance ${dist.get(v)}; enqueue it.`, views(u, v), { u, v });
      }
    }
    r.push(8, `Queue empty — BFS finished. Visited ${visited.size}/${g.ids.length} nodes.${unreachableNote(g, visited)}`, views());
    return r.steps;
  },
};

const dfs: Algorithm = {
  id: 'dfs',
  name: 'Depth-First Search',
  category: 'graph',
  difficulty: 'Beginner',
  summary: 'Go as deep as possible along each branch before backtracking.',
  about: [
    'DFS dives into the first unvisited neighbour, then its first unvisited neighbour, and so on. When stuck, it backtracks — the call stack remembers where to return.',
    'Discovery and finish times power cycle detection, topological sorting and strongly connected components.',
  ],
  time: { best: 'O(V + E)', avg: 'O(V + E)', worst: 'O(V + E)' },
  space: 'O(V)',
  code: [
    'procedure DFS(G, u):',
    '  visited.add(u); record discovery of u',
    '  for each neighbor v of u:',
    '    if v not visited:',
    '      DFS(G, v)',
    '  u is finished (backtrack)',
  ],
  fields: [graphField, startField],
  defaults: { graph: UND, start: 'A' },
  random: () => ({ graph: UND, start: String.fromCharCode(65 + randInt(0, 7)) }),
  presets: UND_PRESETS,
  legend: ['active', 'frontier', 'visited', 'path'],
  run(p) {
    const g = buildGraph(str(p.graph, UND), false);
    const s = str(p.start, 'A').trim();
    const r = new Recorder(['visited', 'edges checked']);
    if (!precheck(g, s, r)) return r.steps;
    const visited = new Set<string>();
    const finished = new Set<string>();
    const stack: string[] = [];
    const order: string[] = [];
    const tree: Record<string, Tone> = {};
    let time = 0;
    const badges: Record<string, string> = {};
    const views = (u?: string, v?: string): Viz[] => {
      const t: Record<string, Tone> = {};
      for (const id of visited) t[id] = finished.has(id) ? 'visited' : 'frontier';
      if (u) t[u] = 'active';
      if (v && !visited.has(v)) t[v] = 'compare';
      return [gview(g, t, tree, badges, undefined, false), list('Call stack', stack, 'stack', stack.length - 1), list('Discovery order', order, 'queue')];
    };
    const go = (u: string) => {
      visited.add(u);
      stack.push(u);
      order.push(u);
      badges[u] = `${++time}/`;
      r.inc('visited');
      r.push(1, `Visit ${u} (discovered at time ${time}).`, views(u), { u, depth: stack.length });
      for (const { to: v } of g.adj.get(u)!) {
        r.inc('edges checked');
        if (visited.has(v)) {
          r.push(3, `${u} → ${v}: already visited${v === u ? ' (self-loop)' : ''}, skip.`, views(u, v), { u, v });
          continue;
        }
        tree[ek(g, u, v)] = 'path';
        r.push(4, `${u} → ${v}: unvisited, go deeper.`, views(u, v), { u, v });
        go(v);
        r.push(2, `Back at ${u}; continue with its next neighbour.`, views(u), { u });
      }
      finished.add(u);
      badges[u] += `${++time}`;
      stack.pop();
      r.push(5, `${u} has no unvisited neighbours left — finished at time ${time}, backtrack.`, views(), { u });
    };
    go(s);
    r.push(5, `DFS from ${s} complete. Order: ${order.join(' → ')}.${unreachableNote(g, visited)}`, views());
    return r.steps;
  },
};

const dijkstra: Algorithm = {
  id: 'dijkstra',
  name: "Dijkstra's Shortest Path",
  category: 'graph',
  difficulty: 'Intermediate',
  summary: 'Greedily settle the closest unsettled vertex using a priority queue.',
  about: [
    'Keep a tentative distance for every vertex. Repeatedly pop the vertex with the smallest distance — that distance is now final — and relax its outgoing edges.',
    'Edge case: it requires non-negative weights. With a negative edge, a "settled" vertex can later get a shorter path, and Dijkstra will report a wrong answer. Use Bellman–Ford instead.',
  ],
  time: { best: 'O((V+E) log V)', avg: 'O((V+E) log V)', worst: 'O((V+E) log V)' },
  space: 'O(V)',
  code: [
    'procedure dijkstra(G, s):',
    '  dist[*] ← ∞; dist[s] ← 0; pq ← {(0, s)}',
    '  while pq not empty:',
    '    (d, u) ← pq.popMin()',
    '    if d > dist[u]: continue         // stale entry',
    '    for each (v, w) in G[u]:',
    '      if dist[u] + w < dist[v]:',
    '        dist[v] ← dist[u] + w; prev[v] ← u',
    '        pq.push((dist[v], v))',
    '  return dist, prev',
  ],
  fields: [graphField, startField],
  defaults: { graph: UND, start: 'A' },
  random: () => ({ graph: randomWeights(UND), start: 'A' }),
  presets: [
    ...UND_PRESETS,
    { label: 'Negative edge ⚠', params: { graph: 'A>B:2, A>C:5, C>B:-4, B>D:1', start: 'A' }, note: 'Dijkstra settles B at 2 too early; the true distance is 1 via C. Compare with Bellman–Ford.' },
    { label: 'Ties', params: { graph: 'A-B:1, A-C:1, B-D:1, C-D:1, D-E:1', start: 'A' }, note: 'Two equally short paths to D — either prev is correct.' },
    { label: 'Zero weights', params: { graph: 'A-B:0, B-C:0, C-D:3, A-D:3', start: 'A' }, note: 'Zero is allowed (non-negative).' },
  ],
  legend: ['active', 'frontier', 'sorted', 'path'],
  run(p) {
    const g = buildGraph(str(p.graph, UND), true);
    const s = str(p.start, 'A').trim();
    const r = new Recorder(['pops', 'relaxations']);
    if (!precheck(g, s, r)) return r.steps;
    const dist = new Map(g.ids.map((id) => [id, Infinity]));
    const prev = new Map<string, string | null>(g.ids.map((id) => [id, null]));
    const done = new Set<string>();
    dist.set(s, 0);
    let pq: [number, string][] = [[0, s]];
    const neg = g.edges.filter((e) => (e.w ?? 0) < 0);
    const treeTones = () => {
      const t: Record<string, Tone> = {};
      for (const [v, u] of prev) if (u) t[ek(g, u, v)] = 'path';
      return t;
    };
    const views = (u?: string, v?: string): Viz[] => {
      const t: Record<string, Tone> = {};
      for (const [, id] of pq) t[id] = 'frontier';
      for (const id of done) t[id] = 'sorted';
      if (u) t[u] = 'active';
      if (v && v !== u) t[v] = 'compare';
      const et = treeTones();
      if (u && v) et[ek(g, u, v)] = 'compare';
      const badges = Object.fromEntries([...dist].map(([k, d]) => [k, fmtDist(d)]));
      return [gview(g, t, et, badges), distTable(g, dist, prev, v, done), list('Priority queue (d, node)', pq.map(([d, id]) => `${d}:${id}`), 'queue', 0)];
    };
    if (neg.length) {
      r.push(1, `⚠ Edge case: ${neg.length} negative edge(s) (${neg.map((e) => `${e.a}→${e.b}:${e.w}`).join(', ')}). Dijkstra's greedy choice is no longer safe — watch for a wrong result.`, views());
    }
    r.push(1, `All distances ∞ except dist[${s}] = 0.`, views(), { s });
    while (pq.length) {
      pq.sort((x, y) => x[0] - y[0]);
      const [d, u] = pq.shift()!;
      r.inc('pops');
      if (d > dist.get(u)! || done.has(u)) {
        r.push(4, `Pop (${d}, ${u}) — stale, a shorter distance ${fmtDist(dist.get(u)!)} was already found. Skip.`, views(u), { d, u });
        continue;
      }
      done.add(u);
      r.push(3, `Pop ${u} with distance ${d}. It is now settled.`, views(u), { d, u });
      for (const { to: v, w } of g.adj.get(u)!) {
        const cand = dist.get(u)! + w;
        r.inc('relaxations');
        r.push(6, `Edge ${u}→${v} (w=${w}): ${dist.get(u)} + ${w} = ${cand} vs dist[${v}] = ${fmtDist(dist.get(v)!)}.`, views(u, v), { u, v, w, candidate: cand });
        if (cand < dist.get(v)!) {
          dist.set(v, cand);
          prev.set(v, u);
          pq.push([cand, v]);
          r.push(8, `Shorter! dist[${v}] = ${cand}, prev[${v}] = ${u}.${done.has(v) ? ` ⚠ ${v} was already settled — this only happens with negative edges.` : ''}`, views(u, v), { u, v, w });
        }
      }
    }
    let wrong = '';
    if (neg.length) {
      // Run Bellman–Ford quietly to show the user exactly which answers the greedy choice got wrong.
      const truth = new Map(g.ids.map((id) => [id, Infinity]));
      truth.set(s, 0);
      for (let i = 0; i < g.ids.length - 1; i++) for (const e of g.arcs) if (truth.get(e.a)! + e.w! < truth.get(e.b)!) truth.set(e.b, truth.get(e.a)! + e.w!);
      const diff = g.ids.filter((id) => truth.get(id) !== dist.get(id));
      wrong = diff.length ? ` ⚠ Because of the negative edge these are WRONG: ${diff.map((id) => `${id} = ${fmtDist(dist.get(id)!)} (true ${fmtDist(truth.get(id)!)})`).join(', ')}.` : ' The negative edge happened not to cause a wrong answer this time — but Dijkstra gives no such guarantee.';
    }
    r.push(9, `Done. Highlighted edges form the shortest-path tree from ${s}.${unreachableNote(g, new Map([...dist].filter(([, d]) => d < Infinity)))}${wrong}`, views());
    return r.steps;
  },
};

const BF_DEF = 'S>T:6, S>Y:7, T>X:5, T>Y:8, T>Z:-4, X>T:-2, Y>X:-3, Y>Z:9, Z>S:2, Z>X:7';
const bellman: Algorithm = {
  id: 'bellman-ford',
  name: 'Bellman–Ford',
  category: 'graph',
  difficulty: 'Intermediate',
  summary: 'Relax every edge V−1 times; handles negative weights and detects negative cycles.',
  about: [
    'A shortest path has at most V−1 edges, so V−1 rounds of relaxing every edge are enough to find all distances — even with negative weights.',
    'If a V-th round can still shorten something, a negative cycle is reachable and "shortest path" is undefined (you could loop forever, getting cheaper).',
  ],
  time: { best: 'O(E)', avg: 'O(V·E)', worst: 'O(V·E)' },
  space: 'O(V)',
  code: [
    'procedure bellmanFord(G, s):',
    '  dist[*] ← ∞; dist[s] ← 0',
    '  repeat |V| − 1 times:',
    '    for each edge (u, v, w):',
    '      if dist[u] + w < dist[v]: dist[v] ← dist[u] + w',
    '    if nothing changed: stop early',
    '  for each edge (u, v, w):',
    '    if dist[u] + w < dist[v]: negative cycle!',
    '  return dist',
  ],
  fields: [graphField, startField],
  defaults: { graph: BF_DEF, start: 'S' },
  random: () => ({ graph: randomWeights(BF_DEF, -3, 10), start: 'S' }),
  presets: [
    { label: 'Negative cycle', params: { graph: 'A>B:1, B>C:-2, C>A:-1, C>D:3', start: 'A' }, note: 'A→B→C→A costs −2: distances can drop forever.' },
    { label: 'Unreachable cycle', params: { graph: 'A>B:2, B>C:3, D>E:-5, E>D:1', start: 'A' }, note: 'A negative cycle the start cannot reach does not matter.' },
    { label: 'All positive', params: { graph: UND, start: 'A' }, note: 'Same answer as Dijkstra, just slower.' },
    { label: 'Negative edge, no cycle', params: { graph: 'A>B:2, A>C:5, C>B:-4, B>D:1', start: 'A' }, note: 'The case Dijkstra gets wrong.' },
    { label: 'Single node', params: { graph: 'A', start: 'A' } },
    { label: 'Missing start', params: { graph: 'A>B:1', start: 'Q' } },
  ],
  legend: ['active', 'compare', 'path', 'bad'],
  run(p) {
    const g = buildGraph(str(p.graph, BF_DEF), true);
    const s = str(p.start, 'S').trim();
    const r = new Recorder(['rounds', 'relaxations']);
    if (!precheck(g, s, r)) return r.steps;
    const dist = new Map(g.ids.map((id) => [id, Infinity]));
    const prev = new Map<string, string | null>(g.ids.map((id) => [id, null]));
    dist.set(s, 0);
    const views = (e?: { a: string; b: string }, bad?: Set<string>): Viz[] => {
      const et: Record<string, Tone> = {};
      for (const [v, u] of prev) if (u) et[ek(g, u, v)] = 'path';
      const t: Record<string, Tone> = {};
      if (e) {
        et[ek(g, e.a, e.b)] = 'compare';
        t[e.a] = 'active';
        t[e.b] = 'compare';
      }
      if (bad) for (const id of bad) t[id] = 'bad';
      const badges = Object.fromEntries([...dist].map(([k, d]) => [k, fmtDist(d)]));
      return [gview(g, t, et, badges), distTable(g, dist, prev, e?.b)];
    };
    r.push(1, `dist[${s}] = 0, everything else ∞.`, views());
    const V = g.ids.length;
    for (let round = 1; round <= V - 1; round++) {
      r.inc('rounds');
      let changed = false;
      r.push(2, `Round ${round} of ${V - 1}: relax every edge.`, views(), { round });
      for (const e of g.arcs) {
        const du = dist.get(e.a)!;
        r.inc('relaxations');
        if (du === Infinity) {
          r.push(4, `${e.a}→${e.b}: dist[${e.a}] is ∞, nothing to relax.`, views(e), { round });
          continue;
        }
        const cand = du + e.w!;
        if (cand < dist.get(e.b)!) {
          dist.set(e.b, cand);
          prev.set(e.b, e.a);
          changed = true;
          r.push(4, `${e.a}→${e.b} (w=${e.w}): ${du} + ${e.w} = ${cand} improves dist[${e.b}].`, views(e), { round, candidate: cand });
        } else {
          r.push(4, `${e.a}→${e.b} (w=${e.w}): ${cand} is not better than ${fmtDist(dist.get(e.b)!)}.`, views(e), { round, candidate: cand });
        }
      }
      if (!changed) {
        r.push(5, `No change in round ${round} — distances are final. Stop early.`, views(), { round });
        break;
      }
    }
    if (V - 1 === 0) r.push(2, 'Edge case: one vertex means zero rounds are needed.', views());
    const bad = new Set<string>();
    for (const e of g.arcs) {
      const du = dist.get(e.a)!;
      if (du !== Infinity && du + e.w! < dist.get(e.b)!) {
        bad.add(e.a);
        bad.add(e.b);
        r.push(7, `Check ${e.a}→${e.b}: still improvable after V−1 rounds → a negative cycle is reachable!`, views(e, bad));
      }
    }
    if (bad.size) {
      r.push(7, `Negative cycle detected around ${[...bad].join(', ')}. Shortest distances through it are −∞ (undefined).`, views(undefined, bad));
    } else {
      r.push(8, `No negative cycle. Final distances are shortest paths from ${s}.${unreachableNote(g, new Map([...dist].filter(([, d]) => d < Infinity)))}`, views());
    }
    return r.steps;
  },
};

const prim: Algorithm = {
  id: 'prim',
  name: "Prim's MST",
  category: 'graph',
  difficulty: 'Intermediate',
  summary: 'Grow one tree by always adding the cheapest edge leaving it.',
  about: [
    'Start from any vertex. Among all edges that connect the tree to a vertex outside it, pick the lightest — the cut property guarantees it belongs to some minimum spanning tree.',
    'Edge case: on a disconnected graph no spanning tree exists; Prim only spans the start vertex\'s component.',
  ],
  time: { best: 'O(E log V)', avg: 'O(E log V)', worst: 'O(E log V)' },
  space: 'O(V + E)',
  code: [
    'procedure prim(G, s):',
    '  inTree ← {s}; pq ← edges leaving s',
    '  while pq not empty:',
    '    (w, u, v) ← pq.popMin()',
    '    if v in inTree: continue          // would form a cycle',
    '    add edge (u, v) to MST; inTree.add(v)',
    '    push edges from v to vertices outside the tree',
    '  if |inTree| < |V|: graph is disconnected',
  ],
  fields: [graphField, startField],
  defaults: { graph: UND, start: 'A' },
  random: () => ({ graph: randomWeights(UND), start: 'A' }),
  presets: [...UND_PRESETS, { label: 'Equal weights', params: { graph: 'A-B:1, B-C:1, C-A:1, C-D:1', start: 'A' }, note: 'Several MSTs exist — all have the same total.' }, { label: 'Negative weights', params: { graph: 'A-B:-3, B-C:2, A-C:-1, C-D:4', start: 'A' }, note: 'MSTs work fine with negative weights.' }],
  legend: ['active', 'compare', 'path', 'sorted'],
  run(p) {
    const g = buildGraph(str(p.graph, UND), false);
    const s = str(p.start, 'A').trim();
    const r = new Recorder(['edges popped', 'MST weight']);
    if (!precheck(g, s, r)) return r.steps;
    const inTree = new Set([s]);
    const mst: Record<string, Tone> = {};
    let pq: [number, string, string][] = g.adj.get(s)!.map(({ to, w }) => [w, s, to]);
    let total = 0;
    const views = (e?: [number, string, string], rej = false): Viz[] => {
      const t: Record<string, Tone> = {};
      for (const id of inTree) t[id] = 'sorted';
      const et: Record<string, Tone> = { ...mst };
      if (e) {
        et[ek(g, e[1], e[2])] = rej ? 'bad' : 'compare';
        t[e[2]] = rej ? 'bad' : 'active';
      }
      return [gview(g, t, et), list('Candidate edges (w:u-v)', [...pq].sort((x, y) => x[0] - y[0]).map(([w, u, v]) => `${w}:${u}-${v}`), 'queue', 0)];
    };
    r.push(1, `Tree starts as {${s}}. Candidates are its incident edges.`, views());
    while (pq.length) {
      pq.sort((x, y) => x[0] - y[0]);
      const e = pq.shift()!;
      r.inc('edges popped');
      const [w, u, v] = e;
      if (inTree.has(v)) {
        r.push(4, `Lightest candidate ${u}-${v} (${w}) — but ${v} is already in the tree (cycle). Discard.`, views(e, true), { w, u, v });
        continue;
      }
      inTree.add(v);
      mst[ek(g, u, v)] = 'path';
      total += w;
      r.inc('MST weight', w);
      r.push(5, `Take ${u}-${v} (${w}). ${v} joins the tree. Total = ${total}.`, views(e), { w, u, v, total });
      const added = g.adj.get(v)!.filter(({ to }) => !inTree.has(to));
      pq = pq.concat(added.map(({ to, w }) => [w, v, to] as [number, string, string]));
      if (added.length) r.push(6, `Add ${added.length} new candidate edge(s) from ${v}.`, views(), { v });
    }
    if (inTree.size < g.ids.length) {
      r.push(7, `Edge case: only ${inTree.size}/${g.ids.length} vertices reached — the graph is disconnected, so no spanning tree exists. This is the MST of ${s}'s component (weight ${total}).`, views());
    } else {
      r.push(7, `MST complete: ${g.ids.length - 1} edges, total weight ${total}.`, views());
    }
    return r.steps;
  },
};

const kruskal: Algorithm = {
  id: 'kruskal',
  name: "Kruskal's MST",
  category: 'graph',
  difficulty: 'Intermediate',
  summary: 'Sort edges by weight and add each one unless it would create a cycle (union–find).',
  about: [
    'Consider edges from lightest to heaviest. An edge joining two different components is safe to add; one inside a component would close a cycle.',
    'A disjoint-set (union–find) structure answers "same component?" in near-constant time. On a disconnected graph Kruskal naturally produces a minimum spanning forest.',
  ],
  time: { best: 'O(E log E)', avg: 'O(E log E)', worst: 'O(E log E)' },
  space: 'O(V)',
  code: [
    'procedure kruskal(G):',
    '  sort edges by weight',
    '  make every vertex its own set',
    '  for each edge (u, v, w) in order:',
    '    if find(u) ≠ find(v):',
    '      union(u, v); add edge to MST',
    '    else: skip — would form a cycle',
    '  return MST (a forest if G is disconnected)',
  ],
  fields: [graphField],
  defaults: { graph: UND },
  random: () => ({ graph: randomWeights(UND) }),
  presets: [
    { label: 'Disconnected', params: { graph: 'A-B:3, B-C:1, A-C:5, D-E:2, F' }, note: 'Result is a forest: one tree per component.' },
    { label: 'Equal weights', params: { graph: 'A-B:1, B-C:1, C-A:1, C-D:1' }, note: 'Ties broken by input order; total is still minimal.' },
    { label: 'Self-loop + parallel', params: { graph: 'A-A:0, A-B:4, A-B:1, B-C:2' }, note: 'A self-loop always closes a cycle; the heavier parallel edge is skipped.' },
    { label: 'Negative weights', params: { graph: 'A-B:-3, B-C:2, A-C:-1, C-D:4' } },
    { label: 'Single node', params: { graph: 'A' } },
  ],
  legend: ['compare', 'path', 'bad'],
  run(p) {
    const g = buildGraph(str(p.graph, UND), false);
    const r = new Recorder(['edges considered', 'MST weight']);
    if (!precheck(g, null, r)) return r.steps;
    const parent = new Map(g.ids.map((id) => [id, id]));
    const find = (x: string): string => {
      while (parent.get(x) !== x) {
        parent.set(x, parent.get(parent.get(x)!)!);
        x = parent.get(x)!;
      }
      return x;
    };
    const sorted = [...g.edges].sort((x, y) => x.w! - y.w!);
    const mst: Record<string, Tone> = {};
    const status: Record<number, Tone> = {};
    let total = 0;
    let taken = 0;
    const comps = () => {
      const m = new Map<string, string[]>();
      for (const id of g.ids) {
        const root = find(id);
        m.set(root, [...(m.get(root) ?? []), id]);
      }
      return [...m.values()].map((c) => `{${c.join(',')}}`);
    };
    const views = (i?: number): Viz[] => {
      const et: Record<string, Tone> = { ...mst };
      if (i !== undefined) et[ek(g, sorted[i].a, sorted[i].b)] = status[i] === 'bad' ? 'bad' : 'compare';
      const t: Record<string, Tone> = {};
      if (i !== undefined) {
        t[sorted[i].a] = 'active';
        t[sorted[i].b] = 'active';
      }
      return [
        gview(g, t, et),
        { kind: 'list', title: 'Edges by weight', items: sorted.map((e) => `${e.w}:${e.a}-${e.b}`), mode: 'queue', tones: i !== undefined ? { ...status, [i]: status[i] ?? 'active' } : status },
        list('Components', comps(), 'set'),
      ];
    };
    r.push(1, `Sort the ${sorted.length} edges by weight.`, views());
    r.push(2, 'Every vertex starts in its own component.', views());
    sorted.forEach((e, i) => {
      r.inc('edges considered');
      const ru = find(e.a);
      const rv = find(e.b);
      r.push(4, `Edge ${e.a}-${e.b} (${e.w}): are ${e.a} and ${e.b} in different components?`, views(i), { u: e.a, v: e.b, w: e.w! });
      if (ru !== rv) {
        parent.set(ru, rv);
        mst[ek(g, e.a, e.b)] = 'path';
        status[i] = 'path';
        total += e.w!;
        taken++;
        r.inc('MST weight', e.w!);
        r.push(5, `Yes → union them and keep the edge. Total = ${total}.`, views(i), { total });
      } else {
        status[i] = 'bad';
        r.push(6, `No — ${e.a === e.b ? 'a self-loop' : 'both already connected'}; adding it would form a cycle. Skip.`, views(i));
      }
    });
    const c = comps().length;
    r.push(7, c > 1 ? `Edge case: ${c} components remain — the graph is disconnected, so this is a minimum spanning forest (${taken} edges, weight ${total}).` : `MST complete: ${taken} edges, total weight ${total}.`, views());
    return r.steps;
  },
};

const DAG = 'Math>Physics, Math>CS1, CS1>CS2, CS2>Algo, Physics>Algo, CS1>DB, DB>Web, CS2>Web';
const topo: Algorithm = {
  id: 'topological-sort',
  name: 'Topological Sort (Kahn)',
  category: 'graph',
  difficulty: 'Intermediate',
  summary: 'Order a DAG so every edge points forward, by repeatedly removing zero in-degree vertices.',
  about: [
    'A vertex with in-degree 0 has no unmet prerequisites, so it can go next. Removing it lowers its successors\' in-degrees, possibly freeing them.',
    'Edge case: if a cycle exists, its vertices never reach in-degree 0 — the output is shorter than V, which is exactly how Kahn\'s algorithm detects cycles.',
  ],
  time: { best: 'O(V + E)', avg: 'O(V + E)', worst: 'O(V + E)' },
  space: 'O(V)',
  code: [
    'procedure topoSort(G):',
    '  indeg[v] ← number of incoming edges',
    '  queue ← every v with indeg[v] = 0',
    '  while queue not empty:',
    '    u ← dequeue; order.append(u)',
    '    for each edge u → v:',
    '      indeg[v] ← indeg[v] − 1',
    '      if indeg[v] = 0: enqueue v',
    '  if |order| < |V|: the graph has a cycle',
  ],
  fields: [{ ...graphField, hint: 'use A>B for "A before B"' }],
  defaults: { graph: DAG },
  presets: [
    { label: 'Has a cycle', params: { graph: 'A>B, B>C, C>A, C>D, E>A' }, note: 'A, B, C wait on each other forever.' },
    { label: 'Self-loop', params: { graph: 'A>B, B>B, B>C' }, note: 'B depends on itself — a cycle of length 1.' },
    { label: 'Independent nodes', params: { graph: 'A, B, C, D>E' }, note: 'No edges between most nodes: many valid orders.' },
    { label: 'Chain', params: { graph: 'A>B, B>C, C>D, D>E' }, note: 'Exactly one valid order.' },
    { label: 'Undirected edge', params: { graph: 'A-B, B>C' }, note: 'A-B means both A>B and B>A → a 2-cycle.' },
  ],
  legend: ['frontier', 'active', 'sorted', 'bad'],
  run(p) {
    const g = buildGraph(str(p.graph, DAG), true);
    const r = new Recorder(['processed']);
    if (!precheck(g, null, r)) return r.steps;
    const indeg = new Map(g.ids.map((id) => [id, 0]));
    for (const [, l] of g.adj) for (const { to } of l) indeg.set(to, indeg.get(to)! + 1);
    const queue = g.ids.filter((id) => indeg.get(id) === 0);
    const order: string[] = [];
    const done = new Set<string>();
    const views = (u?: string, v?: string, bad?: string[]): Viz[] => {
      const t: Record<string, Tone> = {};
      for (const id of done) t[id] = 'sorted';
      for (const id of queue) t[id] = 'frontier';
      if (u) t[u] = 'active';
      if (v) t[v] = 'compare';
      for (const id of bad ?? []) t[id] = 'bad';
      const et: Record<string, Tone> = {};
      for (const id of done) for (const { to } of g.adj.get(id)!) et[ek(g, id, to)] = 'dim';
      if (u && v) et[ek(g, u, v)] = 'compare';
      const badges = Object.fromEntries(g.ids.filter((id) => !done.has(id)).map((id) => [id, `in=${indeg.get(id)}`]));
      return [gview(g, t, et, badges, undefined, false), list('Ready queue', queue, 'queue', 0), list('Order', order, 'queue')];
    };
    r.push(1, 'Count incoming edges for every vertex.', views());
    r.push(2, queue.length ? `Vertices with no prerequisites: ${queue.join(', ')}.` : 'Edge case: no vertex has in-degree 0 — there must be a cycle.', views());
    while (queue.length) {
      const u = queue.shift()!;
      order.push(u);
      done.add(u);
      r.inc('processed');
      r.push(4, `Take ${u} → order is now ${order.join(', ')}.`, views(u), { u });
      for (const { to: v } of g.adj.get(u)!) {
        indeg.set(v, indeg.get(v)! - 1);
        r.push(6, `Remove ${u}→${v}: in-degree of ${v} drops to ${indeg.get(v)}.`, views(u, v), { u, v });
        if (indeg.get(v) === 0 && !done.has(v)) {
          queue.push(v);
          r.push(7, `${v} has no remaining prerequisites — enqueue it.`, views(u, v), { v });
        }
      }
    }
    const left = g.ids.filter((id) => !done.has(id));
    if (left.length) r.push(8, `Edge case: ${left.join(', ')} never reached in-degree 0 — they are on a cycle or depend on one. No topological order exists (partial order: ${order.join(', ') || 'none'}).`, views(undefined, undefined, left));
    else r.push(8, `Valid topological order: ${order.join(' → ')}.`, views());
    return r.steps;
  },
};

const FW_DEF = 'A>B:3, A>C:8, A>E:-4, B>D:1, B>E:7, C>B:4, D>A:2, D>C:-5, E>D:6';
const floyd: Algorithm = {
  id: 'floyd-warshall',
  name: 'Floyd–Warshall',
  category: 'graph',
  difficulty: 'Advanced',
  summary: 'All-pairs shortest paths by allowing one more intermediate vertex k at a time.',
  about: [
    'D[i][j] holds the shortest i→j distance using only intermediate vertices from the first k. Adding vertex k as a possible stop: D[i][j] = min(D[i][j], D[i][k] + D[k][j]).',
    'Works with negative edges. Edge case: a negative value on the diagonal D[i][i] < 0 at the end means vertex i lies on a negative cycle.',
  ],
  time: { best: 'O(V³)', avg: 'O(V³)', worst: 'O(V³)' },
  space: 'O(V²)',
  code: [
    'procedure floydWarshall(G):',
    '  D[i][j] ← w(i, j); D[i][i] ← 0; otherwise ∞',
    '  for k in V:',
    '    for i in V:',
    '      for j in V:',
    '        if D[i][k] + D[k][j] < D[i][j]:',
    '          D[i][j] ← D[i][k] + D[k][j]',
    '  if any D[i][i] < 0: negative cycle',
  ],
  fields: [{ ...graphField, hint: 'directed: A>B:w (up to 7 nodes)' }],
  defaults: { graph: FW_DEF },
  presets: [
    { label: 'Negative cycle', params: { graph: 'A>B:1, B>C:-3, C>A:1, C>D:2' }, note: 'Diagonal entries turn negative.' },
    { label: 'Disconnected', params: { graph: 'A>B:2, B>A:2, C>D:1' }, note: 'Pairs across components stay ∞.' },
    { label: 'Undirected', params: { graph: 'A-B:4, B-C:1, A-C:7, C-D:2' }, note: 'A-B is treated as two directed edges.' },
    { label: 'Single node', params: { graph: 'A' }, note: 'A 1×1 matrix: D[A][A] = 0.' },
  ],
  legend: ['active', 'compare', 'found', 'bad'],
  run(p) {
    const g = buildGraph(str(p.graph, FW_DEF), true);
    const r = new Recorder(['checks', 'updates']);
    if (!precheck(g, null, r)) return r.steps;
    const ids = g.ids.slice(0, 7);
    const n = ids.length;
    const ix = new Map(ids.map((id, i) => [id, i]));
    const D = ids.map((_, i) => ids.map((_, j) => (i === j ? 0 : Infinity)));
    for (const e of g.arcs) {
      const i = ix.get(e.a);
      const j = ix.get(e.b);
      if (i === undefined || j === undefined) continue;
      if (i === j) D[i][i] = Math.min(D[i][i], e.w!);
      else D[i][j] = Math.min(D[i][j], e.w!);
    }
    const table = (tones: Record<string, Tone>, title: string): TableViz => ({
      kind: 'table',
      title,
      rowHeaders: ids,
      colHeaders: ids,
      cells: D.map((row) => row.map(fmtDist)),
      tones,
    });
    if (g.ids.length > 7) r.push(1, `Only the first 7 vertices are used to keep the matrix readable.`, [gview(g)]);
    r.push(1, 'Start with direct edge weights; 0 on the diagonal, ∞ where no edge.', [gview(g), table({}, 'D (k = none)')]);
    for (let k = 0; k < n; k++) {
      const kt: Record<string, Tone> = {};
      for (let x = 0; x < n; x++) {
        kt[`${k},${x}`] = 'range';
        kt[`${x},${k}`] = 'range';
      }
      r.push(2, `Allow ${ids[k]} as an intermediate stop. Row and column ${ids[k]} are the "via" values.`, [gview(g, { [ids[k]]: 'pivot' }), table(kt, `D (via ${ids[k]})`)], { k: ids[k] });
      for (let i = 0; i < n; i++) {
        if (i === k || D[i][k] === Infinity) continue;
        for (let j = 0; j < n; j++) {
          if (j === k || D[k][j] === Infinity) continue;
          r.inc('checks');
          const cand = D[i][k] + D[k][j];
          const better = cand < D[i][j];
          const tones: Record<string, Tone> = { ...kt, [`${i},${k}`]: 'compare', [`${k},${j}`]: 'compare', [`${i},${j}`]: better ? 'found' : 'active' };
          if (better) {
            const old = D[i][j];
            D[i][j] = cand;
            r.inc('updates');
            r.push(6, `${ids[i]}→${ids[k]}→${ids[j]} = ${cand} beats ${fmtDist(old)}. Update D[${ids[i]}][${ids[j]}].`, [gview(g, { [ids[i]]: 'active', [ids[k]]: 'pivot', [ids[j]]: 'active' }), table(tones, `D (via ${ids[k]})`)], { k: ids[k], i: ids[i], j: ids[j] });
          } else {
            r.push(5, `${ids[i]}→${ids[k]}→${ids[j]} = ${cand} is not shorter than ${fmtDist(D[i][j])}.`, [gview(g, { [ids[i]]: 'active', [ids[k]]: 'pivot', [ids[j]]: 'active' }), table(tones, `D (via ${ids[k]})`)], { k: ids[k], i: ids[i], j: ids[j] });
          }
        }
      }
    }
    const neg = ids.filter((_, i) => D[i][i] < 0);
    const tones: Record<string, Tone> = {};
    neg.forEach((id) => (tones[`${ix.get(id)},${ix.get(id)}`] = 'bad'));
    r.push(7, neg.length ? `Edge case: negative diagonal at ${neg.join(', ')} → those vertices are on a negative cycle; affected distances are meaningless.` : 'Done — D now holds every shortest pairwise distance.', [gview(g, Object.fromEntries(neg.map((id) => [id, 'bad' as Tone]))), table(tones, 'Final D')]);
    return r.steps;
  },
};

const MAZE = ['S . . # . . . .', '. # . # . # # .', '. # . . . # . .', '. # # # . # . #', '. . . # . . . G'].join('\n');
const astar: Algorithm = {
  id: 'a-star',
  name: 'A* Pathfinding',
  category: 'graph',
  difficulty: 'Advanced',
  summary: 'Best-first search on a grid using cost-so-far g plus a heuristic h towards the goal.',
  about: [
    'A* always expands the open cell with the lowest f = g + h, where g is the steps taken and h is the Manhattan distance to the goal. A good heuristic focuses the search toward the target.',
    'With an admissible heuristic (never overestimates) the first time the goal is expanded its path is optimal. If the open set empties first, no path exists.',
  ],
  time: { best: 'O(d)', avg: 'O(E log V)', worst: 'O(E log V)' },
  space: 'O(V)',
  code: [
    'procedure aStar(grid, S, G):',
    '  open ← {S}; g[S] ← 0; f[S] ← h(S)',
    '  while open not empty:',
    '    cur ← cell in open with lowest f',
    '    if cur = G: reconstruct path; return',
    '    move cur from open to closed',
    '    for each 4-way neighbour n that is not a wall:',
    '      if g[cur] + 1 < g[n]:',
    '        parent[n] ← cur; g[n] ← g[cur] + 1; f[n] ← g[n] + h(n); open.add(n)',
    '  return "no path"',
  ],
  fields: [{ key: 'grid', label: 'Grid', kind: 'text', hint: 'S start · G goal · # wall · . open (space-separated rows)' }],
  defaults: { grid: MAZE },
  random: () => {
    const R = 7;
    const C = 10;
    const rows = Array.from({ length: R }, (_, r) => Array.from({ length: C }, (_, c) => (r === 0 && c === 0 ? 'S' : r === R - 1 && c === C - 1 ? 'G' : Math.random() < 0.28 ? '#' : '.')).join(' '));
    return { grid: rows.join('\n') };
  },
  presets: [
    { label: 'No path', params: { grid: ['S . # . .', '. . # . .', '# # # . G'].join('\n') }, note: 'The goal is walled off; open set runs dry.' },
    { label: 'Start = goal side', params: { grid: 'S G' }, note: 'Adjacent: one expansion.' },
    { label: 'Open field', params: { grid: ['S . . . . .', '. . . . . .', '. . . . . .', '. . . . . G'].join('\n') }, note: 'Heuristic leads straight to the goal.' },
    { label: 'Trap (U-shape)', params: { grid: ['. . . . . . .', '. # # # # # .', '. . . S . # .', '. # # # # # .', '. . . . . . G'].join('\n') }, note: 'Heuristic points into a dead end first.' },
    { label: 'Missing goal', params: { grid: 'S . . .' }, note: 'Input must contain both S and G.' },
  ],
  legend: ['start', 'goal', 'frontier', 'visited', 'active', 'path', 'wall'],
  run(p) {
    const rows = str(p.grid, MAZE)
      .trim()
      .split('\n')
      .map((l) => l.trim().split(/\s+/).filter(Boolean).map((c) => c[0] ?? '.'));
    const R = rows.length;
    const C = Math.max(...rows.map((r) => r.length));
    let S: [number, number] | null = null;
    let G: [number, number] | null = null;
    rows.forEach((row, r) => row.forEach((c, k) => {
      if (c.toUpperCase() === 'S') S = [r, k];
      if (c.toUpperCase() === 'G') G = [r, k];
    }));
    const r0 = new Recorder(['expanded', 'path length']);
    const key = (r: number, c: number) => `${r},${c}`;
    const wall = (r: number, c: number) => r < 0 || c < 0 || r >= R || c >= C || (rows[r][c] ?? '#') === '#';
    const open = new Set<string>();
    const closed = new Set<string>();
    const gScore = new Map<string, number>();
    const parent = new Map<string, string>();
    let path = new Set<string>();
    const view = (cur?: string): Viz[] => {
      const tones: Record<string, Tone> = {};
      const cells: (string | number | null)[][] = [];
      for (let r = 0; r < R; r++) {
        cells.push([]);
        for (let c = 0; c < C; c++) {
          const k = key(r, c);
          let t: Tone | undefined;
          if (wall(r, c)) t = 'wall';
          else if (path.has(k)) t = 'path';
          else if (k === cur) t = 'active';
          else if (closed.has(k)) t = 'visited';
          else if (open.has(k)) t = 'frontier';
          if (S && k === key(...(S as [number, number]))) t = 'start';
          if (G && k === key(...(G as [number, number]))) t = 'goal';
          if (t) tones[k] = t;
          const ch = rows[r][c]?.toUpperCase();
          cells[r].push(ch === 'S' ? 'S' : ch === 'G' ? 'G' : gScore.has(k) && !wall(r, c) ? gScore.get(k)! : '');
        }
      }
      return [{ kind: 'table', title: 'Grid (numbers = g, steps from S)', cells, tones, grid: true }];
    };
    if (!S || !G) {
      r0.push(0, `Edge case: the grid needs both an S and a G (found ${S ? 'S' : 'no S'}, ${G ? 'G' : 'no G'}).`, view());
      return r0.steps;
    }
    const [gr, gc] = G as [number, number];
    const h = (k: string) => {
      const [r, c] = k.split(',').map(Number);
      return Math.abs(r - gr) + Math.abs(c - gc);
    };
    const sk = key(...(S as [number, number]));
    const gk = key(gr, gc);
    gScore.set(sk, 0);
    open.add(sk);
    r0.push(1, `Open set = {S}. h(S) = ${h(sk)} (Manhattan distance to G).`, view(), { g: 0, h: h(sk) });
    while (open.size) {
      let cur = '';
      let best = Infinity;
      for (const k of open) {
        const f = gScore.get(k)! + h(k);
        if (f < best || (f === best && h(k) < h(cur))) {
          best = f;
          cur = k;
        }
      }
      r0.push(3, `Pick ${cur} with lowest f = g ${gScore.get(cur)} + h ${h(cur)} = ${best}.`, view(cur), { cur, g: gScore.get(cur)!, h: h(cur), f: best });
      if (cur === gk) {
        const pth = new Set<string>();
        let x: string | undefined = cur;
        while (x) {
          pth.add(x);
          x = parent.get(x);
        }
        path = pth;
        r0.inc('path length', pth.size - 1);
        r0.push(4, `Reached G! Follow parents back: shortest path has ${pth.size - 1} steps.`, view(), { length: pth.size - 1 });
        return r0.steps;
      }
      open.delete(cur);
      closed.add(cur);
      r0.inc('expanded');
      const [cr, cc] = cur.split(',').map(Number);
      for (const [dr, dc] of [[-1, 0], [1, 0], [0, -1], [0, 1]]) {
        const nr = cr + dr;
        const nc = cc + dc;
        if (wall(nr, nc)) continue;
        const nk = key(nr, nc);
        const cand = gScore.get(cur)! + 1;
        if (cand < (gScore.get(nk) ?? Infinity)) {
          gScore.set(nk, cand);
          parent.set(nk, cur);
          closed.delete(nk);
          open.add(nk);
        }
      }
      r0.push(8, `Expand ${cur}: update reachable neighbours and add them to the open set.`, view(cur), { cur });
      if (r0.full) break;
    }
    r0.push(9, 'Edge case: open set is empty and G was never reached — no path exists.', view());
    return r0.steps;
  },
};

export const graphAlgorithms: Algorithm[] = [bfs, dfs, dijkstra, bellman, prim, kruskal, topo, floyd, astar];
