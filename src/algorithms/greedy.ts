import type { Algorithm, Tone, Viz, TableViz, GraphViz } from '../lib/types';
import { Recorder, arrayViz, nums, num, randArray, randInt } from '../lib/recorder';

const activity: Algorithm = {
  id: 'activity-selection',
  name: 'Activity Selection',
  category: 'greedy',
  difficulty: 'Beginner',
  summary: 'Pick the most non-overlapping intervals by always taking the one that ends first.',
  about: [
    'Sort by finish time. Taking the earliest-finishing activity leaves the most room for the rest — an exchange argument proves this is optimal.',
    'Edge cases: touching intervals (one ends exactly when the next starts) are compatible here; identical intervals can only be chosen once; zero-length intervals are fine.',
  ],
  time: { best: 'O(n log n)', avg: 'O(n log n)', worst: 'O(n log n)' },
  space: 'O(n)',
  code: [
    'procedure selectActivities(intervals):',
    '  sort intervals by end time',
    '  lastEnd ← −∞; chosen ← []',
    '  for (s, e) in intervals:',
    '    if s ≥ lastEnd:',
    '      chosen.append((s, e)); lastEnd ← e',
    '    else: skip — overlaps the previous choice',
    '  return chosen',
  ],
  fields: [{ key: 'intervals', label: 'Intervals', kind: 'text', hint: 'start-end pairs, e.g. 1-4, 3-5 (negatives OK: -2-1)' }],
  defaults: { intervals: '1-4, 3-5, 0-6, 5-7, 3-9, 5-9, 6-10, 8-11, 8-12, 2-14, 12-16' },
  random: () => ({
    intervals: Array.from({ length: 9 }, () => {
      const s = randInt(0, 14);
      return `${s}-${s + randInt(1, 5)}`;
    }).join(', '),
  }),
  presets: [
    { label: 'Touching', params: { intervals: '1-3, 3-5, 5-7' }, note: 'end = next start → all three fit.' },
    { label: 'All overlap', params: { intervals: '0-10, 1-9, 2-8' }, note: 'Only one can be chosen.' },
    { label: 'Duplicates', params: { intervals: '2-4, 2-4, 2-4, 5-6' } },
    { label: 'Negative times', params: { intervals: '-5--2, -3-1, 0-2, -1-0' }, note: 'Times before zero still sort correctly.' },
    { label: 'Longest first trap', params: { intervals: '0-10, 1-2, 3-4, 5-6' }, note: 'Picking by duration or start time would fail.' },
    { label: 'Empty', params: { intervals: '' } },
  ],
  legend: ['compare', 'found', 'bad'],
  run(p) {
    const raw = typeof p.intervals === 'string' ? p.intervals : '';
    const iv = raw
      .split(/[,;\n]+/)
      .map((t) => t.trim().match(/^(-?\d+)\s*-\s*(-?\d+)$/))
      .filter((m): m is RegExpMatchArray => !!m)
      .map((m) => [Number(m[1]), Number(m[2])] as [number, number])
      .map(([s, e]) => (s <= e ? [s, e] : [e, s]) as [number, number]);
    const r = new Recorder(['chosen', 'skipped']);
    if (!iv.length) {
      r.push(7, 'Edge case: no intervals → nothing to choose.', []);
      return r.steps;
    }
    iv.sort((a, b) => a[1] - b[1] || a[0] - b[0]);
    const lo = Math.min(...iv.map((x) => x[0]));
    const hi = Math.max(...iv.map((x) => x[1]));
    const status: (Tone | undefined)[] = new Array(iv.length).fill(undefined);
    const view = (hot = -1): Viz[] => {
      const cols = Array.from({ length: hi - lo + 1 }, (_, i) => String(lo + i));
      const tones: Record<string, Tone> = {};
      const cells = iv.map(([s, e], row) =>
        cols.map((_, c) => {
          const t = lo + c;
          const inside = t >= s && (t < e || (s === e && t === s));
          if (inside) tones[`${row},${c}`] = row === hot ? 'compare' : status[row] ?? 'range';
          return inside ? '' : null;
        }),
      );
      const t: TableViz = { kind: 'table', title: 'Timeline (sorted by end)', cells, tones, rowHeaders: iv.map(([s, e]) => `${s}–${e}`), colHeaders: cols };
      return [t];
    };
    r.push(1, 'Sort the activities by end time.', view());
    let lastEnd = -Infinity;
    iv.forEach(([s, e], i) => {
      r.push(4, `Activity ${s}–${e}: does it start at or after lastEnd = ${lastEnd === -Infinity ? '−∞' : lastEnd}?`, view(i), { s, e, lastEnd: lastEnd === -Infinity ? '−∞' : lastEnd });
      if (s >= lastEnd) {
        status[i] = 'found';
        lastEnd = e;
        r.inc('chosen');
        r.push(5, `Yes → choose it. lastEnd = ${e}.`, view(), { lastEnd });
      } else {
        status[i] = 'bad';
        r.inc('skipped');
        r.push(6, `No — it overlaps the last chosen activity. Skip.`, view(), { lastEnd });
      }
    });
    r.push(7, `Chose ${status.filter((t) => t === 'found').length} non-overlapping activities.`, view());
    return r.steps;
  },
};

