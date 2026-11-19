import type { Algorithm, Tone, Viz, GraphViz, Pointer, Preset } from '../lib/types';
import { Recorder, arrayViz, guardEmpty, nums, randArray, rangeTones } from '../lib/recorder';

const DEF = [38, -27, 43, 3, -9, 82, 0, 57, -21, 64];
const fields = [{ key: 'array', label: 'Array', kind: 'numbers' as const, hint: 'comma-separated, negatives OK, up to 24 values' }];
const random = () => ({ array: randArray(10 + Math.floor(Math.random() * 5), -50, 99) });

/** Edge cases every comparison sort should survive. */
const SORT_PRESETS: Preset[] = [
  { label: 'Negatives', params: { array: [-5, 3, -12, 0, 8, -1, 7, -20, 15, 2] }, note: 'Mixed signs and zero — comparisons work the same for negatives.' },
  { label: 'Already sorted', params: { array: [-8, -3, 0, 2, 5, 9, 14, 21, 30, 42] }, note: 'Best case for adaptive sorts (bubble, insertion); worst for naive quick sort.' },
  { label: 'Reversed', params: { array: [42, 30, 21, 14, 9, 5, 2, 0, -3, -8] }, note: 'Worst case for bubble and insertion sort — every pair is inverted.' },
  { label: 'Duplicates', params: { array: [5, -3, 5, 1, -3, 5, 1, 0, -3, 1] }, note: 'Equal keys must not cause extra swaps or infinite loops.' },
  { label: 'All equal', params: { array: [7, 7, 7, 7, 7, 7] }, note: 'Nothing to move; watch how many comparisons are still made.' },
  { label: 'Two items', params: { array: [9, -4] }, note: 'Smallest input that can be out of order.' },
  { label: 'Single', params: { array: [-42] }, note: 'One element is sorted by definition — loops never run.' },
  { label: 'Empty', params: { array: [] }, note: 'n = 0: the algorithm must return immediately.' },
];
const legend: Tone[] = ['compare', 'swap', 'pivot', 'sorted'];

/** Small helper that keeps values + identities together so bars slide on swap. */
class Bars {
  a: number[];
  ids: number[];
  fixed: Record<number, Tone> = {};
  constructor(a: number[]) {
    this.a = [...a];
    this.ids = a.map((_, i) => i);
  }
  swap(i: number, j: number) {
    [this.a[i], this.a[j]] = [this.a[j], this.a[i]];
    [this.ids[i], this.ids[j]] = [this.ids[j], this.ids[i]];
  }
  view(tones: Record<number, Tone> = {}, pointers: Pointer[] = [], title?: string): Viz {
    return arrayViz(this.a, { ids: this.ids, tones: { ...this.fixed, ...tones }, pointers, title });
  }
  allSorted() {
    this.fixed = rangeTones(0, this.a.length - 1, 'sorted');
  }
}

const bubble: Algorithm = {
  id: 'bubble-sort',
  name: 'Bubble Sort',
  category: 'sorting',
  difficulty: 'Beginner',
  summary: 'Repeatedly swap adjacent out-of-order pairs; the largest value bubbles to the end each pass.',
  about: [
    'Each pass walks the array comparing neighbours. Whenever the left one is larger, they swap — so the biggest unsorted value is carried to the end like a bubble rising.',
    'After pass k the last k positions are final. If a pass makes no swaps, the array is already sorted and we stop early, which is why the best case is O(n).',
  ],
  time: { best: 'O(n)', avg: 'O(n²)', worst: 'O(n²)' },
  space: 'O(1)',
  code: [
    'procedure bubbleSort(A):',
    '  for i ← 0 to n−2:',
    '    swapped ← false',
    '    for j ← 0 to n−i−2:',
    '      if A[j] > A[j+1]:',
    '        swap(A[j], A[j+1]); swapped ← true',
    '    if not swapped: break',
    '  return A',
  ],
  fields,
  defaults: { array: DEF },
  random,
  legend,
  run(p) {
    const b = new Bars(nums(p.array, DEF));
    const n = b.a.length;
    const r = new Recorder(['comparisons', 'swaps']);
    r.push(0, 'Start with the unsorted array.', [b.view()]);
    for (let i = 0; i < n - 1; i++) {
      let swapped = false;
      r.push(2, `Pass ${i + 1}: carry the largest remaining value to index ${n - 1 - i}.`, [b.view()], { i, swapped });
      for (let j = 0; j < n - 1 - i; j++) {
        const ptr = [{ i: j, label: 'j' }, { i: j + 1, label: 'j+1' }];
        r.inc('comparisons');
        r.push(4, `Compare A[${j}] = ${b.a[j]} with A[${j + 1}] = ${b.a[j + 1]}.`, [b.view({ [j]: 'compare', [j + 1]: 'compare' }, ptr)], { i, j, swapped });
        if (b.a[j] > b.a[j + 1]) {
          b.swap(j, j + 1);
          swapped = true;
          r.inc('swaps');
          r.push(5, `${b.a[j + 1]} > ${b.a[j]}, so swap them.`, [b.view({ [j]: 'swap', [j + 1]: 'swap' }, ptr)], { i, j, swapped });
        }
      }
      b.fixed[n - 1 - i] = 'sorted';
      if (!swapped) {
        r.push(6, 'No swaps during this pass — everything is in order. Stop early.', [b.view()], { i, swapped });
        break;
      }
      r.push(6, `Index ${n - 1 - i} now holds its final value ${b.a[n - 1 - i]}.`, [b.view()], { i, swapped });
    }
    b.allSorted();
    r.push(7, 'The array is sorted.', [b.view()]);
    return r.steps;
  },
};

