import type { Algorithm, Tone, Viz, TableViz } from '../lib/types';
import { Recorder, arrayViz, nums, num, randArray, randInt } from '../lib/recorder';

const queens: Algorithm = {
  id: 'n-queens',
  name: 'N-Queens',
  category: 'backtracking',
  difficulty: 'Intermediate',
  summary: 'Place N queens so none attack each other; undo a placement when it leads to a dead end.',
  about: [
    'Place one queen per row. For each column, check whether it is attacked along the column or a diagonal. If safe, recurse to the next row; if no column works, backtrack and move the previous queen.',
    'Edge cases: N = 1 is trivially solvable; N = 2 and N = 3 have no solution at all — the search exhausts every option and reports failure.',
  ],
  time: { best: 'O(N!)', avg: 'O(N!)', worst: 'O(N!)' },
  space: 'O(N)',
  code: [
    'procedure solve(row):',
    '  if row = N: return true              // all queens placed',
    '  for col ← 0 to N−1:',
    '    if safe(row, col):',
    '      place queen at (row, col)',
    '      if solve(row + 1): return true',
    '      remove queen (backtrack)',
    '  return false',
  ],
  fields: [{ key: 'n', label: 'N', kind: 'number', min: 1, max: 8 }],
  defaults: { n: 6 },
  random: () => ({ n: randInt(4, 8) }),
  presets: [
    { label: 'N = 1', params: { n: 1 }, note: 'Single square.' },
    { label: 'N = 2', params: { n: 2 }, note: 'Impossible.' },
    { label: 'N = 3', params: { n: 3 }, note: 'Impossible — watch every branch fail.' },
    { label: 'N = 4', params: { n: 4 }, note: 'Smallest non-trivial solvable board.' },
    { label: 'N = 8', params: { n: 8 }, note: 'The classic puzzle.' },
  ],
  legend: ['found', 'compare', 'bad'],
  run(p) {
    const N = Math.max(1, Math.min(8, Math.round(num(p.n, 6))));
    const cols: number[] = [];
    const r = new Recorder(['placements', 'backtracks']);
    const board = (try_?: [number, number], bad?: [number, number][]): Viz[] => {
      const cells: (string | null)[][] = Array.from({ length: N }, () => new Array(N).fill(''));
      const tones: Record<string, Tone> = {};
      cols.forEach((c, row) => {
        cells[row][c] = '♛';
        tones[`${row},${c}`] = 'found';
      });
      for (let rr = 0; rr < N; rr++) for (let cc = 0; cc < N; cc++) if ((rr + cc) % 2 && !tones[`${rr},${cc}`]) tones[`${rr},${cc}`] = 'dim';
      if (try_) {
        tones[`${try_[0]},${try_[1]}`] = bad?.length ? 'bad' : 'compare';
        cells[try_[0]][try_[1]] = '?';
      }
      for (const [a, b] of bad ?? []) tones[`${a},${b}`] = 'bad';
      const t: TableViz = { kind: 'table', cells, tones, grid: true, title: `${N}×${N} board` };
      return [t];
    };
    const attackers = (row: number, col: number) => {
      const out: [number, number][] = [];
      cols.forEach((c, rr) => {
        if (c === col || Math.abs(c - col) === Math.abs(rr - row)) out.push([rr, c]);
      });
      return out;
    };
    const solve = (row: number): boolean => {
      if (r.full) return false;
      if (row === N) {
        r.push(1, `All ${N} queens placed safely — solved!`, board(), { row });
        return true;
      }
      for (let col = 0; col < N; col++) {
        const att = attackers(row, col);
        if (att.length) {
          r.push(3, `(${row}, ${col}) is attacked by the queen at (${att[0][0]}, ${att[0][1]}).`, board([row, col], att), { row, col });
          continue;
        }
        cols.push(col);
        r.inc('placements');
        r.push(4, `(${row}, ${col}) is safe → place a queen and move to row ${row + 1}.`, board(), { row, col });
        if (solve(row + 1)) return true;
        cols.pop();
        r.inc('backtracks');
        r.push(6, `Row ${row + 1} had no safe column → remove the queen from (${row}, ${col}) and try the next column.`, board(), { row, col });
      }
      r.push(7, `No column works in row ${row} — return false to row ${row - 1}.`, board(), { row });
      return false;
    };
    r.push(0, `Place ${N} queens on a ${N}×${N} board, one row at a time.`, board());
    if (!solve(0)) r.push(7, r.full ? 'Step limit reached.' : `Edge case: every arrangement fails — ${N}-Queens has no solution.`, board());
    return r.steps;
  },
};

