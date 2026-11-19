import type { Algorithm, Tone, Viz, GraphViz } from '../lib/types';
import { Recorder, arrayViz, guardEmpty, nums, num, randArray, randInt, rangeTones } from '../lib/recorder';

const twoPointers: Algorithm = {
  id: 'two-pointers',
  name: 'Two Pointers (Pair Sum)',
  category: 'technique',
  difficulty: 'Beginner',
  summary: 'In a sorted array, move a left and right pointer inward to find two values summing to a target.',
  about: [
    'If A[lo] + A[hi] is too small, only moving lo right can increase it; if too large, only moving hi left can decrease it. Each step discards one candidate, so it is O(n).',
    'Edge cases: the pointers must be different indices (an element cannot pair with itself); duplicates like [3, 3] with target 6 are a valid pair; fewer than two elements means no pair.',
  ],
  time: { best: 'O(1)', avg: 'O(n)', worst: 'O(n)' },
  space: 'O(1)',
  code: [
    'procedure pairSum(A, target):     // A sorted',
    '  lo ← 0; hi ← n − 1',
    '  while lo < hi:',
    '    s ← A[lo] + A[hi]',
    '    if s = target: return (lo, hi)',
    '    if s < target: lo ← lo + 1',
    '    else: hi ← hi − 1',
    '  return none',
  ],
  fields: [
    { key: 'array', label: 'Array', kind: 'numbers', hint: 'sorted for you' },
    { key: 'target', label: 'Target', kind: 'number' },
  ],
  defaults: { array: [-8, -3, -1, 2, 4, 7, 11, 15], target: 6 },
  random: () => ({ array: randArray(9, -20, 30).sort((a, b) => a - b), target: randInt(-10, 30) }),
  presets: [
    { label: 'No pair', params: { array: [1, 2, 4, 8], target: 20 }, note: 'Pointers cross without a match.' },
    { label: 'Negative target', params: { array: [-9, -4, -2, 0, 5], target: -6 } },
    { label: 'Duplicates', params: { array: [1, 3, 3, 5], target: 6 }, note: 'Two different 3s form a valid pair.' },
    { label: 'Self-pair trap', params: { array: [1, 3, 8], target: 6 }, note: '3 + 3 would need the same index twice — not allowed.' },
    { label: 'Single', params: { array: [6], target: 12 }, note: 'lo = hi from the start: no pair.' },
    { label: 'Empty', params: { array: [], target: 0 } },
  ],
  legend: ['compare', 'dim', 'found'],
  run(p) {
    const a = [...nums(p.array, [1, 2, 3])].sort((x, y) => x - y);
    const target = num(p.target, 6);
    const n = a.length;
    const r = new Recorder(['checks']);
    let lo = 0;
    let hi = n - 1;
    const view = (t: Record<number, Tone> = {}) => {
      const base: Record<number, Tone> = {};
      for (let k = 0; k < n; k++) if (k < lo || k > hi) base[k] = 'dim';
      return [arrayViz(a, { style: 'cells', tones: { ...base, ...t }, labels: a.map((_, i) => String(i)), pointers: n ? [{ i: lo, label: 'lo' }, { i: Math.max(0, hi), label: 'hi' }] : [] })];
    };
    r.push(1, n < 2 ? `Edge case: only ${n} element(s) — a pair needs two different indices.` : `Find two values summing to ${target}.`, view(), { lo, hi });
    while (lo < hi) {
      const s = a[lo] + a[hi];
      r.inc('checks');
      r.push(3, `A[${lo}] + A[${hi}] = ${a[lo]} + ${a[hi]} = ${s}.`, view({ [lo]: 'compare', [hi]: 'compare' }), { lo, hi, s });
      if (s === target) {
        r.push(4, `Equals ${target} — pair found at indices ${lo} and ${hi}.`, view({ [lo]: 'found', [hi]: 'found' }), { lo, hi, s });
        return r.steps;
      }
      if (s < target) lo++;
      else hi--;
      r.push(s < target ? 5 : 6, s < target ? `${s} < ${target} → need a bigger sum, move lo right.` : `${s} > ${target} → need a smaller sum, move hi left.`, view(), { lo, hi });
    }
    if (n >= 2) r.push(7, `Pointers met — no pair sums to ${target}.`, view());
    return r.steps;
  },
};