const cocktail: Algorithm = {
  id: 'cocktail-sort',
  name: 'Cocktail Shaker Sort',
  category: 'sorting',
  difficulty: 'Beginner',
  summary: 'Bubble sort that alternates direction, moving large values right and small values left.',
  about: [
    'A forward pass pushes the maximum to the right edge; a backward pass pulls the minimum to the left edge. The unsorted window shrinks from both sides.',
    'It fixes bubble sort\'s "turtle" problem, where small values near the end move left only one step per pass.',
  ],
  time: { best: 'O(n)', avg: 'O(n²)', worst: 'O(n²)' },
  space: 'O(1)',
  code: [
    'procedure cocktailSort(A):',
    '  lo ← 0; hi ← n−1; swapped ← true',
    '  while swapped:',
    '    swapped ← false',
    '    for j ← lo to hi−1:  if A[j] > A[j+1]: swap, swapped ← true',
    '    hi ← hi − 1',
    '    for j ← hi down to lo+1:  if A[j−1] > A[j]: swap, swapped ← true',
    '    lo ← lo + 1',
  ],
  fields,
  defaults: { array: DEF },
  random,
  legend,
  run(p) {
    const b = new Bars(nums(p.array, DEF));
    const r = new Recorder(['comparisons', 'swaps']);
    let lo = 0;
    let hi = b.a.length - 1;
    let swapped = true;
    r.push(1, 'Unsorted window is the whole array.', [b.view()], { lo, hi });
    while (swapped && lo < hi) {
      swapped = false;
      for (let j = lo; j < hi; j++) {
        r.inc('comparisons');
        const ptr = [{ i: j, label: 'j' }, { i: j + 1, label: 'j+1' }];
        r.push(4, `Forward: compare ${b.a[j]} and ${b.a[j + 1]}.`, [b.view({ [j]: 'compare', [j + 1]: 'compare' }, ptr)], { lo, hi, j });
        if (b.a[j] > b.a[j + 1]) {
          b.swap(j, j + 1);
          swapped = true;
          r.inc('swaps');
          r.push(4, 'Out of order → swap.', [b.view({ [j]: 'swap', [j + 1]: 'swap' }, ptr)], { lo, hi, j });
        }
      }
      b.fixed[hi] = 'sorted';
      hi--;
      r.push(5, `Largest value parked at the right. hi = ${hi}.`, [b.view()], { lo, hi });
      if (!swapped) break;
      swapped = false;
      for (let j = hi; j > lo; j--) {
        r.inc('comparisons');
        const ptr = [{ i: j - 1, label: 'j−1' }, { i: j, label: 'j' }];
        r.push(6, `Backward: compare ${b.a[j - 1]} and ${b.a[j]}.`, [b.view({ [j - 1]: 'compare', [j]: 'compare' }, ptr)], { lo, hi, j });
        if (b.a[j - 1] > b.a[j]) {
          b.swap(j - 1, j);
          swapped = true;
          r.inc('swaps');
          r.push(6, 'Out of order → swap.', [b.view({ [j - 1]: 'swap', [j]: 'swap' }, ptr)], { lo, hi, j });
        }
      }
      b.fixed[lo] = 'sorted';
      lo++;
      r.push(7, `Smallest value parked at the left. lo = ${lo}.`, [b.view()], { lo, hi });
    }
    b.allSorted();
    r.push(2, 'No swaps in a full pass — sorted.', [b.view()]);
    return r.steps;
  },
};