const subsetSum: Algorithm = {
  id: 'subset-sum',
  name: 'Subset Sum',
  category: 'backtracking',
  difficulty: 'Intermediate',
  summary: 'Find a subset adding up to a target by deciding include/exclude for each item.',
  about: [
    'Explore a binary decision tree: for item i, first try including it, then try excluding it. Undo choices on the way back up.',
    'Edge case: the common "stop when the sum exceeds the target" pruning is only valid when all numbers are non-negative. With negative numbers a later item can bring the sum back down, so pruning is disabled automatically.',
  ],
  time: { best: 'O(n)', avg: 'O(2ⁿ)', worst: 'O(2ⁿ)' },
  space: 'O(n)',
  code: [
    'procedure search(i, sum):',
    '  if sum = target and chosen non-empty: return true',
    '  if i = n: return false',
    '  if allNonNegative and sum > target: return false   // prune',
    '  choose A[i]; if search(i+1, sum + A[i]): return true',
    '  unchoose A[i]',
    '  return search(i+1, sum)                     // skip A[i]',
  ],
  fields: [
    { key: 'array', label: 'Numbers', kind: 'numbers', hint: 'negatives OK (pruning turns off)' },
    { key: 'target', label: 'Target', kind: 'number' },
  ],
  defaults: { array: [3, 34, 4, 12, 5, 2], target: 9 },
  random: () => ({ array: randArray(6, -10, 20), target: randInt(-5, 25) }),
  presets: [
    { label: 'With negatives', params: { array: [8, -3, 5, -6, 2], target: 4 }, note: '8 − 6 + 2 = 4: needs pruning off.' },
    { label: 'Impossible', params: { array: [2, 4, 6], target: 5 }, note: 'All even — explores the whole tree.' },
    { label: 'Target 0', params: { array: [5, -5, 3], target: 0 }, note: 'Non-empty subset must sum to 0.' },
    { label: 'Whole set', params: { array: [1, 2, 3], target: 6 } },
    { label: 'Duplicates', params: { array: [2, 2, 2, 3], target: 7 } },
    { label: 'Empty', params: { array: [], target: 0 }, note: 'No non-empty subset exists.' },
  ],
  legend: ['found', 'compare', 'dim'],
  run(p) {
    const a = nums(p.array, [3, 34, 4]);
    const target = num(p.target, 9);
    const n = a.length;
    const nonNeg = a.every((x) => x >= 0);
    const chosen = new Set<number>();
    const r = new Recorder(['nodes', 'pruned']);
    const view = (i: number): Viz[] => {
      const t: Record<number, Tone> = {};
      for (let k = 0; k < n; k++) t[k] = chosen.has(k) ? 'found' : k < i ? 'dim' : 'range';
      if (i < n) t[i] = 'compare';
      return [arrayViz(a, { style: 'cells', tones: t, pointers: i < n ? [{ i, label: 'i' }] : [] }), { kind: 'list', title: 'Chosen', items: [...chosen].sort((x, y) => x - y).map((k) => a[k]), mode: 'stack' }];
    };
    r.push(0, nonNeg ? `Find a subset of [${a.join(', ')}] summing to ${target}. All values ≥ 0, so we may prune when the sum overshoots.` : `Edge case: the input has negatives, so overshooting the target is not a dead end — pruning is OFF.`, view(0), { target });
    const search = (i: number, sum: number): boolean => {
      if (r.full) return false;
      r.inc('nodes');
      if (sum === target && chosen.size) {
        r.push(1, `Sum ${sum} = target with {${[...chosen].map((k) => a[k]).join(', ')}}. Found!`, view(n), { i, sum });
        return true;
      }
      if (i === n) {
        r.push(2, `All items decided, sum ${sum} ≠ ${target}. Dead end.`, view(i), { i, sum });
        return false;
      }
      if (nonNeg && sum > target) {
        r.inc('pruned');
        r.push(3, `Sum ${sum} already exceeds ${target} and nothing negative can fix it — prune.`, view(i), { i, sum });
        return false;
      }
      chosen.add(i);
      r.push(4, `Include A[${i}] = ${a[i]} → sum ${sum + a[i]}.`, view(i), { i, sum: sum + a[i] });
      if (search(i + 1, sum + a[i])) return true;
      chosen.delete(i);
      r.push(6, `Backtrack: exclude A[${i}] = ${a[i]} and try without it (sum ${sum}).`, view(i), { i, sum });
      return search(i + 1, sum);
    };
    if (!search(0, 0)) r.push(6, r.full ? 'Step limit reached.' : `No non-empty subset sums to ${target}.`, view(n));
    return r.steps;
  },
};

