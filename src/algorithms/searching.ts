import type { Algorithm, Tone, Viz, Pointer, Preset } from '../lib/types';
import { Recorder, arrayViz, guardEmpty, nums, num, randArray, randInt, rangeTones } from '../lib/recorder';

const SORTED = [-40, -23, -8, -2, 0, 5, 12, 16, 23, 38, 45, 56, 72, 90];
const fields = [
  { key: 'array', label: 'Sorted array', kind: 'numbers' as const, hint: 'negatives OK — will be sorted for you' },
  { key: 'target', label: 'Target', kind: 'number' as const },
];
const randomSorted = () => {
  const a = [...new Set(randArray(14, -50, 99))].sort((x, y) => x - y);
  return { array: a, target: Math.random() < 0.8 ? a[randInt(0, a.length - 1)] : randInt(-50, 99) };
};

/** Edge cases for searching a sorted array. */
const searchPresets = (a: number[]): Preset[] => [
  { label: 'Negative target', params: { array: a, target: a.find((x) => x < 0) ?? -8 }, note: 'Negative keys compare exactly like positive ones.' },
  { label: 'Not present', params: { array: a, target: 13 }, note: 'Falls between two values — the range must shrink to empty.' },
  { label: 'Below min', params: { array: a, target: a[0] - 100 }, note: 'Smaller than every element.' },
  { label: 'Above max', params: { array: a, target: a[a.length - 1] + 100 }, note: 'Larger than every element.' },
  { label: 'First', params: { array: a, target: a[0] }, note: 'Boundary: index 0.' },
  { label: 'Last', params: { array: a, target: a[a.length - 1] }, note: 'Boundary: index n − 1.' },
  { label: 'Duplicates', params: { array: [-3, 1, 4, 4, 4, 4, 4, 9, 12], target: 4 }, note: 'Any matching index is a valid answer.' },
  { label: 'Single (hit)', params: { array: [-7], target: -7 } },
  { label: 'Single (miss)', params: { array: [-7], target: 3 } },
  { label: 'Empty', params: { array: [], target: 5 }, note: 'n = 0: return −1 without touching the array.' },
];
const legend: Tone[] = ['range', 'compare', 'dim', 'found'];

function cells(a: number[], tones: Record<number, Tone>, pointers: Pointer[] = []): Viz {
  return arrayViz(a, { style: 'cells', tones, pointers, labels: a.map((_, i) => String(i)) });
}
const sortedInput = (p: Record<string, unknown>) => [...nums(p.array, SORTED)].sort((x, y) => x - y);
const dimOutside = (n: number, lo: number, hi: number) => {
  const t: Record<number, Tone> = {};
  for (let i = 0; i < n; i++) t[i] = i < lo || i > hi ? 'dim' : 'range';
  return t;
};

const linear: Algorithm = {
  id: 'linear-search',
  name: 'Linear Search',
  category: 'searching',
  difficulty: 'Beginner',
  summary: 'Check every element from left to right until the target appears.',
  about: ['The simplest search: no ordering required. On average it looks at half the array, and in the worst case every element.'],
  time: { best: 'O(1)', avg: 'O(n)', worst: 'O(n)' },
  space: 'O(1)',
  code: ['procedure linearSearch(A, target):', '  for i ← 0 to n−1:', '    if A[i] = target: return i', '  return −1'],
  fields: [
    { key: 'array', label: 'Array', kind: 'numbers' },
    { key: 'target', label: 'Target', kind: 'number' },
  ],
  defaults: { array: [14, -33, 27, 0, 35, -19, 42, 44, -7, 25], target: -19 },
  random: () => {
    const a = randArray(12, -40, 60);
    return { array: a, target: a[randInt(0, a.length - 1)] };
  },
  presets: [
    { label: 'Not present', params: { array: [14, -33, 27, 0, 35, -19], target: 99 }, note: 'Worst case: all n elements are checked.' },
    { label: 'First', params: { array: [-5, 8, 1, 3], target: -5 }, note: 'Best case: one comparison.' },
    { label: 'Duplicates', params: { array: [3, -1, 7, -1, 7], target: 7 }, note: 'Returns the first occurrence.' },
    { label: 'Zero', params: { array: [4, -2, 0, 9], target: 0 }, note: 'Zero is a normal value, not "missing".' },
    { label: 'Single', params: { array: [-9], target: -9 } },
    { label: 'Empty', params: { array: [], target: 1 } },
  ],
  legend: ['compare', 'dim', 'found'],
  run(p) {
    const a = nums(p.array, [14, 33, 27]);
    const target = num(p.target, 42);
    const r = new Recorder(['comparisons']);
    const seen: Record<number, Tone> = {};
    r.push(0, `Look for ${target}.`, [cells(a, {})], { target });
    for (let i = 0; i < a.length; i++) {
      r.inc('comparisons');
      r.push(2, `Is A[${i}] = ${a[i]} equal to ${target}?`, [cells(a, { ...seen, [i]: 'compare' }, [{ i, label: 'i' }])], { i, target });
      if (a[i] === target) {
        r.push(2, `Found ${target} at index ${i}.`, [cells(a, { ...seen, [i]: 'found' }, [{ i, label: 'i' }])], { i, result: i });
        return r.steps;
      }
      seen[i] = 'dim';
    }
    r.push(3, `${target} is not in the array → −1.`, [cells(a, seen)], { result: -1 });
    return r.steps;
  },
};