const selection: Algorithm = {
  id: 'selection-sort',
  name: 'Selection Sort',
  category: 'sorting',
  difficulty: 'Beginner',
  summary: 'Find the minimum of the unsorted part and swap it to the front.',
  about: [
    'The array is split into a sorted prefix and an unsorted suffix. Each round scans the suffix for its minimum and swaps it into the next prefix slot.',
    'It always performs n(n−1)/2 comparisons, but at most n−1 swaps — handy when writes are expensive.',
  ],
  time: { best: 'O(n²)', avg: 'O(n²)', worst: 'O(n²)' },
  space: 'O(1)',
  code: [
    'procedure selectionSort(A):',
    '  for i ← 0 to n−2:',
    '    min ← i',
    '    for j ← i+1 to n−1:',
    '      if A[j] < A[min]: min ← j',
    '    swap(A[i], A[min])',
    '  return A',
  ],
  fields,
  defaults: { array: DEF },
  random,
  legend,
  run(p) {
    const b = new Bars(nums(p.array, DEF));
    const n = b.a.length;
    const r = new Recorder(['comparisons', 'swaps']);
    r.push(0, 'Start: nothing is sorted yet.', [b.view()]);
    for (let i = 0; i < n - 1; i++) {
      let min = i;
      r.push(2, `Round ${i + 1}: assume A[${i}] = ${b.a[i]} is the minimum.`, [b.view({ [i]: 'pivot' }, [{ i, label: 'i' }])], { i, min });
      for (let j = i + 1; j < n; j++) {
        r.inc('comparisons');
        r.push(4, `Is A[${j}] = ${b.a[j]} smaller than current min ${b.a[min]}?`, [b.view({ [min]: 'pivot', [j]: 'compare' }, [{ i, label: 'i' }, { i: j, label: 'j' }, { i: min, label: 'min' }])], { i, j, min });
        if (b.a[j] < b.a[min]) {
          min = j;
          r.push(4, `Yes — new minimum is ${b.a[min]} at index ${min}.`, [b.view({ [min]: 'pivot' }, [{ i, label: 'i' }, { i: min, label: 'min' }])], { i, j, min });
        }
      }
      if (min !== i) {
        b.swap(i, min);
        r.inc('swaps');
      }
      b.fixed[i] = 'sorted';
      r.push(5, min !== i ? `Swap the minimum ${b.a[i]} into position ${i}.` : `${b.a[i]} is already in place.`, [b.view({ [min]: 'swap', [i]: 'swap' })], { i, min });
    }
    b.allSorted();
    r.push(6, 'Sorted.', [b.view()]);
    return r.steps;
  },
};

const insertion: Algorithm = {
  id: 'insertion-sort',
  name: 'Insertion Sort',
  category: 'sorting',
  difficulty: 'Beginner',
  summary: 'Grow a sorted prefix by inserting each new value into its correct slot.',
  about: [
    'Like sorting playing cards in your hand: take the next card and slide it left past every larger card.',
    'Very fast on nearly-sorted input (each value moves only a little), which is why hybrid sorts like Timsort use it for small runs.',
  ],
  time: { best: 'O(n)', avg: 'O(n²)', worst: 'O(n²)' },
  space: 'O(1)',
  code: [
    'procedure insertionSort(A):',
    '  for i ← 1 to n−1:',
    '    key ← A[i]; j ← i − 1',
    '    while j ≥ 0 and A[j] > key:',
    '      A[j+1] ← A[j]; j ← j − 1',
    '    A[j+1] ← key',
    '  return A',
  ],
  fields,
  defaults: { array: DEF },
  random,
  legend,
  run(p) {
    const b = new Bars(nums(p.array, DEF));
    const n = b.a.length;
    const r = new Recorder(['comparisons', 'shifts']);
    b.fixed[0] = 'sorted';
    r.push(1, 'A single element is trivially sorted.', [b.view()]);
    for (let i = 1; i < n; i++) {
      const key = b.a[i];
      let j = i - 1;
      r.push(2, `Pick key = ${key} and insert it into the sorted prefix.`, [b.view({ [i]: 'pivot' }, [{ i, label: 'key' }])], { i, key, j });
      let pos = i;
      while (j >= 0) {
        r.inc('comparisons');
        r.push(3, `Is A[${j}] = ${b.a[j]} > key ${key}?`, [b.view({ [pos]: 'pivot', [j]: 'compare' }, [{ i: j, label: 'j' }])], { i, key, j });
        if (b.a[j] <= key) break;
        b.swap(j, pos);
        r.inc('shifts');
        pos = j;
        r.push(4, `Yes — shift ${b.a[j + 1]} right.`, [b.view({ [pos]: 'pivot', [j + 1]: 'swap' }, [{ i: j, label: 'j' }])], { i, key, j });
        j--;
      }
      for (let k = 0; k <= i; k++) b.fixed[k] = 'sorted';
      r.push(5, `Place key ${key} at index ${pos}. Prefix [0..${i}] is sorted.`, [b.view({ [pos]: 'found' })], { i, key, j });
    }
    b.allSorted();
    r.push(6, 'Sorted.', [b.view()]);
    return r.steps;
  },
};