const fractional: Algorithm = {
  id: 'fractional-knapsack',
  name: 'Fractional Knapsack',
  category: 'greedy',
  difficulty: 'Beginner',
  summary: 'Take items by best value per weight; split the last one if it does not fully fit.',
  about: [
    'Because items can be cut, the greedy ratio order is optimal — unlike 0/1 knapsack, where it can fail.',
    'Edge cases: capacity 0 takes nothing; zero-weight items have infinite ratio and are always taken whole; everything fitting means no fraction is needed.',
  ],
  time: { best: 'O(n log n)', avg: 'O(n log n)', worst: 'O(n log n)' },
  space: 'O(n)',
  code: [
    'procedure fractionalKnapsack(items, W):',
    '  sort items by value/weight descending',
    '  total ← 0',
    '  for (w, v) in items:',
    '    if W = 0: break',
    '    take ← min(w, W)',
    '    total ← total + v · take / w; W ← W − take',
    '  return total',
  ],
  fields: [
    { key: 'weights', label: 'Weights', kind: 'numbers' },
    { key: 'values', label: 'Values', kind: 'numbers' },
    { key: 'capacity', label: 'Capacity', kind: 'number' },
  ],
  defaults: { weights: [10, 20, 30], values: [60, 100, 120], capacity: 50 },
  random: () => ({ weights: randArray(4, 5, 30), values: randArray(4, 10, 120), capacity: randInt(20, 60) }),
  presets: [
    { label: 'Capacity 0', params: { weights: [5, 10], values: [10, 30], capacity: 0 } },
    { label: 'All fit', params: { weights: [2, 3], values: [4, 9], capacity: 100 }, note: 'No fractions needed.' },
    { label: 'Zero weight', params: { weights: [0, 4, 6], values: [5, 8, 6], capacity: 4 }, note: 'Free value — ratio ∞.' },
    { label: 'Equal ratios', params: { weights: [2, 4, 6], values: [4, 8, 12], capacity: 7 }, note: 'Order among ties does not matter.' },
  ],
  legend: ['compare', 'found', 'range'],
  run(p) {
    const ws = nums(p.weights, [10, 20, 30]);
    const vs = nums(p.values, [60, 100, 120]);
    let W = Math.max(0, num(p.capacity, 50));
    const items = ws
      .slice(0, Math.min(ws.length, vs.length))
      .map((w, i) => ({ id: i + 1, w: Math.max(0, w), v: vs[i], ratio: w > 0 ? vs[i] / w : Infinity, take: 0 }))
      .sort((a, b) => b.ratio - a.ratio);
    const r = new Recorder([]);
    let total = 0;
    const view = (hot = -1): Viz[] => [
      {
        kind: 'table',
        title: 'Items by value/weight',
        colHeaders: ['w', 'v', 'v/w', 'taken'],
        rowHeaders: items.map((it) => `#${it.id}`),
        cells: items.map((it) => [it.w, it.v, it.ratio === Infinity ? '∞' : +it.ratio.toFixed(2), it.take ? (it.take === it.w ? 'all' : `${+(it.take / it.w).toFixed(2)}×`) : '']),
        tones: Object.fromEntries(items.flatMap((it, i) => (i === hot ? [[`${i},2`, 'compare' as Tone]] : it.take ? [[`${i},3`, (it.take === it.w ? 'found' : 'range') as Tone]] : []))),
      },
    ];
    if (!items.length) {
      r.push(7, 'Edge case: no items → total 0.', view());
      return r.steps;
    }
    r.push(1, 'Sort by value per unit weight, highest first.', view(), { W });
    for (let i = 0; i < items.length; i++) {
      const it = items[i];
      if (W <= 0) {
        r.push(4, `Knapsack is full${i === 0 ? ' (edge case: capacity 0)' : ''} — stop.`, view(), { W });
        break;
      }
      const take = Math.min(it.w, W);
      it.take = take;
      const gained = it.w === 0 ? it.v : (it.v * take) / it.w;
      total += gained;
      W -= take;
      r.push(6, it.w === 0 ? `Item #${it.id} weighs 0 → take it for free (+${it.v}).` : take === it.w ? `Take all of #${it.id} (w ${it.w}) → +${it.v}. Remaining capacity ${W}.` : `Only ${take} of ${it.w} fits → take ${+(take / it.w).toFixed(2)} of #${it.id} → +${+gained.toFixed(2)}.`, view(i), { W, total: +total.toFixed(2) });
    }
    r.push(7, `Maximum value = ${+total.toFixed(2)}.`, view(), { total: +total.toFixed(2) });
    return r.steps;
  },
};