const binary: Algorithm = {
  id: 'binary-search',
  name: 'Binary Search',
  category: 'searching',
  difficulty: 'Beginner',
  summary: 'Halve a sorted search range each step by comparing against the middle.',
  about: [
    'Requires sorted data. Compare the middle element with the target: if it is smaller, the target can only be on the right; otherwise only on the left. Discard half every time.',
    'A million elements need at most 20 comparisons.',
  ],
  time: { best: 'O(1)', avg: 'O(log n)', worst: 'O(log n)' },
  space: 'O(1)',
  code: [
    'procedure binarySearch(A, target):',
    '  lo ← 0; hi ← n − 1',
    '  while lo ≤ hi:',
    '    mid ← (lo + hi) / 2',
    '    if A[mid] = target: return mid',
    '    else if A[mid] < target: lo ← mid + 1',
    '    else: hi ← mid − 1',
    '  return −1',
  ],
  fields,
  defaults: { array: SORTED, target: 72 },
  random: randomSorted,
  legend,
  run(p) {
    const a = sortedInput(p);
    const target = num(p.target, 72);
    const r = new Recorder(['comparisons']);
    let lo = 0;
    let hi = a.length - 1;
    r.push(1, `Search the whole range [0..${hi}] for ${target}.`, [cells(a, dimOutside(a.length, lo, hi), [{ i: lo, label: 'lo' }, { i: hi, label: 'hi' }])], { lo, hi, target });
    while (lo <= hi) {
      const mid = Math.floor((lo + hi) / 2);
      r.inc('comparisons');
      const ptr = [{ i: lo, label: 'lo' }, { i: mid, label: 'mid' }, { i: hi, label: 'hi' }];
      r.push(3, `mid = (${lo} + ${hi}) / 2 = ${mid}; A[mid] = ${a[mid]}.`, [cells(a, { ...dimOutside(a.length, lo, hi), [mid]: 'compare' }, ptr)], { lo, mid, hi, target });
      if (a[mid] === target) {
        r.push(4, `A[${mid}] equals ${target}. Found!`, [cells(a, { ...dimOutside(a.length, lo, hi), [mid]: 'found' }, ptr)], { lo, mid, hi, result: mid });
        return r.steps;
      }
      if (a[mid] < target) {
        lo = mid + 1;
        r.push(5, `${a[mid]} < ${target} → discard the left half. lo = ${lo}.`, [cells(a, dimOutside(a.length, lo, hi), [{ i: lo, label: 'lo' }, { i: hi, label: 'hi' }])], { lo, hi });
      } else {
        hi = mid - 1;
        r.push(6, `${a[mid]} > ${target} → discard the right half. hi = ${hi}.`, [cells(a, dimOutside(a.length, lo, hi), [{ i: lo, label: 'lo' }, { i: hi, label: 'hi' }])], { lo, hi });
      }
    }
    r.push(7, `Range is empty — ${target} is not present.`, [cells(a, dimOutside(a.length, 1, 0))], { result: -1 });
    return r.steps;
  },
};