const shell: Algorithm = {
  id: 'shell-sort',
  name: 'Shell Sort',
  category: 'sorting',
  difficulty: 'Intermediate',
  summary: 'Insertion sort over shrinking gaps, so values travel long distances early.',
  about: [
    'Elements gap apart are insertion-sorted first. Big gaps move far-away values quickly; the final gap of 1 is an ordinary insertion sort on an almost-sorted array.',
    'Complexity depends on the gap sequence. With halving gaps it is O(n²) worst case, but much faster in practice.',
  ],
  time: { best: 'O(n log n)', avg: '≈O(n^1.25)', worst: 'O(n²)' },
  space: 'O(1)',
  code: [
    'procedure shellSort(A):',
    '  gap ← n / 2',
    '  while gap > 0:',
    '    for i ← gap to n−1:',
    '      j ← i',
    '      while j ≥ gap and A[j−gap] > A[j]:',
    '        swap(A[j], A[j−gap]); j ← j − gap',
    '    gap ← gap / 2',
  ],
  fields,
  defaults: { array: DEF },
  random,
  legend,
  run(p) {
    const b = new Bars(nums(p.array, DEF));
    const n = b.a.length;
    const r = new Recorder(['comparisons', 'swaps']);
    let gap = Math.floor(n / 2);
    r.push(1, `Start with gap = ${gap}.`, [b.view()], { gap });
    while (gap > 0) {
      r.push(2, `Insertion-sort every chain of elements ${gap} apart.`, [b.view()], { gap });
      for (let i = gap; i < n; i++) {
        let j = i;
        while (j >= gap) {
          r.inc('comparisons');
          const ptr = [{ i: j - gap, label: 'j−gap' }, { i: j, label: 'j' }];
          r.push(5, `Compare A[${j - gap}] = ${b.a[j - gap]} and A[${j}] = ${b.a[j]} (gap ${gap}).`, [b.view({ [j]: 'compare', [j - gap]: 'compare' }, ptr)], { gap, i, j });
          if (b.a[j - gap] <= b.a[j]) break;
          b.swap(j, j - gap);
          r.inc('swaps');
          r.push(6, 'Out of order → swap across the gap.', [b.view({ [j]: 'swap', [j - gap]: 'swap' }, ptr)], { gap, i, j });
          j -= gap;
        }
      }
      gap = Math.floor(gap / 2);
      r.push(7, gap ? `Halve the gap → ${gap}.` : 'Gap reached 0 — done.', [b.view()], { gap });
    }
    b.allSorted();
    r.push(7, 'Sorted.', [b.view()]);
    return r.steps;
  },
};

const merge: Algorithm = {
  id: 'merge-sort',
  name: 'Merge Sort',
  category: 'sorting',
  difficulty: 'Intermediate',
  summary: 'Divide in half, sort each half recursively, then merge the two sorted halves.',
  about: [
    'Divide and conquer: split until pieces have one element, then merge sorted pieces back together by repeatedly taking the smaller front element.',
    'Always O(n log n) and stable, at the cost of O(n) extra memory for the merge buffer.',
  ],
  time: { best: 'O(n log n)', avg: 'O(n log n)', worst: 'O(n log n)' },
  space: 'O(n)',
  code: [
    'procedure mergeSort(A, lo, hi):',
    '  if lo ≥ hi: return',
    '  mid ← (lo + hi) / 2',
    '  mergeSort(A, lo, mid); mergeSort(A, mid+1, hi)',
    '  L ← A[lo..mid]; R ← A[mid+1..hi]',
    '  while L and R not empty:',
    '    take smaller of L[i], R[j] into A[k]',
    '  copy the leftovers into A',
  ],
  fields,
  defaults: { array: DEF },
  random,
  legend: ['range', 'compare', 'found', 'sorted'],
  run(p) {
    const b = new Bars(nums(p.array, DEF));
    const r = new Recorder(['comparisons', 'writes']);
    const buf = (L: number[], R: number[], i: number, j: number): Viz[] => [
      arrayViz(L, { style: 'cells', title: 'Left half L', tones: { [i]: 'compare' } }),
      arrayViz(R, { style: 'cells', title: 'Right half R', tones: { [j]: 'compare' } }),
    ];
    const ms = (lo: number, hi: number, depth: number) => {
      if (lo >= hi) {
        r.push(1, `Range [${lo}..${hi}] has one element — already sorted.`, [b.view(rangeTones(lo, hi, 'range'))], { lo, hi, depth });
        return;
      }
      const mid = Math.floor((lo + hi) / 2);
      r.push(2, `Split [${lo}..${hi}] at mid = ${mid}.`, [b.view(rangeTones(lo, hi, 'range'), [{ i: lo, label: 'lo' }, { i: mid, label: 'mid' }, { i: hi, label: 'hi' }])], { lo, mid, hi, depth });
      ms(lo, mid, depth + 1);
      ms(mid + 1, hi, depth + 1);
      const L = b.a.slice(lo, mid + 1);
      const R = b.a.slice(mid + 1, hi + 1);
      r.push(4, `Merge sorted [${lo}..${mid}] and [${mid + 1}..${hi}].`, [b.view(rangeTones(lo, hi, 'range')), ...buf(L, R, 0, 0)], { lo, mid, hi });
      let i = 0;
      let j = 0;
      let k = lo;
      while (i < L.length && j < R.length) {
        r.inc('comparisons');
        const takeLeft = L[i] <= R[j];
        b.a[k] = takeLeft ? L[i] : R[j];
        r.inc('writes');
        r.push(6, `${L[i]} vs ${R[j]} → write ${b.a[k]} to A[${k}].`, [b.view({ ...rangeTones(lo, hi, 'range'), [k]: 'found' }, [{ i: k, label: 'k' }]), ...buf(L, R, i, j)], { i, j, k });
        if (takeLeft) i++;
        else j++;
        k++;
      }
      while (i < L.length) {
        b.a[k] = L[i++];
        r.inc('writes');
        r.push(7, `Copy leftover ${b.a[k]} from L.`, [b.view({ ...rangeTones(lo, hi, 'range'), [k]: 'found' }), ...buf(L, R, i - 1, -1)], { i, j, k });
        k++;
      }
      while (j < R.length) {
        b.a[k] = R[j++];
        r.inc('writes');
        r.push(7, `Copy leftover ${b.a[k]} from R.`, [b.view({ ...rangeTones(lo, hi, 'range'), [k]: 'found' }), ...buf(L, R, -1, j - 1)], { i, j, k });
        k++;
      }
      r.push(7, `[${lo}..${hi}] is now sorted.`, [b.view(rangeTones(lo, hi, 'sorted'))], { lo, hi });
    };
    r.push(0, 'Sort the whole range [0..n−1].', [b.view()]);
    ms(0, b.a.length - 1, 0);
    b.allSorted();
    r.push(0, 'Sorted.', [b.view()]);
    return r.steps;
  },
};