const greedyCoins: Algorithm = {
  id: 'greedy-coin-change',
  name: 'Greedy Coin Change',
  category: 'greedy',
  difficulty: 'Beginner',
  summary: 'Repeatedly take the largest coin that still fits — optimal only for some coin systems.',
  about: [
    'For "canonical" systems like 1, 5, 10, 25, taking the largest coin first always gives the fewest coins.',
    'Edge cases: with coins 1, 3, 4 and amount 6 greedy returns 4+1+1 (3 coins) while 3+3 is optimal; with 2, 5 and amount 3 greedy gets stuck although no solution exists anyway. Compare with the DP version.',
  ],
  time: { best: 'O(k)', avg: 'O(k + A/c)', worst: 'O(A)' },
  space: 'O(1)',
  code: [
    'procedure greedyChange(coins, A):',
    '  sort coins descending',
    '  for c in coins:',
    '    while A ≥ c:',
    '      take c; A ← A − c',
    '  if A > 0: greedy failed to reach the amount',
    '  return taken coins',
  ],
  fields: [
    { key: 'coins', label: 'Coins', kind: 'numbers' },
    { key: 'amount', label: 'Amount', kind: 'number' },
  ],
  defaults: { coins: [25, 10, 5, 1], amount: 63 },
  presets: [
    { label: 'Greedy not optimal', params: { coins: [1, 3, 4], amount: 6 }, note: 'Gives 3 coins; optimum is 2.' },
    { label: 'Stuck', params: { coins: [5, 2], amount: 3 }, note: 'Remainder left over.' },
    { label: 'Greedy misses a solution', params: { coins: [5, 4], amount: 8 }, note: 'Takes 5, then 3 is unpayable — but 4+4 works.' },
    { label: 'Amount 0', params: { coins: [1, 5], amount: 0 } },
  ],
  legend: ['compare', 'found', 'bad'],
  run(p) {
    const coins = [...new Set(nums(p.coins, [25, 10, 5, 1]).filter((c) => c > 0))].sort((a, b) => b - a);
    let A = Math.max(0, Math.round(num(p.amount, 63)));
    const start = A;
    const taken: number[] = [];
    const r = new Recorder(['coins']);
    const view = (ci = -1): Viz[] => [arrayViz(coins, { style: 'cells', title: 'Coins (largest first)', tones: ci >= 0 ? { [ci]: 'compare' } : {} }), { kind: 'list', title: 'Taken', items: taken, mode: 'queue' }];
    r.push(1, `Amount ${A}. Sort coins descending.`, view(), { A });
    if (A === 0) {
      r.push(6, 'Edge case: amount 0 — no coins needed.', view());
      return r.steps;
    }
    coins.forEach((c, i) => {
      r.push(3, `Can ${c} fit into ${A}?`, view(i), { A, c });
      while (A >= c) {
        A -= c;
        taken.push(c);
        r.inc('coins');
        r.push(4, `Take ${c} → remaining ${A}.`, view(i), { A, c });
      }
    });
    if (A > 0) r.push(5, `Edge case: ${A} is left over and no coin fits. Greedy failed${coins.length ? ' — a DP may still find a solution' : ''}.`, view(), { A });
    else r.push(6, `${start} = ${taken.join(' + ')} (${taken.length} coins). Greedy is optimal only for canonical coin systems — check with Coin Change (DP).`, view());
    return r.steps;
  },
};