const jump: Algorithm = {
  id: 'jump-search',
  name: 'Jump Search',
  category: 'searching',
  difficulty: 'Intermediate',
  summary: 'Jump ahead √n at a time to find the right block, then scan it linearly.',
  about: ['A middle ground between linear and binary search for sorted data: about √n jumps plus at most √n linear steps. Useful when jumping backwards is costly.'],
  time: { best: 'O(1)', avg: 'O(√n)', worst: 'O(√n)' },
  space: 'O(1)',
  code: [
    'procedure jumpSearch(A, target):',
    '  step ← √n; prev ← 0',
    '  while A[min(step, n)−1] < target:',
    '    prev ← step; step ← step + √n',
    '    if prev ≥ n: return −1',
    '  for i ← prev to min(step, n)−1:',
    '    if A[i] = target: return i',
    '  return −1',
  ],
  fields,
  defaults: { array: SORTED, target: 56 },
  random: randomSorted,
  legend,
  run(p) {
    const a = sortedInput(p);
    const n = a.length;
    const target = num(p.target, 67);
    const r = new Recorder(['comparisons']);
    const s = Math.max(1, Math.floor(Math.sqrt(n)));
    let step = s;
    let prev = 0;
    r.push(1, `Block size √${n} ≈ ${s}.`, [cells(a, {})], { step, prev });
    for (;;) {
      const probe = Math.min(step, n) - 1;
      r.inc('comparisons');
      r.push(2, `Check the end of block: A[${probe}] = ${a[probe]} < ${target}?`, [cells(a, { ...dimOutside(n, prev, probe), [probe]: 'compare' }, [{ i: probe, label: 'probe' }])], { step, prev });
      if (a[probe] >= target) break;
      prev = step;
      step += s;
      if (prev >= n) {
        r.push(4, 'Jumped past the end — not found.', [cells(a, dimOutside(n, 1, 0))], { result: -1 });
        return r.steps;
      }
      r.push(3, `Too small → jump to the next block starting at ${prev}.`, [cells(a, dimOutside(n, prev, Math.min(step, n) - 1))], { step, prev });
    }
    const end = Math.min(step, n) - 1;
    for (let i = prev; i <= end; i++) {
      r.inc('comparisons');
      r.push(6, `Scan block: A[${i}] = ${a[i]}.`, [cells(a, { ...dimOutside(n, prev, end), [i]: 'compare' }, [{ i, label: 'i' }])], { i, prev });
      if (a[i] === target) {
        r.push(6, `Found ${target} at index ${i}.`, [cells(a, { ...dimOutside(n, prev, end), [i]: 'found' }, [{ i, label: 'i' }])], { result: i });
        return r.steps;
      }
    }
    r.push(7, `${target} is not in this block — not found.`, [cells(a, dimOutside(n, 1, 0))], { result: -1 });
    return r.steps;
  },
};