const slidingWindow: Algorithm = {
  id: 'sliding-window',
  name: 'Sliding Window (Max Sum of k)',
  category: 'technique',
  difficulty: 'Beginner',
  summary: 'Slide a fixed-size window: add the entering element, subtract the leaving one.',
  about: [
    'Recomputing each window from scratch is O(n·k). Sliding reuses the previous sum: new = old + A[i] − A[i−k], giving O(n).',
    'Edge cases: k larger than n has no window; k = n has exactly one; with all-negative input the best is the least-negative window, so start best at the first window, not 0.',
  ],
  time: { best: 'O(n)', avg: 'O(n)', worst: 'O(n)' },
  space: 'O(1)',
  code: [
    'procedure maxWindow(A, k):',
    '  if k ≤ 0 or k > n: return none',
    '  sum ← A[0] + … + A[k−1]; best ← sum',
    '  for i ← k to n−1:',
    '    sum ← sum + A[i] − A[i−k]',
    '    best ← max(best, sum)',
    '  return best',
  ],
  fields: [
    { key: 'array', label: 'Array', kind: 'numbers' },
    { key: 'k', label: 'Window k', kind: 'number' },
  ],
  defaults: { array: [4, -2, 7, 1, -8, 3, 9, -1, 2, 6], k: 3 },
  random: () => ({ array: randArray(11, -10, 15), k: randInt(2, 4) }),
  presets: [
    { label: 'All negative', params: { array: [-5, -2, -8, -1, -9], k: 2 }, note: 'Best is −3, not 0.' },
    { label: 'k = n', params: { array: [3, -1, 4], k: 3 }, note: 'Exactly one window.' },
    { label: 'k > n', params: { array: [3, -1], k: 5 }, note: 'No window fits.' },
    { label: 'k = 1', params: { array: [2, -7, 5, 1], k: 1 }, note: 'Just the maximum element.' },
    { label: 'k = 0', params: { array: [1, 2], k: 0 }, note: 'Invalid size.' },
  ],
  legend: ['range', 'found', 'compare'],
  run(p) {
    const a = nums(p.array, [4, 2, 7]);
    const k = Math.round(num(p.k, 3));
    const n = a.length;
    const r = new Recorder(['updates']);
    if (k <= 0 || k > n) {
      r.push(1, `Edge case: k = ${k} with n = ${n} — ${k <= 0 ? 'a window must hold at least one element' : 'the window is larger than the array'}, so there is no answer.`, [arrayViz(a, { style: 'cells' })]);
      return r.steps;
    }
    let sum = a.slice(0, k).reduce((s, x) => s + x, 0);
    let best = sum;
    let bestAt = 0;
    const view = (start: number, t: Record<number, Tone> = {}): Viz[] => [arrayViz(a, { style: 'bars', tones: { ...rangeTones(bestAt, bestAt + k - 1, 'found'), ...rangeTones(start, start + k - 1, 'range'), ...t }, pointers: [{ i: start, label: 'L' }, { i: start + k - 1, label: 'R' }] })];
    r.push(2, `First window [0..${k - 1}] sums to ${sum}.`, view(0), { sum, best });
    for (let i = k; i < n; i++) {
      sum += a[i] - a[i - k];
      r.inc('updates');
      r.push(4, `Slide: + A[${i}] (${a[i]}) − A[${i - k}] (${a[i - k]}) → sum = ${sum}.`, view(i - k + 1, { [i]: 'compare', [i - k]: 'dim' }), { sum, best });
      if (sum > best) {
        best = sum;
        bestAt = i - k + 1;
        r.push(5, `New best ${best}.`, view(i - k + 1), { sum, best });
      }
    }
    r.push(6, `Best window starts at ${bestAt} with sum ${best}.`, [arrayViz(a, { style: 'bars', tones: rangeTones(bestAt, bestAt + k - 1, 'found') })], { best });
    return r.steps;
  },
};