const perms: Algorithm = {
  id: 'permutations',
  name: 'Permutations',
  category: 'backtracking',
  difficulty: 'Beginner',
  summary: 'Generate every ordering by choosing an unused element for each position, then undoing.',
  about: [
    'Build the permutation position by position. At each level, try every unused element, recurse, then mark it unused again so it can appear later in other branches.',
    'Edge case: with duplicate values, sort first and skip an element equal to its previous sibling when that sibling is unused — this yields only distinct permutations.',
  ],
  time: { best: 'O(n·n!)', avg: 'O(n·n!)', worst: 'O(n·n!)' },
  space: 'O(n)',
  code: [
    'procedure permute(path):',
    '  if |path| = n: output path; return',
    '  for i ← 0 to n−1:',
    '    if used[i]: continue',
    '    if i > 0 and A[i] = A[i−1] and not used[i−1]: continue  // duplicate',
    '    used[i] ← true; path.push(A[i])',
    '    permute(path)',
    '    path.pop(); used[i] ← false',
  ],
  fields: [{ key: 'array', label: 'Elements', kind: 'numbers', hint: 'up to 4 (sorted first)' }],
  defaults: { array: [1, -2, 3] },
  presets: [
    { label: 'Duplicates', params: { array: [1, 1, 2] }, note: '3 distinct orders, not 6.' },
    { label: 'All equal', params: { array: [7, 7, 7] }, note: 'Only one distinct permutation.' },
    { label: 'Single', params: { array: [5] } },
    { label: 'Empty', params: { array: [] }, note: 'Exactly one permutation: the empty one.' },
    { label: 'Four', params: { array: [-1, 0, 1, 2] }, note: '24 permutations.' },
  ],
  legend: ['found', 'compare', 'dim'],
  run(p) {
    const a = [...nums(p.array, [1, 2, 3])].slice(0, 4).sort((x, y) => x - y);
    const n = a.length;
    const used = new Array(n).fill(false);
    const path: number[] = [];
    const out: string[] = [];
    const r = new Recorder(['outputs', 'skipped dupes']);
    const view = (i = -1, skip = false): Viz[] => [
      arrayViz(a, { style: 'cells', title: 'Elements (sorted)', tones: Object.fromEntries(a.map((_, k) => [k, k === i ? (skip ? 'bad' : 'compare') : used[k] ? 'dim' : 'range'])) as Record<number, Tone> }),
      { kind: 'list', title: 'Current path', items: path, mode: 'stack' },
      { kind: 'list', title: `Output (${out.length})`, items: out, mode: 'queue' },
    ];
    const go = () => {
      if (path.length === n) {
        out.push(`[${path.join(',')}]`);
        r.inc('outputs');
        r.push(1, n ? `Complete: [${path.join(', ')}].` : 'Edge case: n = 0 — the empty sequence is the one and only permutation.', view());
        return;
      }
      for (let i = 0; i < n; i++) {
        if (used[i]) continue;
        if (i > 0 && a[i] === a[i - 1] && !used[i - 1]) {
          r.inc('skipped dupes');
          r.push(4, `A[${i}] = ${a[i]} equals the unused sibling A[${i - 1}] — skip to avoid a duplicate permutation.`, view(i, true), { depth: path.length });
          continue;
        }
        used[i] = true;
        path.push(a[i]);
        r.push(5, `Place ${a[i]} at position ${path.length - 1}.`, view(i), { depth: path.length });
        go();
        path.pop();
        used[i] = false;
        r.push(7, `Undo ${a[i]} — free it for other branches.`, view(i), { depth: path.length });
      }
    };
    r.push(0, `Generate all orderings of [${a.join(', ')}].`, view());
    go();
    r.push(1, `${out.length} distinct permutation(s).`, view());
    return r.steps;
  },
};

export const backtrackingAlgorithms: Algorithm[] = [queens, subsetSum, perms];
