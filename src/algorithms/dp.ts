import type { Algorithm, Tone, Viz, TableViz } from '../lib/types';
import { Recorder, arrayViz, nums, num, str, randArray, randInt } from '../lib/recorder';

const tbl = (cells: (string | number | null)[][], rowHeaders: string[], colHeaders: string[], tones: Record<string, Tone> = {}, title?: string): TableViz => ({
  kind: 'table',
  title,
  cells: cells.map((r) => [...r]),
  rowHeaders,
  colHeaders,
  tones,
});
const INF = Infinity;
const f = (x: number) => (x === INF ? '∞' : x === -INF ? '−∞' : x);

const fib: Algorithm = {
  id: 'fibonacci-dp',
  name: 'Fibonacci (Tabulation)',
  category: 'dp',
  difficulty: 'Beginner',
  summary: 'Build F(0..n) bottom-up so each value is computed exactly once.',
  about: [
    'Naive recursion recomputes the same subproblems exponentially often. Tabulation fills dp[i] = dp[i−1] + dp[i−2] from the base cases upward — O(n) time.',
    'Edge cases: F(0) = 0 and F(1) = 1 are returned directly; negative n is undefined for this definition.',
  ],
  time: { best: 'O(n)', avg: 'O(n)', worst: 'O(n)' },
  space: 'O(n)',
  code: [
    'procedure fib(n):',
    '  if n < 0: error',
    '  if n ≤ 1: return n',
    '  dp[0] ← 0; dp[1] ← 1',
    '  for i ← 2 to n:',
    '    dp[i] ← dp[i−1] + dp[i−2]',
    '  return dp[n]',
  ],
  fields: [{ key: 'n', label: 'n', kind: 'number', min: -5, max: 40 }],
  defaults: { n: 10 },
  random: () => ({ n: randInt(5, 20) }),
  presets: [
    { label: 'n = 0', params: { n: 0 }, note: 'Base case — no loop iterations.' },
    { label: 'n = 1', params: { n: 1 }, note: 'Second base case.' },
    { label: 'n = 2', params: { n: 2 }, note: 'Smallest n that uses the recurrence.' },
    { label: 'Negative n', params: { n: -3 }, note: 'Invalid input must be rejected.' },
    { label: 'n = 40', params: { n: 40 }, note: 'Naive recursion: ~330M calls. Tabulation: 39 additions.' },
  ],
  legend: ['compare', 'found'],
  run(p) {
    const n = Math.round(num(p.n, 10));
    const r = new Recorder(['additions']);
    if (n < 0) {
      r.push(1, `Edge case: n = ${n} is negative — F(n) is not defined here, so we reject the input.`, [arrayViz([], { style: 'cells' })]);
      return r.steps;
    }
    if (n <= 1) {
      r.push(2, `Edge case: n = ${n} is a base case — return ${n} without building a table.`, [arrayViz([n], { style: 'cells', labels: [`F(${n})`], tones: { 0: 'found' } })]);
      return r.steps;
    }
    const nn = Math.min(n, 40);
    const dp: (number | string)[] = new Array(nn + 1).fill('');
    dp[0] = 0;
    dp[1] = 1;
    const labels = dp.map((_, i) => String(i));
    const v = (t: Record<number, Tone> = {}) => [arrayViz(dp, { style: 'cells', labels, tones: t, title: 'dp[i] = F(i)' })];
    if (n > 40) r.push(3, 'Capped at n = 40 to keep the table readable.', v());
    r.push(3, 'Base cases: dp[0] = 0, dp[1] = 1.', v({ 0: 'found', 1: 'found' }));
    for (let i = 2; i <= nn; i++) {
      dp[i] = (dp[i - 1] as number) + (dp[i - 2] as number);
      r.inc('additions');
      r.push(5, `dp[${i}] = dp[${i - 1}] + dp[${i - 2}] = ${dp[i - 1]} + ${dp[i - 2]} = ${dp[i]}.`, v({ [i - 1]: 'compare', [i - 2]: 'compare', [i]: 'found' }), { i });
    }
    r.push(6, `F(${nn}) = ${dp[nn]}.`, v({ [nn]: 'found' }));
    return r.steps;
  },
};