const quick: Algorithm = {
  id: 'quick-sort',
  name: 'Quick Sort',
  category: 'sorting',
  difficulty: 'Intermediate',
  summary: 'Partition around a pivot so smaller values go left and larger go right, then recurse.',
  about: [
    'Lomuto partition: the last element is the pivot. Index i marks the end of the "≤ pivot" zone; j scans the rest. Finally the pivot is swapped right after that zone — into its final position.',
    'Average O(n log n) and in-place, but a bad pivot (e.g. sorted input with last-element pivot) degrades to O(n²).',
  ],
  time: { best: 'O(n log n)', avg: 'O(n log n)', worst: 'O(n²)' },
  space: 'O(log n)',
  code: [
    'procedure quickSort(A, lo, hi):',
    '  if lo ≥ hi: return',
    '  pivot ← A[hi]; i ← lo − 1',
    '  for j ← lo to hi−1:',
    '    if A[j] ≤ pivot:',
    '      i ← i + 1; swap(A[i], A[j])',
    '  swap(A[i+1], A[hi])        // pivot in place',
    '  quickSort(A, lo, i); quickSort(A, i+2, hi)',
  ],
  fields,
  defaults: { array: DEF },
  random,
  legend: ['range', 'found', 'compare', 'swap', 'pivot', 'sorted'],
  run(p) {
    const b = new Bars(nums(p.array, DEF));
    const r = new Recorder(['comparisons', 'swaps']);
    const qs = (lo: number, hi: number) => {
      if (lo > hi) return;
      if (lo === hi) {
        b.fixed[lo] = 'sorted';
        r.push(1, `Single element ${b.a[lo]} is in place.`, [b.view()], { lo, hi });
        return;
      }
      const pivot = b.a[hi];
      let i = lo - 1;
      r.push(2, `Partition [${lo}..${hi}] with pivot ${pivot}.`, [b.view({ ...rangeTones(lo, hi - 1, 'range'), [hi]: 'pivot' }, [{ i: hi, label: 'pivot' }])], { lo, hi, pivot, i });
      for (let j = lo; j < hi; j++) {
        r.inc('comparisons');
        const tones: Record<number, Tone> = { ...rangeTones(lo, hi - 1, 'range'), ...rangeTones(lo, i, 'found'), [hi]: 'pivot', [j]: 'compare' };
        const ptr = [{ i: j, label: 'j' }, ...(i >= lo ? [{ i, label: 'i' }] : [])];
        r.push(4, `Is A[${j}] = ${b.a[j]} ≤ pivot ${pivot}?`, [b.view(tones, ptr)], { lo, hi, pivot, i, j });
        if (b.a[j] <= pivot) {
          i++;
          b.swap(i, j);
          r.inc('swaps');
          r.push(5, `Yes — grow the ≤ zone: swap into index ${i}.`, [b.view({ ...rangeTones(lo, hi - 1, 'range'), ...rangeTones(lo, i, 'found'), [hi]: 'pivot', [i]: 'swap', [j]: 'swap' }, [{ i, label: 'i' }, { i: j, label: 'j' }])], { lo, hi, pivot, i, j });
        }
      }
      b.swap(i + 1, hi);
      r.inc('swaps');
      b.fixed[i + 1] = 'sorted';
      r.push(6, `Put pivot ${pivot} at index ${i + 1} — its final position.`, [b.view({ [i + 1]: 'swap', [hi]: 'swap' })], { lo, hi, pivot, i });
      qs(lo, i);
      qs(i + 2, hi);
    };
    r.push(0, 'Quick sort the whole array.', [b.view()]);
    qs(0, b.a.length - 1);
    b.allSorted();
    r.push(7, 'Sorted.', [b.view()]);
    return r.steps;
  },
};