const jumpGame: Algorithm = {
  id: 'jump-game',
  name: 'Jump Game',
  category: 'greedy',
  difficulty: 'Intermediate',
  summary: 'Can you reach the last index if A[i] is the max jump length from i? Track the farthest reach.',
  about: [
    'Scan left to right keeping farthest = max(i + A[i]) over every index we can reach. If i ever passes farthest, we are stuck.',
    'Edge cases: a single element is already at the end; a 0 that every path must land on blocks you; negative jump lengths are treated as 0 (you cannot jump backwards here).',
  ],
  time: { best: 'O(1)', avg: 'O(n)', worst: 'O(n)' },
  space: 'O(1)',
  code: [
    'procedure canJump(A):',
    '  farthest ← 0',
    '  for i ← 0 to n−1:',
    '    if i > farthest: return false        // unreachable',
    '    farthest ← max(farthest, i + A[i])',
    '    if farthest ≥ n−1: return true',
    '  return true',
  ],
  fields: [{ key: 'array', label: 'Jump lengths', kind: 'numbers' }],
  defaults: { array: [2, 3, 1, 1, 0, 4] },
  random: () => ({ array: randArray(8, 0, 3) }),
  presets: [
    { label: 'Blocked by 0', params: { array: [3, 2, 1, 0, 4] }, note: 'Every path lands on index 3.' },
    { label: 'Single', params: { array: [0] }, note: 'Already at the last index.' },
    { label: 'Leading 0', params: { array: [0, 2, 3] } },
    { label: 'Negative', params: { array: [2, -1, 1, 1] }, note: 'Negative lengths count as 0.' },
    { label: 'Big first jump', params: { array: [9, 0, 0, 0, 0] } },
  ],
  legend: ['active', 'range', 'found', 'bad'],
  run(p) {
    const a = nums(p.array, [2, 3, 1, 1, 4]);
    const n = a.length;
    const r = new Recorder(['steps']);
    if (!n) {
      r.push(6, 'Edge case: empty array — there is no last index; we define the answer as true (nothing to reach).', [arrayViz([], { style: 'cells' })]);
      return r.steps;
    }
    let far = 0;
    const view = (i: number, done?: 'found' | 'bad') => {
      const t: Record<number, Tone> = {};
      for (let k = 0; k <= Math.min(far, n - 1); k++) t[k] = 'range';
      if (i < n) t[i] = done === 'bad' ? 'bad' : 'active';
      if (done === 'found') t[n - 1] = 'found';
      return [arrayViz(a, { style: 'cells', tones: t, labels: a.map((_, k) => String(k)), pointers: [{ i: Math.min(far, n - 1), label: 'farthest' }] })];
    };
    if (n === 1) {
      r.push(5, 'Edge case: one element — we start on the last index.', view(0, 'found'));
      return r.steps;
    }
    for (let i = 0; i < n; i++) {
      r.inc('steps');
      if (i > far) {
        r.push(3, `Index ${i} is beyond the farthest reachable ${far} → stuck. Answer: false.`, view(i, 'bad'), { i, farthest: far });
        return r.steps;
      }
      const jump = Math.max(0, a[i]);
      far = Math.max(far, i + jump);
      r.push(4, `From ${i} we can jump ${jump}${a[i] < 0 ? ` (negative ${a[i]} treated as 0)` : ''} → farthest = ${far}.`, view(i), { i, farthest: far });
      if (far >= n - 1) {
        r.push(5, `Farthest ${far} ≥ last index ${n - 1}. Answer: true.`, view(i, 'found'), { i, farthest: far });
        return r.steps;
      }
    }
    return r.steps;
  },
};