const interpolation: Algorithm = {
  id: 'interpolation-search',
  name: 'Interpolation Search',
  category: 'searching',
  difficulty: 'Intermediate',
  summary: 'Guess where the target should be from its value, like looking up a name in a phone book.',
  about: [
    'Instead of always probing the middle, estimate the position proportionally: pos = lo + (target − A[lo]) · (hi − lo) / (A[hi] − A[lo]).',
    'On uniformly distributed data it averages O(log log n); on skewed data it can degrade to O(n).',
  ],
  time: { best: 'O(1)', avg: 'O(log log n)', worst: 'O(n)' },
  space: 'O(1)',
  code: [
    'procedure interpolationSearch(A, target):',
    '  lo ← 0; hi ← n − 1',
    '  while lo ≤ hi and A[lo] ≤ target ≤ A[hi]:',
    '    pos ← lo + (target−A[lo])·(hi−lo) / (A[hi]−A[lo])',
    '    if A[pos] = target: return pos',
    '    if A[pos] < target: lo ← pos + 1',
    '    else: hi ← pos − 1',
    '  return −1',
  ],
  fields,
  defaults: { array: [-50, -40, -30, -20, -10, 0, 10, 20, 30, 40, 50, 60], target: 30 },
  presets: [
    { label: 'Uniform', params: { array: [-50, -40, -30, -20, -10, 0, 10, 20, 30, 40, 50, 60], target: -20 }, note: 'Evenly spaced: the first guess lands exactly.' },
    { label: 'Skewed', params: { array: [1, 2, 3, 4, 5, 6, 7, 8, 9, 1000], target: 9 }, note: 'One outlier makes every estimate too low → O(n) probes.' },
    { label: 'All equal', params: { array: [4, 4, 4, 4, 4], target: 4 }, note: 'A[hi] − A[lo] = 0 would divide by zero — guarded.' },
    { label: 'Below min', params: { array: [-10, 0, 10, 20], target: -99 }, note: 'Range check fails before any probe.' },
    { label: 'Not present', params: { array: [-10, 0, 10, 20, 30], target: 15 } },
    { label: 'Empty', params: { array: [], target: 0 } },
  ],
  random: randomSorted,
  legend,
  run(p) {
    const a = sortedInput(p);
    const n = a.length;
    const target = num(p.target, 90);
    const r = new Recorder(['probes']);
    let lo = 0;
    let hi = n - 1;
    r.push(1, `Search for ${target}.`, [cells(a, dimOutside(n, lo, hi))], { lo, hi });
    while (lo <= hi && a[lo] <= target && target <= a[hi]) {
      const pos = a[hi] === a[lo] ? lo : lo + Math.floor(((target - a[lo]) * (hi - lo)) / (a[hi] - a[lo]));
      r.inc('probes');
      r.push(3, `Estimate pos = ${lo} + (${target}−${a[lo]})·(${hi}−${lo})/(${a[hi]}−${a[lo]}) = ${pos}.`, [cells(a, { ...dimOutside(n, lo, hi), [pos]: 'compare' }, [{ i: lo, label: 'lo' }, { i: pos, label: 'pos' }, { i: hi, label: 'hi' }])], { lo, hi, pos });
      if (a[pos] === target) {
        r.push(4, `A[${pos}] = ${target}. Found!`, [cells(a, { ...dimOutside(n, lo, hi), [pos]: 'found' }, [{ i: pos, label: 'pos' }])], { result: pos });
        return r.steps;
      }
      if (a[pos] < target) lo = pos + 1;
      else hi = pos - 1;
      r.push(a[pos] < target ? 5 : 6, `${a[pos]} ${a[pos] < target ? '<' : '>'} ${target} → narrow to [${lo}..${hi}].`, [cells(a, dimOutside(n, lo, hi))], { lo, hi });
    }
    r.push(7, `${target} is outside the remaining range — not found.`, [cells(a, dimOutside(n, 1, 0))], { result: -1 });
    return r.steps;
  },
};

const exponential: Algorithm = {
  id: 'exponential-search',
  name: 'Exponential Search',
  category: 'searching',
  difficulty: 'Intermediate',
  summary: 'Double a bound until it passes the target, then binary search inside that range.',
  about: ['Great for unbounded or very long lists: the doubling phase finds a range of size ~2i containing the target in O(log i) steps, then binary search finishes the job.'],
  time: { best: 'O(1)', avg: 'O(log i)', worst: 'O(log n)' },
  space: 'O(1)',
  code: [
    'procedure exponentialSearch(A, target):',
    '  if A[0] = target: return 0',
    '  bound ← 1',
    '  while bound < n and A[bound] < target: bound ← bound · 2',
    '  return binarySearch(A, bound/2, min(bound, n−1))',
  ],
  fields,
  defaults: { array: SORTED, target: 45 },
  random: randomSorted,
  legend,
  run(p) {
    const a = sortedInput(p);
    const n = a.length;
    const target = num(p.target, 81);
    const r = new Recorder(['comparisons']);
    r.inc('comparisons');
    r.push(1, `Check A[0] = ${a[0]}.`, [cells(a, { 0: 'compare' })]);
    if (a[0] === target) {
      r.push(1, 'Found at index 0.', [cells(a, { 0: 'found' })], { result: 0 });
      return r.steps;
    }
    let bound = 1;
    while (bound < n && a[bound] < target) {
      r.inc('comparisons');
      r.push(3, `A[${bound}] = ${a[bound]} < ${target} → double the bound.`, [cells(a, { ...rangeTones(0, bound - 1, 'dim'), [bound]: 'compare' }, [{ i: bound, label: 'bound' }])], { bound });
      bound *= 2;
    }
    let lo = Math.floor(bound / 2);
    let hi = Math.min(bound, n - 1);
    r.push(4, `Target lies in [${lo}..${hi}] → binary search there.`, [cells(a, dimOutside(n, lo, hi), [{ i: lo, label: 'lo' }, { i: hi, label: 'hi' }])], { lo, hi });
    while (lo <= hi) {
      const mid = Math.floor((lo + hi) / 2);
      r.inc('comparisons');
      r.push(4, `mid = ${mid}, A[mid] = ${a[mid]}.`, [cells(a, { ...dimOutside(n, lo, hi), [mid]: 'compare' }, [{ i: lo, label: 'lo' }, { i: mid, label: 'mid' }, { i: hi, label: 'hi' }])], { lo, mid, hi });
      if (a[mid] === target) {
        r.push(4, `Found ${target} at index ${mid}.`, [cells(a, { ...dimOutside(n, lo, hi), [mid]: 'found' })], { result: mid });
        return r.steps;
      }
      if (a[mid] < target) lo = mid + 1;
      else hi = mid - 1;
    }
    r.push(4, 'Not found.', [cells(a, dimOutside(n, 1, 0))], { result: -1 });
    return r.steps;
  },
};