const dutch: Algorithm = {
  id: 'dutch-flag',
  name: 'Dutch National Flag',
  category: 'technique',
  difficulty: 'Intermediate',
  summary: 'Three-way partition around a pivot (< pivot | = pivot | > pivot) in one pass.',
  about: [
    'Three pointers: everything before lo is < pivot, lo..mid−1 equals the pivot, after hi is > pivot, and mid..hi is unknown. Each step classifies A[mid].',
    'This is the trick behind 3-way quicksort, which stays fast on arrays with many duplicates. Edge cases: pivot absent, all equal, all smaller.',
  ],
  time: { best: 'O(n)', avg: 'O(n)', worst: 'O(n)' },
  space: 'O(1)',
  code: [
    'procedure partition3(A, pivot):',
    '  lo ← 0; mid ← 0; hi ← n − 1',
    '  while mid ≤ hi:',
    '    if A[mid] < pivot: swap(A[lo], A[mid]); lo++; mid++',
    '    else if A[mid] = pivot: mid++',
    '    else: swap(A[mid], A[hi]); hi−−     // do not advance mid',
  ],
  fields: [
    { key: 'array', label: 'Array', kind: 'numbers' },
    { key: 'pivot', label: 'Pivot', kind: 'number' },
  ],
  defaults: { array: [2, 0, -1, 1, 2, 0, 1, -1, 2, 1], pivot: 1 },
  random: () => ({ array: randArray(12, -1, 3), pivot: 1 }),
  presets: [
    { label: 'Pivot absent', params: { array: [5, -2, 8, 0, 9], pivot: 3 }, note: 'Middle zone stays empty.' },
    { label: 'All equal', params: { array: [4, 4, 4, 4], pivot: 4 } },
    { label: 'All smaller', params: { array: [-3, -5, -1], pivot: 0 } },
    { label: 'Classic 0/1/2', params: { array: [2, 0, 2, 1, 1, 0], pivot: 1 } },
    { label: 'Empty', params: { array: [], pivot: 0 } },
  ],
  legend: ['found', 'range', 'pivot', 'compare'],
  run(p) {
    const a = [...nums(p.array, [2, 0, 1])];
    const ids = a.map((_, i) => i);
    const pivot = num(p.pivot, 1);
    const n = a.length;
    let lo = 0;
    let mid = 0;
    let hi = n - 1;
    const r = new Recorder(['swaps']);
    const swap = (i: number, j: number) => {
      [a[i], a[j]] = [a[j], a[i]];
      [ids[i], ids[j]] = [ids[j], ids[i]];
    };
    const view = (t: Record<number, Tone> = {}) => [
      arrayViz(a, {
        ids,
        tones: { ...rangeTones(0, lo - 1, 'found'), ...rangeTones(lo, mid - 1, 'pivot'), ...rangeTones(hi + 1, n - 1, 'range'), ...t },
        pointers: [{ i: lo, label: 'lo' }, { i: mid, label: 'mid' }, { i: Math.max(hi, 0), label: 'hi' }].filter((x) => x.i < n),
      }),
    ];
    r.push(1, `Partition around ${pivot}: green < pivot, amber = pivot, violet > pivot.`, view(), { lo, mid, hi });
    while (mid <= hi) {
      const x = a[mid];
      if (x < pivot) {
        swap(lo, mid);
        r.inc('swaps');
        lo++;
        mid++;
        r.push(3, `${x} < ${pivot} → swap into the "less" zone; lo and mid advance.`, view({ [lo - 1]: 'swap' }), { lo, mid, hi });
      } else if (x === pivot) {
        mid++;
        r.push(4, `${x} = pivot → leave it in the middle; mid advances.`, view(), { lo, mid, hi });
      } else {
        swap(mid, hi);
        r.inc('swaps');
        hi--;
        r.push(5, `${x} > ${pivot} → swap to the end; hi shrinks. The new A[mid] is unclassified, so mid stays.`, view({ [hi + 1]: 'swap', [mid]: 'compare' }), { lo, mid, hi });
      }
    }
    r.push(2, 'mid passed hi — every element is classified.', view());
    return r.steps;
  },
};