const knapsack: Algorithm = {
  id: 'knapsack-01',
  name: '0/1 Knapsack',
  category: 'dp',
  difficulty: 'Intermediate',
  summary: 'Maximise value within a weight limit; each item is either taken once or left.',
  about: [
    'dp[i][c] = best value using the first i items with capacity c. For item i we either skip it (dp[i−1][c]) or take it if it fits (value + dp[i−1][c − weight]).',
    'Edge cases: capacity 0 or no items gives 0; an item heavier than the capacity can never be taken; zero-weight items are always worth taking.',
  ],
  time: { best: 'O(n·W)', avg: 'O(n·W)', worst: 'O(n·W)' },
  space: 'O(n·W)',
  code: [
    'procedure knapsack(w, v, W):',
    '  dp[0][*] ← 0',
    '  for i ← 1 to n:',
    '    for c ← 0 to W:',
    '      dp[i][c] ← dp[i−1][c]                 // skip item i',
    '      if w[i] ≤ c:',
    '        dp[i][c] ← max(dp[i][c], v[i] + dp[i−1][c−w[i]])',
    '  trace back from dp[n][W] to list chosen items',
  ],
  fields: [
    { key: 'weights', label: 'Weights', kind: 'numbers' },
    { key: 'values', label: 'Values', kind: 'numbers' },
    { key: 'capacity', label: 'Capacity', kind: 'number', min: 0, max: 15 },
  ],
  defaults: { weights: [1, 3, 4, 5], values: [1, 4, 5, 7], capacity: 7 },
  random: () => {
    const n = randInt(3, 5);
    return { weights: randArray(n, 1, 6), values: randArray(n, 1, 12), capacity: randInt(5, 10) };
  },
  presets: [
    { label: 'Capacity 0', params: { weights: [1, 2], values: [5, 6], capacity: 0 }, note: 'Nothing fits.' },
    { label: 'Too heavy', params: { weights: [9, 12], values: [10, 20], capacity: 6 }, note: 'Every item exceeds capacity.' },
    { label: 'Zero weight', params: { weights: [0, 2, 3], values: [4, 3, 5], capacity: 3 }, note: 'Free items are always taken.' },
    { label: 'Greedy fails', params: { weights: [1, 3, 4], values: [15, 20, 30], capacity: 4 }, note: 'Best ratio first (item 1) is not optimal.' },
    { label: 'No items', params: { weights: [], values: [], capacity: 5 } },
  ],
  legend: ['compare', 'found', 'path'],
  run(p) {
    const w = nums(p.weights, [1, 3, 4, 5]).map((x) => Math.max(0, Math.round(x)));
    const v = nums(p.values, [1, 4, 5, 7]);
    const W = Math.max(0, Math.min(15, Math.round(num(p.capacity, 7))));
    const n = Math.min(w.length, v.length);
    const r = new Recorder(['cells filled']);
    const dp = Array.from({ length: n + 1 }, () => new Array(W + 1).fill(0));
    const rows = ['∅', ...Array.from({ length: n }, (_, i) => `#${i + 1} (w${w[i]},v${v[i]})`)];
    const cols = Array.from({ length: W + 1 }, (_, c) => String(c));
    const view = (t: Record<string, Tone> = {}): Viz[] => [tbl(dp, rows, cols, t, 'dp[item][capacity]')];
    if (w.length !== v.length) r.push(0, `Weights and values have different lengths — using the first ${n} pairs.`, view());
    if (n === 0 || W === 0) {
      r.push(1, `Edge case: ${n === 0 ? 'no items' : 'capacity is 0'} → the best value is 0.`, view({ [`${n},${W}`]: 'found' }));
      return r.steps;
    }
    r.push(1, 'Row ∅: with no items every capacity is worth 0.', view());
    for (let i = 1; i <= n; i++) {
      for (let c = 0; c <= W; c++) {
        dp[i][c] = dp[i - 1][c];
        r.inc('cells filled');
        if (w[i - 1] <= c) {
          const take = v[i - 1] + dp[i - 1][c - w[i - 1]];
          const t: Record<string, Tone> = { [`${i - 1},${c}`]: 'compare', [`${i - 1},${c - w[i - 1]}`]: 'compare', [`${i},${c}`]: 'found' };
          dp[i][c] = Math.max(dp[i][c], take);
          r.push(6, `Item ${i} fits in ${c}: max(skip ${dp[i - 1][c]}, take ${v[i - 1]} + ${dp[i - 1][c - w[i - 1]]}) = ${dp[i][c]}.`, view(t), { i, c });
        } else {
          r.push(4, `Item ${i} (w=${w[i - 1]}) does not fit in capacity ${c} → copy ${dp[i][c]} from above.`, view({ [`${i - 1},${c}`]: 'compare', [`${i},${c}`]: 'found' }), { i, c });
        }
      }
    }
    const pathT: Record<string, Tone> = {};
    const chosen: number[] = [];
    let c = W;
    for (let i = n; i >= 1; i--) {
      pathT[`${i},${c}`] = 'path';
      if (dp[i][c] !== dp[i - 1][c]) {
        chosen.push(i);
        c -= w[i - 1];
      }
    }
    pathT[`0,${c}`] = 'path';
    r.push(7, `Best value ${dp[n][W]}. Taken items: ${chosen.length ? chosen.reverse().map((i) => `#${i}`).join(', ') : 'none'}.`, view(pathT));
    return r.steps;
  },
};

function stringGrid(a: string, b: string) {
  return {
    rows: ['∅', ...a.split('')],
    cols: ['∅', ...b.split('')],
  };
}

const lcs: Algorithm = {
  id: 'lcs',
  name: 'Longest Common Subsequence',
  category: 'dp',
  difficulty: 'Intermediate',
  summary: 'Longest sequence of characters appearing in both strings in the same order.',
  about: [
    'dp[i][j] = LCS length of the prefixes a[0..i) and b[0..j). Matching characters extend the diagonal by one; otherwise take the better of dropping a character from either string.',
    'Edge cases: an empty string gives LCS 0; identical strings give their full length; no shared characters gives 0.',
  ],
  time: { best: 'O(m·n)', avg: 'O(m·n)', worst: 'O(m·n)' },
  space: 'O(m·n)',
  code: [
    'procedure LCS(a, b):',
    '  dp[0][*] ← 0; dp[*][0] ← 0',
    '  for i ← 1 to m:',
    '    for j ← 1 to n:',
    '      if a[i] = b[j]: dp[i][j] ← dp[i−1][j−1] + 1',
    '      else: dp[i][j] ← max(dp[i−1][j], dp[i][j−1])',
    '  trace back diagonals to read the subsequence',
  ],
  fields: [
    { key: 'a', label: 'String A', kind: 'text' },
    { key: 'b', label: 'String B', kind: 'text' },
  ],
  defaults: { a: 'ABCBDAB', b: 'BDCABA' },
  presets: [
    { label: 'Empty A', params: { a: '', b: 'HELLO' }, note: 'LCS with an empty string is 0.' },
    { label: 'Identical', params: { a: 'DYNAMIC', b: 'DYNAMIC' }, note: 'Whole string matches along the diagonal.' },
    { label: 'Nothing shared', params: { a: 'ABC', b: 'XYZ' } },
    { label: 'Repeats', params: { a: 'AAAA', b: 'AA' } },
    { label: 'Case-sensitive', params: { a: 'abc', b: 'ABC' }, note: '"a" ≠ "A".' },
  ],
  legend: ['compare', 'found', 'path'],
  run(p) {
    const a = (typeof p.a === 'string' ? p.a : 'ABCBDAB').slice(0, 12);
    const b = (typeof p.b === 'string' ? p.b : 'BDCABA').slice(0, 12);
    const m = a.length;
    const n = b.length;
    const { rows, cols } = stringGrid(a, b);
    const dp = Array.from({ length: m + 1 }, () => new Array(n + 1).fill(0));
    const r = new Recorder(['cells filled', 'matches']);
    const view = (t: Record<string, Tone> = {}) => [tbl(dp, rows, cols, t, 'dp[i][j]')];
    if (!m || !n) {
      r.push(1, `Edge case: ${!m ? 'A' : 'B'} is empty, so the LCS is the empty string (length 0).`, view({ '0,0': 'found' }));
      return r.steps;
    }
    r.push(1, 'First row and column are 0: an empty prefix shares nothing.', view());
    for (let i = 1; i <= m; i++)
      for (let j = 1; j <= n; j++) {
        r.inc('cells filled');
        if (a[i - 1] === b[j - 1]) {
          dp[i][j] = dp[i - 1][j - 1] + 1;
          r.inc('matches');
          r.push(4, `'${a[i - 1]}' = '${b[j - 1]}' → diagonal ${dp[i - 1][j - 1]} + 1 = ${dp[i][j]}.`, view({ [`${i - 1},${j - 1}`]: 'compare', [`${i},${j}`]: 'found' }), { i, j });
        } else {
          dp[i][j] = Math.max(dp[i - 1][j], dp[i][j - 1]);
          r.push(5, `'${a[i - 1]}' ≠ '${b[j - 1]}' → max(up ${dp[i - 1][j]}, left ${dp[i][j - 1]}) = ${dp[i][j]}.`, view({ [`${i - 1},${j}`]: 'compare', [`${i},${j - 1}`]: 'compare', [`${i},${j}`]: 'active' }), { i, j });
        }
      }
    const t: Record<string, Tone> = {};
    let i = m;
    let j = n;
    let s = '';
    while (i > 0 && j > 0) {
      t[`${i},${j}`] = 'path';
      if (a[i - 1] === b[j - 1]) {
        s = a[i - 1] + s;
        i--;
        j--;
      } else if (dp[i - 1][j] >= dp[i][j - 1]) i--;
      else j--;
    }
    r.push(6, s ? `LCS length ${dp[m][n]}: "${s}".` : 'No common characters — LCS is empty.', view(t));
    return r.steps;
  },
};

const edit: Algorithm = {
  id: 'edit-distance',
  name: 'Edit Distance (Levenshtein)',
  category: 'dp',
  difficulty: 'Intermediate',
  summary: 'Minimum inserts, deletes and substitutions to turn one string into another.',
  about: [
    'dp[i][j] = cost to convert a[0..i) into b[0..j). If the characters match, it is free (diagonal); otherwise 1 + the cheapest of delete (up), insert (left) or replace (diagonal).',
    'Edge cases: converting to/from an empty string costs its length (the first row and column).',
  ],
  time: { best: 'O(m·n)', avg: 'O(m·n)', worst: 'O(m·n)' },
  space: 'O(m·n)',
  code: [
    'procedure editDistance(a, b):',
    '  dp[i][0] ← i; dp[0][j] ← j',
    '  for i ← 1 to m:',
    '    for j ← 1 to n:',
    '      if a[i] = b[j]: dp[i][j] ← dp[i−1][j−1]',
    '      else: dp[i][j] ← 1 + min(dp[i−1][j], dp[i][j−1], dp[i−1][j−1])',
    '  return dp[m][n]',
  ],
  fields: [
    { key: 'a', label: 'From', kind: 'text' },
    { key: 'b', label: 'To', kind: 'text' },
  ],
  defaults: { a: 'kitten', b: 'sitting' },
  presets: [
    { label: 'Empty → word', params: { a: '', b: 'abc' }, note: 'Three inserts.' },
    { label: 'Word → empty', params: { a: 'abc', b: '' }, note: 'Three deletes.' },
    { label: 'Same', params: { a: 'same', b: 'same' }, note: 'Distance 0.' },
    { label: 'Total rewrite', params: { a: 'abc', b: 'xyz' } },
    { label: 'Transposition', params: { a: 'ab', b: 'ba' }, note: 'Levenshtein needs 2 edits; swaps are not an operation.' },
  ],
  legend: ['compare', 'found', 'path'],
  run(p) {
    const a = (typeof p.a === 'string' ? p.a : 'kitten').slice(0, 12);
    const b = (typeof p.b === 'string' ? p.b : 'sitting').slice(0, 12);
    const m = a.length;
    const n = b.length;
    const { rows, cols } = stringGrid(a, b);
    const dp = Array.from({ length: m + 1 }, (_, i) => Array.from({ length: n + 1 }, (_, j) => (i === 0 ? j : j === 0 ? i : 0)));
    const r = new Recorder(['cells filled']);
    const view = (t: Record<string, Tone> = {}) => [tbl(dp, rows, cols, t, 'dp[i][j]')];
    r.push(1, 'Base row/column: turning a prefix into the empty string (or back) costs its length.', view());
    if (!m || !n) {
      r.push(6, `Edge case: one string is empty, so the answer is the other's length: ${dp[m][n]}.`, view({ [`${m},${n}`]: 'found' }));
      return r.steps;
    }
    for (let i = 1; i <= m; i++)
      for (let j = 1; j <= n; j++) {
        r.inc('cells filled');
        if (a[i - 1] === b[j - 1]) {
          dp[i][j] = dp[i - 1][j - 1];
          r.push(4, `'${a[i - 1]}' = '${b[j - 1]}' → no cost, copy diagonal ${dp[i][j]}.`, view({ [`${i - 1},${j - 1}`]: 'compare', [`${i},${j}`]: 'found' }), { i, j });
        } else {
          const del = dp[i - 1][j];
          const ins = dp[i][j - 1];
          const rep = dp[i - 1][j - 1];
          dp[i][j] = 1 + Math.min(del, ins, rep);
          const op = rep <= del && rep <= ins ? 'replace' : del <= ins ? 'delete' : 'insert';
          r.push(5, `'${a[i - 1]}' ≠ '${b[j - 1]}' → 1 + min(del ${del}, ins ${ins}, rep ${rep}) = ${dp[i][j]} (${op}).`, view({ [`${i - 1},${j}`]: 'compare', [`${i},${j - 1}`]: 'compare', [`${i - 1},${j - 1}`]: 'compare', [`${i},${j}`]: 'active' }), { i, j });
        }
      }
    const t: Record<string, Tone> = {};
    let i = m;
    let j = n;
    while (i > 0 || j > 0) {
      t[`${i},${j}`] = 'path';
      if (i > 0 && j > 0 && a[i - 1] === b[j - 1]) {
        i--;
        j--;
      } else if (i > 0 && j > 0 && dp[i][j] === dp[i - 1][j - 1] + 1) {
        i--;
        j--;
      } else if (i > 0 && dp[i][j] === dp[i - 1][j] + 1) i--;
      else j--;
    }
    t['0,0'] = 'path';
    r.push(6, `Edit distance = ${dp[m][n]}. The highlighted path is one optimal edit script.`, view(t));
    return r.steps;
  },
};

const lis: Algorithm = {
  id: 'lis',
  name: 'Longest Increasing Subsequence',
  category: 'dp',
  difficulty: 'Intermediate',
  summary: 'For each index, the longest strictly increasing subsequence ending there.',
  about: [
    'dp[i] = 1 + max(dp[j]) over all j < i with A[j] < A[i]. The answer is the largest dp value; parent links rebuild the subsequence.',
    'Edge cases: strictly increasing means equal values cannot both be used; a strictly decreasing array has LIS 1; an empty array has LIS 0.',
  ],
  time: { best: 'O(n²)', avg: 'O(n²)', worst: 'O(n²)' },
  space: 'O(n)',
  code: [
    'procedure LIS(A):',
    '  dp[i] ← 1 for all i',
    '  for i ← 1 to n−1:',
    '    for j ← 0 to i−1:',
    '      if A[j] < A[i] and dp[j] + 1 > dp[i]:',
    '        dp[i] ← dp[j] + 1; parent[i] ← j',
    '  return max(dp), rebuilt via parent',
  ],
  fields: [{ key: 'array', label: 'Array', kind: 'numbers', hint: 'negatives OK' }],
  defaults: { array: [10, -9, 2, 5, 3, 7, -1, 101, 18, 4] },
  random: () => ({ array: randArray(10, -30, 60) }),
  presets: [
    { label: 'Decreasing', params: { array: [9, 7, 4, 2, -1, -5] }, note: 'Every element alone: LIS = 1.' },
    { label: 'All equal', params: { array: [3, 3, 3, 3] }, note: 'Strictly increasing → 1.' },
    { label: 'Increasing', params: { array: [-4, -2, 0, 1, 8] }, note: 'The whole array.' },
    { label: 'Negatives', params: { array: [-7, -10, -3, -8, -1, -2] } },
    { label: 'Single', params: { array: [42] } },
    { label: 'Empty', params: { array: [] } },
  ],
  legend: ['pivot', 'compare', 'found', 'path'],
  run(p) {
    const a = nums(p.array, [10, 9, 2, 5]);
    const n = a.length;
    const r = new Recorder(['comparisons']);
    const dp = new Array(n).fill(1);
    const parent = new Array(n).fill(-1);
    const view = (t: Record<number, Tone> = {}, dt: Record<number, Tone> = {}) => [
      arrayViz(a, { style: 'cells', tones: t, labels: a.map((_, i) => String(i)), title: 'A' }),
      arrayViz(dp, { style: 'cells', tones: dt, title: 'dp[i] = LIS ending at i' }),
    ];
    if (n === 0) {
      r.push(6, 'Edge case: empty array → LIS length 0.', view());
      return r.steps;
    }
    r.push(1, 'Every element is an increasing subsequence of length 1 by itself.', view());
    for (let i = 1; i < n; i++) {
      for (let j = 0; j < i; j++) {
        r.inc('comparisons');
        const ok = a[j] < a[i] && dp[j] + 1 > dp[i];
        if (ok) {
          dp[i] = dp[j] + 1;
          parent[i] = j;
        }
        r.push(ok ? 5 : 4, ok ? `${a[j]} < ${a[i]}: extend the run ending at ${j} → dp[${i}] = ${dp[i]}.` : a[j] < a[i] ? `${a[j]} < ${a[i]} but dp[${j}] + 1 = ${dp[j] + 1} is not longer than ${dp[i]}.` : `${a[j]} ≥ ${a[i]} — cannot precede it${a[j] === a[i] ? ' (equal values are not strictly increasing)' : ''}.`, view({ [i]: 'pivot', [j]: 'compare' }, { [i]: ok ? 'found' : 'pivot', [j]: 'compare' }), { i, j });
      }
    }
    let best = 0;
    for (let i = 1; i < n; i++) if (dp[i] > dp[best]) best = i;
    const t: Record<number, Tone> = {};
    const seq: number[] = [];
    for (let k = best; k !== -1; k = parent[k]) {
      t[k] = 'path';
      seq.unshift(a[k]);
    }
    r.push(6, `LIS length ${dp[best]}: ${seq.join(' < ')}.`, view(t, t));
    return r.steps;
  },
};

const coin: Algorithm = {
  id: 'coin-change',
  name: 'Coin Change (Min Coins)',
  category: 'dp',
  difficulty: 'Intermediate',
  summary: 'Fewest coins summing to an amount, with unlimited coins of each denomination.',
  about: [
    'dp[x] = fewest coins for amount x. For each coin c ≤ x, dp[x] = min(dp[x], dp[x − c] + 1). dp[0] = 0.',
    'Edge cases: amount 0 needs 0 coins; an amount no combination can make stays ∞ (return −1); zero or negative coins are rejected because they never make progress.',
  ],
  time: { best: 'O(A·k)', avg: 'O(A·k)', worst: 'O(A·k)' },
  space: 'O(A)',
  code: [
    'procedure coinChange(coins, A):',
    '  drop coins ≤ 0',
    '  dp[0] ← 0; dp[1..A] ← ∞',
    '  for x ← 1 to A:',
    '    for c in coins:',
    '      if c ≤ x and dp[x−c] + 1 < dp[x]: dp[x] ← dp[x−c] + 1',
    '  return dp[A] if finite else −1',
  ],
  fields: [
    { key: 'coins', label: 'Coins', kind: 'numbers' },
    { key: 'amount', label: 'Amount', kind: 'number', min: 0, max: 40 },
  ],
  defaults: { coins: [1, 3, 4], amount: 6 },
  random: () => ({ coins: [...new Set(randArray(3, 1, 7))], amount: randInt(5, 20) }),
  presets: [
    { label: 'Impossible', params: { coins: [2, 4], amount: 7 }, note: 'Even coins cannot make an odd amount.' },
    { label: 'Amount 0', params: { coins: [1, 5], amount: 0 }, note: 'Zero coins.' },
    { label: 'Greedy fails', params: { coins: [1, 3, 4], amount: 6 }, note: 'Greedy picks 4+1+1; optimal is 3+3.' },
    { label: 'Coin too big', params: { coins: [25], amount: 10 } },
    { label: 'Bad coins', params: { coins: [0, -2, 3], amount: 9 }, note: '0 and −2 are ignored.' },
  ],
  legend: ['compare', 'found', 'path'],
  run(p) {
    const raw = nums(p.coins, [1, 3, 4]);
    const coins = [...new Set(raw.filter((c) => c > 0).map(Math.round))].sort((x, y) => x - y);
    const A = Math.max(0, Math.min(40, Math.round(num(p.amount, 6))));
    const r = new Recorder(['checks']);
    const dp: number[] = new Array(A + 1).fill(INF);
    const from: number[] = new Array(A + 1).fill(-1);
    dp[0] = 0;
    const view = (t: Record<number, Tone> = {}) => [
      arrayViz(dp.map(f), { style: 'cells', labels: dp.map((_, i) => String(i)), tones: t, title: 'dp[amount] = fewest coins' }),
      arrayViz(coins, { style: 'cells', title: 'Coins' }),
    ];
    if (raw.length !== coins.length) r.push(1, `Edge case: removed ${raw.filter((c) => c <= 0).join(', ') || 'duplicate'} — coins must be positive to make progress.`, view());
    if (!coins.length) {
      r.push(6, 'No usable coins → no amount above 0 can be made.', view());
      return r.steps;
    }
    r.push(2, 'dp[0] = 0 (no coins for amount 0); everything else starts at ∞.', view({ 0: 'found' }));
    if (A === 0) {
      r.push(6, 'Edge case: amount 0 → answer 0.', view({ 0: 'found' }));
      return r.steps;
    }
    for (let x = 1; x <= A; x++) {
      for (const c of coins) {
        if (c > x) continue;
        r.inc('checks');
        const ok = dp[x - c] + 1 < dp[x];
        if (ok) {
          dp[x] = dp[x - c] + 1;
          from[x] = c;
        }
        r.push(5, `Amount ${x}, coin ${c}: dp[${x - c}] + 1 = ${f(dp[x - c] + 1)}${ok ? ` improves dp[${x}] → ${dp[x]}` : ` is not better than ${f(dp[x])}`}.`, view({ [x - c]: 'compare', [x]: ok ? 'found' : 'active' }), { x, c });
      }
      if (dp[x] === INF) r.push(5, `No coin combination reaches ${x} — stays ∞.`, view({ [x]: 'bad' }), { x });
    }
    if (dp[A] === INF) {
      r.push(6, `Edge case: dp[${A}] is ∞ — the amount cannot be made. Return −1.`, view({ [A]: 'bad' }));
      return r.steps;
    }
    const t: Record<number, Tone> = {};
    const used: number[] = [];
    for (let x = A; x > 0; x -= from[x]) {
      t[x] = 'path';
      used.push(from[x]);
    }
    t[0] = 'path';
    r.push(6, `${A} = ${used.join(' + ')} → ${dp[A]} coin(s).`, view(t));
    return r.steps;
  },
};

const kadane: Algorithm = {
  id: 'kadane',
  name: "Maximum Subarray (Kadane)",
  category: 'dp',
  difficulty: 'Beginner',
  summary: 'Best sum of a contiguous subarray: extend the current run or restart at the current element.',
  about: [
    'cur = max(A[i], cur + A[i]) — if the running sum so far is negative, it only hurts, so start fresh. Track the best cur seen.',
    'Edge case: when every number is negative, the answer is the largest single element (not 0). Initialising best with A[0] instead of 0 handles this.',
  ],
  time: { best: 'O(n)', avg: 'O(n)', worst: 'O(n)' },
  space: 'O(1)',
  code: [
    'procedure maxSubarray(A):',
    '  cur ← A[0]; best ← A[0]',
    '  for i ← 1 to n−1:',
    '    cur ← max(A[i], cur + A[i])        // extend or restart',
    '    best ← max(best, cur)',
    '  return best',
  ],
  fields: [{ key: 'array', label: 'Array', kind: 'numbers', hint: 'negatives are the point here' }],
  defaults: { array: [-2, 1, -3, 4, -1, 2, 1, -5, 4] },
  random: () => ({ array: randArray(10, -9, 9) }),
  presets: [
    { label: 'All negative', params: { array: [-8, -3, -6, -2, -5, -4] }, note: 'Answer is −2, not 0 — the classic bug.' },
    { label: 'All positive', params: { array: [2, 3, 1, 4] }, note: 'Take everything.' },
    { label: 'Zeros', params: { array: [0, -1, 0, -2, 0] } },
    { label: 'Single negative', params: { array: [-7] } },
    { label: 'Empty', params: { array: [] }, note: 'No subarray exists.' },
  ],
  legend: ['range', 'active', 'found'],
  run(p) {
    const a = nums(p.array, [-2, 1, -3, 4]);
    const r = new Recorder(['restarts']);
    const n = a.length;
    if (!n) {
      r.push(1, 'Edge case: empty array — there is no non-empty subarray, so the answer is undefined (many APIs throw or return −∞).', [arrayViz([], { style: 'cells' })]);
      return r.steps;
    }
    let cur = a[0];
    let best = a[0];
    let s = 0;
    let bs = 0;
    let be = 0;
    const view = (i: number) => {
      const t: Record<number, Tone> = {};
      for (let k = s; k <= i; k++) t[k] = 'range';
      for (let k = bs; k <= be; k++) t[k] = 'found';
      t[i] = 'active';
      return [arrayViz(a, { style: 'bars', tones: t, pointers: [{ i: s, label: 'start' }, { i, label: 'i' }] })];
    };
    r.push(1, `cur = best = A[0] = ${a[0]}.${a[0] < 0 ? ' Starting from A[0] (not 0) keeps all-negative input correct.' : ''}`, view(0), { cur, best });
    for (let i = 1; i < n; i++) {
      const ext = cur + a[i];
      if (a[i] > ext) {
        cur = a[i];
        s = i;
        r.inc('restarts');
        r.push(3, `cur + A[${i}] = ${ext} < A[${i}] = ${a[i]} → the old run hurts; restart at ${i}.`, view(i), { i, cur, best });
      } else {
        cur = ext;
        r.push(3, `Extend: cur = ${ext}.`, view(i), { i, cur, best });
      }
      if (cur > best) {
        best = cur;
        bs = s;
        be = i;
        r.push(4, `New best ${best} (indices ${bs}..${be}).`, view(i), { i, cur, best });
      }
    }
    r.push(5, `Maximum subarray sum = ${best}, from index ${bs} to ${be}.`, [arrayViz(a, { style: 'bars', tones: Object.fromEntries(Array.from({ length: be - bs + 1 }, (_, k) => [bs + k, 'found' as Tone])) })], { best });
    return r.steps;
  },
};

const GRID_DEF = ['. . . .', '. # . .', '. . . #', '# . . .'].join('\n');
const paths: Algorithm = {
  id: 'unique-paths',
  name: 'Unique Paths with Obstacles',
  category: 'dp',
  difficulty: 'Beginner',
  summary: 'Count right/down paths from top-left to bottom-right avoiding walls.',
  about: [
    'Each cell can only be entered from above or from the left, so ways[r][c] = ways[r−1][c] + ways[r][c−1]. Walls have 0 ways.',
    'Edge cases: if the start or the goal is a wall the answer is 0; a 1×1 open grid has exactly one (empty) path.',
  ],
  time: { best: 'O(R·C)', avg: 'O(R·C)', worst: 'O(R·C)' },
  space: 'O(R·C)',
  code: [
    'procedure uniquePaths(grid):',
    '  if grid[0][0] is wall: return 0',
    '  ways[0][0] ← 1',
    '  for each cell (r, c) in row-major order:',
    '    if wall: ways[r][c] ← 0',
    '    else: ways[r][c] ← ways[r−1][c] + ways[r][c−1]',
    '  return ways[R−1][C−1]',
  ],
  fields: [{ key: 'grid', label: 'Grid', kind: 'text', hint: '# wall · . open' }],
  defaults: { grid: GRID_DEF },
  presets: [
    { label: 'Start blocked', params: { grid: '# . .\n. . .' }, note: 'No path can even begin.' },
    { label: 'Goal blocked', params: { grid: '. . .\n. . #' } },
    { label: '1×1', params: { grid: '.' }, note: 'Exactly one path: stay put.' },
    { label: 'Single row', params: { grid: '. . . . .' } },
    { label: 'Wall cut', params: { grid: '. . #\n. # .\n# . .' }, note: 'Diagonal wall separates start from goal.' },
  ],
  legend: ['compare', 'found', 'wall'],
  run(p) {
    const g = str(p.grid, GRID_DEF)
      .trim()
      .split('\n')
      .map((l) => l.trim().split(/\s+/).filter(Boolean));
    const R = g.length;
    const C = Math.max(...g.map((r) => r.length));
    const wall = (r: number, c: number) => (g[r]?.[c] ?? '#') === '#';
    const ways: (number | null)[][] = Array.from({ length: R }, () => new Array(C).fill(null));
    const r0 = new Recorder(['cells']);
    const view = (t: Record<string, Tone> = {}) => {
      const tones: Record<string, Tone> = { ...t };
      for (let r = 0; r < R; r++) for (let c = 0; c < C; c++) if (wall(r, c)) tones[`${r},${c}`] = 'wall';
      return [{ kind: 'table', cells: ways.map((row) => row.map((x) => (x === null ? '' : x))), tones, grid: true, title: 'ways[r][c]' } as TableViz];
    };
    if (wall(0, 0)) {
      r0.push(1, 'Edge case: the start cell is a wall → 0 paths.', view());
      return r0.steps;
    }
    for (let r = 0; r < R; r++)
      for (let c = 0; c < C; c++) {
        r0.inc('cells');
        if (wall(r, c)) {
          ways[r][c] = 0;
          r0.push(4, `(${r},${c}) is a wall → 0 ways through it.`, view(), { r, c });
          continue;
        }
        if (r === 0 && c === 0) {
          ways[0][0] = 1;
          r0.push(2, 'Start cell: 1 way (we are already here).', view({ '0,0': 'found' }), { r, c });
          continue;
        }
        const up = r > 0 ? ways[r - 1][c] ?? 0 : 0;
        const left = c > 0 ? ways[r][c - 1] ?? 0 : 0;
        ways[r][c] = up + left;
        const t: Record<string, Tone> = { [`${r},${c}`]: 'found' };
        if (r > 0) t[`${r - 1},${c}`] = 'compare';
        if (c > 0) t[`${r},${c - 1}`] = 'compare';
        r0.push(5, `(${r},${c}) = from above ${up} + from left ${left} = ${ways[r][c]}.`, view(t), { r, c });
      }
    const ans = ways[R - 1][C - 1] ?? 0;
    r0.push(6, ans ? `${ans} distinct path(s) reach the bottom-right corner.` : 'Edge case: the goal is unreachable (or a wall) → 0 paths.', view({ [`${R - 1},${C - 1}`]: ans ? 'found' : 'bad' }));
    return r0.steps;
  },
};

export const dpAlgorithms: Algorithm[] = [fib, kadane, coin, knapsack, lis, lcs, edit, paths];