function heapTree(a: number[], size: number, tones: Record<number, Tone>): GraphViz {
  const n = a.length;
  const nodes = [];
  const edges = [];
  const depth = Math.max(1, Math.floor(Math.log2(Math.max(1, n))) + 1);
  const W = 640;
  const H = 70 * depth + 20;
  for (let i = 0; i < n; i++) {
    const d = Math.floor(Math.log2(i + 1));
    const pos = i + 1 - 2 ** d;
    const slots = 2 ** d;
    nodes.push({ id: String(i), x: ((pos + 0.5) / slots) * W, y: 40 + d * 70, label: String(a[i]) });
    if (i > 0) edges.push({ a: String(Math.floor((i - 1) / 2)), b: String(i) });
  }
  const nodeTones: Record<string, Tone> = {};
  for (let i = 0; i < n; i++) {
    if (i >= size) nodeTones[i] = 'sorted';
    if (tones[i]) nodeTones[i] = tones[i];
  }
  return { kind: 'graph', title: 'Heap as a tree', nodes, edges, nodeTones, width: W, height: H };
}

const heap: Algorithm = {
  id: 'heap-sort',
  name: 'Heap Sort',
  category: 'sorting',
  difficulty: 'Advanced',
  summary: 'Build a max-heap, then repeatedly move the root (maximum) to the end and re-heapify.',
  about: [
    'The array is viewed as a complete binary tree: children of i live at 2i+1 and 2i+2. A max-heap keeps every parent ≥ its children, so the maximum sits at the root.',
    'Swap the root with the last heap element, shrink the heap, and sift the new root down. Repeat n times — guaranteed O(n log n), in place.',
  ],
  time: { best: 'O(n log n)', avg: 'O(n log n)', worst: 'O(n log n)' },
  space: 'O(1)',
  code: [
    'procedure heapSort(A):',
    '  for i ← n/2−1 down to 0: siftDown(A, i, n)',
    '  for end ← n−1 down to 1:',
    '    swap(A[0], A[end]); siftDown(A, 0, end)',
    'procedure siftDown(A, i, size):',
    '  largest ← max of i, 2i+1, 2i+2 (within size)',
    '  if largest ≠ i:',
    '    swap(A[i], A[largest]); siftDown(A, largest, size)',
  ],
  fields,
  defaults: { array: DEF },
  random,
  legend,
  run(p) {
    const b = new Bars(nums(p.array, DEF));
    const n = b.a.length;
    const r = new Recorder(['comparisons', 'swaps']);
    const views = (t: Record<number, Tone>, size: number, ptr: Pointer[] = []) => [b.view(t, ptr), heapTree(b.a, size, t)];
    const sift = (i: number, size: number) => {
      for (;;) {
        const l = 2 * i + 1;
        const rr = 2 * i + 2;
        let largest = i;
        const t: Record<number, Tone> = { [i]: 'pivot' };
        if (l < size) t[l] = 'compare';
        if (rr < size) t[rr] = 'compare';
        if (l < size) {
          r.inc('comparisons');
          if (b.a[l] > b.a[largest]) largest = l;
        }
        if (rr < size) {
          r.inc('comparisons');
          if (b.a[rr] > b.a[largest]) largest = rr;
        }
        r.push(5, l < size ? `Node ${b.a[i]} vs children → largest is ${b.a[largest]}.` : `Node ${b.a[i]} is a leaf.`, views(t, size), { i, size, largest });
        if (largest === i) return;
        b.swap(i, largest);
        r.inc('swaps');
        r.push(7, `Swap down: ${b.a[largest]} moves below ${b.a[i]}.`, views({ [i]: 'swap', [largest]: 'swap' }, size), { i, size, largest });
        i = largest;
      }
    };
    r.push(0, 'Treat the array as a binary tree.', views({}, n));
    for (let i = Math.floor(n / 2) - 1; i >= 0; i--) {
      r.push(1, `Heapify: sift down node at index ${i}.`, views({ [i]: 'pivot' }, n), { i });
      sift(i, n);
    }
    r.push(1, `Max-heap built — the root ${b.a[0]} is the maximum.`, views({ 0: 'found' }, n));
    for (let end = n - 1; end >= 1; end--) {
      b.swap(0, end);
      r.inc('swaps');
      b.fixed[end] = 'sorted';
      r.push(3, `Move max ${b.a[end]} to index ${end}; heap size is now ${end}.`, views({ 0: 'swap', [end]: 'sorted' }, end), { end });
      sift(0, end);
    }
    b.allSorted();
    r.push(2, 'Sorted.', views({}, 0));
    return r.steps;
  },
};