const floydCycle: Algorithm = {
  id: 'floyd-cycle',
  name: "Floyd's Cycle Detection",
  category: 'technique',
  difficulty: 'Intermediate',
  summary: 'Tortoise moves 1 step, hare moves 2; if there is a loop they must meet inside it.',
  about: [
    'In a linked list with a cycle, the hare gains one node per step on the tortoise, so it eventually laps it. Without a cycle the hare simply reaches null.',
    'To find the loop\'s entry, restart one pointer from the head and move both one step at a time — they meet at the cycle start. Edge cases: empty list, single node, self-loop.',
  ],
  time: { best: 'O(1)', avg: 'O(n)', worst: 'O(n)' },
  space: 'O(1)',
  code: [
    'procedure hasCycle(head):',
    '  slow ← head; fast ← head',
    '  while fast ≠ null and fast.next ≠ null:',
    '    slow ← slow.next; fast ← fast.next.next',
    '    if slow = fast: break                   // cycle!',
    '  if no meeting: return "no cycle"',
    '  slow ← head',
    '  while slow ≠ fast: slow ← slow.next; fast ← fast.next',
    '  return slow                               // cycle entry',
  ],
  fields: [
    { key: 'n', label: 'Nodes', kind: 'number', min: 0, max: 12 },
    { key: 'loop', label: 'Tail links to index', kind: 'number', hint: '−1 = no cycle' },
  ],
  defaults: { n: 9, loop: 3 },
  random: () => {
    const n = randInt(4, 11);
    return { n, loop: randInt(-1, n - 1) };
  },
  presets: [
    { label: 'No cycle', params: { n: 7, loop: -1 }, note: 'Fast pointer reaches null.' },
    { label: 'Self-loop', params: { n: 5, loop: 4 }, note: 'Tail points to itself.' },
    { label: 'Whole list', params: { n: 6, loop: 0 }, note: 'Cycle starts at the head.' },
    { label: 'Single node', params: { n: 1, loop: -1 } },
    { label: 'Single self-loop', params: { n: 1, loop: 0 } },
    { label: 'Empty', params: { n: 0, loop: -1 } },
  ],
  legend: ['active', 'pivot', 'found', 'path'],
  run(p) {
    const n = Math.max(0, Math.min(12, Math.round(num(p.n, 9))));
    let loop = Math.round(num(p.loop, 3));
    if (loop >= n) loop = -1;
    const next = (i: number) => (i < 0 ? -1 : i < n - 1 ? i + 1 : loop);
    const r = new Recorder(['steps']);
    const nodes = Array.from({ length: n }, (_, i) => {
      if (loop < 0 || i < loop) return { id: String(i), x: 40 + i * 70, y: 110, label: String(i) };
      const m = n - loop;
      const cx = 40 + loop * 70 + 110;
      const t = Math.PI + (2 * Math.PI * (i - loop)) / m;
      return { id: String(i), x: cx + 100 * Math.cos(t), y: 110 + 80 * Math.sin(t), label: String(i) };
    });
    const minX = Math.min(...nodes.map((d) => d.x), 40);
    nodes.forEach((d) => (d.x += 40 - minX));
    const edges = Array.from({ length: n }, (_, i) => ({ a: String(i), b: String(next(i)) })).filter((e) => e.b !== '-1');
    const view = (slow: number, fast: number, extra: Record<string, Tone> = {}): Viz[] => {
      const t: Record<string, Tone> = { ...extra };
      if (slow >= 0) t[slow] = 'active';
      if (fast >= 0) t[fast] = slow === fast ? 'found' : 'pivot';
      const badges: Record<string, string> = {};
      if (slow >= 0) badges[slow] = slow === fast ? '🐢🐇' : '🐢';
      if (fast >= 0 && fast !== slow) badges[fast] = '🐇';
      const g: GraphViz = { kind: 'graph', nodes, edges, directed: true, nodeTones: t, badges, width: Math.max(...nodes.map((d) => d.x), 300) + 60, height: 230 };
      return [g];
    };
    if (n === 0) {
      r.push(2, 'Edge case: empty list (head = null) → no cycle.', []);
      return r.steps;
    }
    let slow = 0;
    let fast = 0;
    r.push(1, 'Both pointers start at the head.', view(slow, fast), { slow, fast });
    let met = false;
    while (fast !== -1 && next(fast) !== -1) {
      slow = next(slow);
      fast = next(next(fast));
      r.inc('steps');
      r.push(3, `Tortoise → ${slow}, hare → ${fast === -1 ? 'null' : fast}.`, view(slow, fast), { slow, fast });
      if (slow === fast) {
        met = true;
        r.push(4, `They meet at node ${slow} — there is a cycle.`, view(slow, fast), { slow, fast });
        break;
      }
    }
    if (!met) {
      r.push(5, `Hare reached the end (null) — no cycle.${n === 1 ? ' (Edge case: single node without a self-loop.)' : ''}`, view(slow, -1), { slow });
      return r.steps;
    }
    slow = 0;
    r.push(6, 'Move the tortoise back to the head; both now move one step at a time.', view(slow, fast), { slow, fast });
    while (slow !== fast) {
      slow = next(slow);
      fast = next(fast);
      r.inc('steps');
      r.push(7, `Tortoise → ${slow}, hare → ${fast}.`, view(slow, fast), { slow, fast });
    }
    const cyc: Record<string, Tone> = {};
    let k = slow;
    do {
      cyc[k] = 'path';
      k = next(k);
    } while (k !== slow);
    r.push(8, `Cycle entry is node ${slow}; the loop has ${Object.keys(cyc).length} node(s).`, view(slow, slow, cyc), { entry: slow });
    return r.steps;
  },
};

export const techniqueAlgorithms: Algorithm[] = [
  guardEmpty(twoPointers, 'array', 'Edge case: empty array — there are no elements, so no pair exists.'),
  slidingWindow,
  guardEmpty(dutch, 'array', 'Edge case: empty array — nothing to partition.'),
  floydCycle,
];