const ternary: Algorithm = {
  id: 'ternary-search',
  name: 'Ternary Search',
  category: 'searching',
  difficulty: 'Intermediate',
  summary: 'Split a sorted range into thirds with two probes and keep the third that can hold the target.',
  about: ['Two midpoints m1 and m2 divide the range into three parts. Comparisons with both rule out two-thirds at a time. Fewer iterations than binary search, but more comparisons per iteration — it is most useful for finding the peak of unimodal functions.'],
  time: { best: 'O(1)', avg: 'O(log₃ n)', worst: 'O(log₃ n)' },
  space: 'O(1)',
  code: [
    'procedure ternarySearch(A, target):',
    '  lo ← 0; hi ← n − 1',
    '  while lo ≤ hi:',
    '    m1 ← lo + (hi−lo)/3; m2 ← hi − (hi−lo)/3',
    '    if A[m1] = target: return m1',
    '    if A[m2] = target: return m2',
    '    if target < A[m1]: hi ← m1 − 1',
    '    else if target > A[m2]: lo ← m2 + 1',
    '    else: lo ← m1 + 1; hi ← m2 − 1',
    '  return −1',
  ],
  fields,
  defaults: { array: SORTED, target: -8 },
  random: randomSorted,
  legend,
  run(p) {
    const a = sortedInput(p);
    const n = a.length;
    const target = num(p.target, 23);
    const r = new Recorder(['comparisons']);
    let lo = 0;
    let hi = n - 1;
    r.push(1, `Search [0..${hi}] for ${target}.`, [cells(a, dimOutside(n, lo, hi))], { lo, hi });
    while (lo <= hi) {
      const m1 = lo + Math.floor((hi - lo) / 3);
      const m2 = hi - Math.floor((hi - lo) / 3);
      const ptr = [{ i: m1, label: 'm1' }, { i: m2, label: 'm2' }];
      r.inc('comparisons', 2);
      r.push(3, `Probes: A[${m1}] = ${a[m1]}, A[${m2}] = ${a[m2]}.`, [cells(a, { ...dimOutside(n, lo, hi), [m1]: 'compare', [m2]: 'compare' }, ptr)], { lo, hi, m1, m2 });
      if (a[m1] === target || a[m2] === target) {
        const at = a[m1] === target ? m1 : m2;
        r.push(a[m1] === target ? 4 : 5, `Found ${target} at index ${at}.`, [cells(a, { ...dimOutside(n, lo, hi), [at]: 'found' }, ptr)], { result: at });
        return r.steps;
      }
      let line = 8;
      if (target < a[m1]) {
        hi = m1 - 1;
        line = 6;
      } else if (target > a[m2]) {
        lo = m2 + 1;
        line = 7;
      } else {
        lo = m1 + 1;
        hi = m2 - 1;
      }
      r.push(line, `Keep the third [${lo}..${hi}].`, [cells(a, dimOutside(n, lo, hi))], { lo, hi });
    }
    r.push(9, 'Not found.', [cells(a, dimOutside(n, 1, 0))], { result: -1 });
    return r.steps;
  },
};

export const searchingAlgorithms: Algorithm[] = [linear, binary, jump, interpolation, exponential, ternary].map((a) =>
  guardEmpty({ ...a, presets: a.presets ?? searchPresets(SORTED) }, 'array', 'Edge case: the array is empty (n = 0). There is nothing to compare, so the search returns −1 immediately — without reading A[0], which does not exist.'),
);