const counting: Algorithm = {
  id: 'counting-sort',
  name: 'Counting Sort',
  category: 'sorting',
  difficulty: 'Intermediate',
  summary: 'Count occurrences of each value, then rebuild the array from the counts.',
  about: [
    'No comparisons at all: for small integer ranges, tally how many times each value appears, then write each value out count times.',
    'Negative numbers are handled by offsetting: value v is counted in slot v − min, so the count array spans exactly min..max.',
    'Runs in O(n + k) where k = max − min + 1 — fantastic for ages, grades or digits, wasteful when k is huge.',
  ],
  time: { best: 'O(n + k)', avg: 'O(n + k)', worst: 'O(n + k)' },
  space: 'O(k)',
  code: [
    'procedure countingSort(A):',
    '  lo ← min(A); C ← zeros of size max(A) − lo + 1',
    '  for x in A: C[x − lo] ← C[x − lo] + 1',
    '  k ← 0',
    '  for v ← lo to max(A):',
    '    repeat C[v − lo] times: A[k] ← v; k ← k + 1',
  ],
  fields,
  defaults: { array: [4, -2, 2, 8, -3, 3, 1, 7, 4, 0, -2, 3] },
  random: () => ({ array: randArray(12, -6, 9) }),
  presets: [
    { label: 'Negatives only', params: { array: [-3, -7, -1, -7, -4, -2] }, note: 'Offset by min makes every slot index non-negative.' },
    { label: 'Many duplicates', params: { array: [2, 2, 2, 0, 0, 2, 1, 1, 2] }, note: 'Counting sort shines when values repeat a lot.' },
    { label: 'All equal', params: { array: [5, 5, 5, 5] }, note: 'k = 1: a single count slot.' },
    { label: 'Sparse range', params: { array: [-20, 25, 0] }, note: 'Only 3 values but 46 slots — the O(k) memory cost.' },
    { label: 'Single', params: { array: [-1] } },
    { label: 'Empty', params: { array: [] } },
  ],
  legend: ['compare', 'found', 'sorted'],
  run(p) {
    const a = nums(p.array, [4, 2, 2, 8, 3, 3, 1]).map((x) => Math.round(x));
    const b = new Bars(a);
    const r = new Recorder(['reads', 'writes']);
    const lo = Math.min(...a);
    const max = Math.max(...a);
    const k0 = max - lo + 1;
    if (k0 > 60) {
      r.push(1, `Value range ${lo}..${max} needs ${k0} count slots. Counting sort's memory grows with the range, not with n — that is its weakness. (This visualizer caps the range at 60.)`, [b.view()]);
      return r.steps;
    }
    const C = new Array(k0).fill(0);
    const labels = C.map((_, i) => String(i + lo));
    const cv = (t: Record<number, Tone> = {}) => arrayViz(C, { style: 'cells', title: `Counts C[v − (${lo})]`, labels, tones: t });
    r.push(1, lo < 0 ? `min = ${lo} is negative, so value v is stored at slot v − (${lo}). C has ${k0} slots.` : `Values range ${lo}..${max}, so C has ${k0} slots.`, [b.view(), cv()], { lo, max });
    a.forEach((x, i) => {
      C[x - lo]++;
      r.inc('reads');
      r.push(2, `A[${i}] = ${x} → slot ${x - lo}; count becomes ${C[x - lo]}.`, [b.view({ [i]: 'compare' }, [{ i, label: 'i' }]), cv({ [x - lo]: 'found' })], { x, slot: x - lo });
    });
    let k = 0;
    for (let v = lo; v <= max; v++) {
      const c0 = C[v - lo];
      if (!c0) continue;
      r.push(4, `Value ${v} appears ${c0} time(s).`, [b.view(), cv({ [v - lo]: 'pivot' })], { v, k });
      for (let c = 0; c < c0; c++) {
        b.a[k] = v;
        b.fixed[k] = 'sorted';
        r.inc('writes');
        r.push(5, `Write ${v} to A[${k}].`, [b.view({ [k]: 'found' }, [{ i: k, label: 'k' }]), cv({ [v - lo]: 'pivot' })], { v, k });
        k++;
      }
    }
    b.allSorted();
    r.push(5, 'Sorted.', [b.view(), cv()]);
    return r.steps;
  },
};