interface HNode {
  id: string;
  w: number;
  label: string;
  left?: HNode;
  right?: HNode;
}
const huffman: Algorithm = {
  id: 'huffman',
  name: 'Huffman Coding',
  category: 'greedy',
  difficulty: 'Advanced',
  summary: 'Build an optimal prefix code by repeatedly merging the two least frequent symbols.',
  about: [
    'Put every symbol in a min-priority queue by frequency. Pop the two smallest, merge them under a new parent whose weight is their sum, push it back. The last node is the root.',
    'Left edges are 0, right edges are 1: frequent symbols end up near the root with short codes. Edge case: a text with one distinct symbol still needs a 1-bit code.',
  ],
  time: { best: 'O(n log n)', avg: 'O(n log n)', worst: 'O(n log n)' },
  space: 'O(n)',
  code: [
    'procedure huffman(text):',
    '  count frequency of each symbol',
    '  pq ← min-heap of leaves by frequency',
    '  while |pq| > 1:',
    '    a ← pq.pop(); b ← pq.pop()',
    '    pq.push(node(a.w + b.w, left=a, right=b))',
    '  assign codes: left = 0, right = 1',
  ],
  fields: [{ key: 'text', label: 'Text', kind: 'text' }],
  defaults: { text: 'ABRACADABRA' },
  presets: [
    { label: 'One symbol', params: { text: 'AAAAA' }, note: 'Gets code "0" — not an empty code.' },
    { label: 'Uniform', params: { text: 'ABCDEFGH' }, note: 'All equal → balanced tree, 3 bits each.' },
    { label: 'Skewed', params: { text: 'AAAAAAAABBBBCCD' } },
    { label: 'Spaces', params: { text: 'a b a c' }, note: 'Space is a symbol too.' },
    { label: 'Empty', params: { text: '' } },
  ],
  legend: ['compare', 'found'],
  run(p) {
    const text = typeof p.text === 'string' ? p.text.slice(0, 60) : 'ABRACADABRA';
    const r = new Recorder(['merges']);
    if (!text.length) {
      r.push(1, 'Edge case: empty text → no symbols, no code.', []);
      return r.steps;
    }
    const freq = new Map<string, number>();
    for (const ch of text) freq.set(ch, (freq.get(ch) ?? 0) + 1);
    const show = (ch: string) => (ch === ' ' ? '␣' : ch);
    let pq: HNode[] = [...freq].map(([ch, w]) => ({ id: `leaf-${ch}`, w, label: `${show(ch)}:${w}` }));
    let uid = 0;
    const forest = (hot: Set<string> = new Set()): GraphViz => {
      const nodes: GraphViz['nodes'] = [];
      const edges: GraphViz['edges'] = [];
      const tones: Record<string, Tone> = {};
      let x = 0;
      const place = (n: HNode, d: number): number => {
        if (!n.left || !n.right) {
          const px = x++ * 60 + 40;
          nodes.push({ id: n.id, x: px, y: 40 + d * 64, label: n.label });
          if (hot.has(n.id)) tones[n.id] = 'compare';
          return px;
        }
        const lx = place(n.left, d + 1);
        const rx = place(n.right, d + 1);
        const px = (lx + rx) / 2;
        nodes.push({ id: n.id, x: px, y: 40 + d * 64, label: String(n.w) });
        edges.push({ a: n.id, b: n.left.id, w: 0 }, { a: n.id, b: n.right.id, w: 1 });
        if (hot.has(n.id)) tones[n.id] = 'found';
        return px;
      };
      const sorted = [...pq].sort((a, b) => a.w - b.w);
      const depth = (n: HNode): number => (n.left && n.right ? 1 + Math.max(depth(n.left), depth(n.right)) : 0);
      for (const t of sorted) {
        place(t, 0);
        x += 0.4;
      }
      const maxD = Math.max(0, ...pq.map(depth));
      return { kind: 'graph', title: 'Forest (edge labels are bits)', nodes, edges, nodeTones: tones, width: Math.max(320, x * 60 + 40), height: 80 + maxD * 64 };
    };
    const pqView = () => ({ kind: 'list' as const, title: 'Priority queue', items: [...pq].sort((a, b) => a.w - b.w).map((n) => (n.left ? `(${n.w})` : n.label)), mode: 'queue' as const, tones: { 0: 'compare' as Tone, 1: 'compare' as Tone } });
    r.push(1, `Frequencies: ${[...freq].map(([c, w]) => `${show(c)}=${w}`).join(', ')}.`, [forest(), pqView()]);
    r.push(2, 'Each symbol starts as its own one-node tree.', [forest(), pqView()]);
    if (pq.length === 1) {
      r.push(6, `Edge case: only one distinct symbol. Give it the code "0" so each character still costs 1 bit (${text.length} bits total).`, [forest(), pqView()]);
      return r.steps;
    }
    while (pq.length > 1) {
      pq.sort((a, b) => a.w - b.w);
      const a = pq.shift()!;
      const b = pq.shift()!;
      const m: HNode = { id: `n${uid++}`, w: a.w + b.w, label: String(a.w + b.w), left: a, right: b };
      pq.push(m);
      r.inc('merges');
      r.push(5, `Pop the two smallest (${a.w} and ${b.w}) and merge into a node of weight ${m.w}.`, [forest(new Set([m.id, a.id, b.id])), pqView()]);
    }
    const codes: [string, string][] = [];
    const walk = (n: HNode, code: string) => {
      if (!n.left || !n.right) {
        codes.push([n.label.split(':')[0], code]);
        return;
      }
      walk(n.left, code + '0');
      walk(n.right, code + '1');
    };
    walk(pq[0], '');
    const bits = codes.reduce((s, [ch, c]) => s + c.length * (freq.get(ch === '␣' ? ' ' : ch) ?? 0), 0);
    const tbl: TableViz = { kind: 'table', title: 'Codes', colHeaders: ['freq', 'code'], rowHeaders: codes.map((c) => c[0]), cells: codes.map(([ch, c]) => [freq.get(ch === '␣' ? ' ' : ch) ?? 0, c]) };
    r.push(6, `Done. Encoded size ${bits} bits vs ${text.length * 8} bits in ASCII.`, [forest(), tbl]);
    return r.steps;
  },
};

export const greedyAlgorithms: Algorithm[] = [activity, fractional, greedyCoins, jumpGame, huffman];