const radix: Algorithm = {
  id: 'radix-sort',
  name: 'Radix Sort (LSD)',
  category: 'sorting',
  difficulty: 'Advanced',
  summary: 'Sort by the ones digit, then tens, then hundreds — each pass is a stable bucket sort.',
  about: [
    'Least-significant-digit radix sort distributes numbers into 10 buckets by the current digit, then collects buckets in order. Because each pass is stable, earlier digit orderings survive.',
    'After d passes (d = number of digits) the array is sorted, giving O(d · (n + 10)).',
    'Digits only make sense for non-negative numbers, so when the input has negatives we first shift everything by −min, sort, and shift back. (The alternative is to sort negatives and positives separately.)',
  ],
  time: { best: 'O(d·n)', avg: 'O(d·n)', worst: 'O(d·n)' },
  space: 'O(n + 10)',
  code: [
    'procedure radixSort(A):',
    '  if min(A) < 0: shift ← −min(A); A ← A + shift',
    '  for exp ← 1, 10, 100, … while max(A)/exp > 0:',
    '    buckets ← 10 empty lists',
    '    for x in A: buckets[(x / exp) mod 10].append(x)',
    '    A ← concatenate buckets 0..9',
    '  A ← A − shift',
  ],
  fields,
  defaults: { array: [170, -45, 75, 90, 802, -24, 2, 66, 0, 158] },
  random: () => ({ array: randArray(10, -300, 999) }),
  presets: [
    { label: 'Negatives', params: { array: [-170, 45, -75, 90, -2, 24, 0] }, note: 'Shift by −min so every value has non-negative digits.' },
    { label: 'Non-negative', params: { array: [170, 45, 75, 90, 802, 24, 2, 66] }, note: 'Classic textbook input — no shift needed.' },
    { label: 'Different lengths', params: { array: [5, 1000, 42, 7, 300] }, note: 'Short numbers get implicit leading zeros.' },
    { label: 'All zeros', params: { array: [0, 0, 0] }, note: 'max = 0: no digit passes run at all.' },
    { label: 'Duplicates', params: { array: [21, 12, 21, 12, 21] }, note: 'Stability keeps equal keys in input order.' },
    { label: 'Empty', params: { array: [] } },
  ],
  legend: ['compare', 'found', 'sorted'],
  run(p) {
    const b = new Bars(nums(p.array, [170, 45, 75, 90, 802, 24, 2, 66]).map((x) => Math.round(x)));
    const r = new Recorder(['passes', 'moves']);
    const bucketViews = (bk: number[][], hot = -1): Viz[] =>
      bk.map((items, d) => ({ kind: 'list', title: `bucket ${d}`, items, mode: 'queue', tones: hot === d ? { [items.length - 1]: 'found' } : {} }));
    const min = Math.min(...b.a);
    const shift = min < 0 ? -min : 0;
    if (shift) {
      b.a = b.a.map((x) => x + shift);
      r.push(1, `min = ${min} is negative → add ${shift} to every value so all digits are ≥ 0.`, [b.view(rangeTones(0, b.a.length - 1, 'range'))], { shift });
    }
    const max = Math.max(...b.a);
    r.push(2, max === 0 ? 'Every value is 0 — there are no digits to sort by.' : `Largest value is ${max} → ${String(max).length} digit pass(es).`, [b.view()], { max });
    for (let exp = 1; Math.floor(max / exp) > 0; exp *= 10) {
      r.inc('passes');
      const bk: number[][] = Array.from({ length: 10 }, () => []);
      const place = exp === 1 ? 'ones' : exp === 10 ? 'tens' : exp === 100 ? 'hundreds' : `${exp}s`;
      r.push(3, `Pass on the ${place} digit.`, [b.view(), ...bucketViews(bk)], { exp });
      for (let i = 0; i < b.a.length; i++) {
        const d = Math.floor(b.a[i] / exp) % 10;
        bk[d].push(b.a[i]);
        r.inc('moves');
        r.push(4, `${b.a[i]} has ${place} digit ${d} → bucket ${d}.`, [b.view({ [i]: 'compare' }), ...bucketViews(bk, d)], { exp, digit: d });
      }
      const flat = bk.flat();
      flat.forEach((x, i) => (b.a[i] = x));
      r.push(5, 'Collect buckets 0→9 back into the array (stable).', [b.view(rangeTones(0, flat.length - 1, 'found')), ...bucketViews(bk)], { exp });
    }
    if (shift) {
      b.a = b.a.map((x) => x - shift);
      r.push(6, `Subtract ${shift} again to restore the original (negative) values.`, [b.view(rangeTones(0, b.a.length - 1, 'found'))], { shift });
    }
    b.allSorted();
    r.push(6, 'All digits processed — sorted.', [b.view()]);
    return r.steps;
  },
};

export const sortingAlgorithms: Algorithm[] = [bubble, selection, insertion, cocktail, shell, merge, quick, heap, counting, radix].map((a) =>
  guardEmpty({ ...a, presets: a.presets ?? SORT_PRESETS }, 'array', 'Edge case: the array is empty (n = 0). Every loop bound is already satisfied, so the algorithm returns immediately — an empty array is trivially sorted.'),
);
