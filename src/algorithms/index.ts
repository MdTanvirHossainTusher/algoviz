import type { Algorithm, CategoryId } from '../lib/types';
import { sortingAlgorithms } from './sorting';
import { searchingAlgorithms } from './searching';
import { graphAlgorithms } from './graph';
import { dpAlgorithms } from './dp';
import { greedyAlgorithms } from './greedy';
import { backtrackingAlgorithms } from './backtracking';
import { treeAlgorithms } from './trees';
import { techniqueAlgorithms } from './technique';

export interface Category {
  id: CategoryId;
  name: string;
  color: string;
  blurb: string;
  items: Algorithm[];
}

export const categories: Category[] = [
  { id: 'sorting', name: 'Sorting', color: 'var(--c-sort)', blurb: 'Put things in order — comparisons, swaps, and the tricks that avoid them.', items: sortingAlgorithms },
  { id: 'searching', name: 'Searching', color: 'var(--c-search)', blurb: 'Find a needle fast by exploiting order.', items: searchingAlgorithms },
  { id: 'graph', name: 'Graphs', color: 'var(--c-graph)', blurb: 'Traversal, shortest paths, spanning trees and ordering.', items: graphAlgorithms },
  { id: 'dp', name: 'Dynamic Programming', color: 'var(--c-dp)', blurb: 'Solve each subproblem once and reuse the answer.', items: dpAlgorithms },
  { id: 'greedy', name: 'Greedy', color: 'var(--c-greedy)', blurb: 'Take the locally best choice — and learn when that fails.', items: greedyAlgorithms },
  { id: 'backtracking', name: 'Backtracking', color: 'var(--c-back)', blurb: 'Try, recurse, undo.', items: backtrackingAlgorithms },
  { id: 'trees', name: 'Trees', color: 'var(--c-tree)', blurb: 'Hierarchies and binary search trees.', items: treeAlgorithms },
  { id: 'technique', name: 'Techniques', color: 'var(--c-tech)', blurb: 'Two pointers, sliding windows and other patterns.', items: techniqueAlgorithms },
];

export const allAlgorithms: Algorithm[] = categories.flatMap((c) => c.items);
export const algorithmById = new Map(allAlgorithms.map((a) => [a.id, a]));
export const categoryOf = (a: Algorithm) => categories.find((c) => c.id === a.category)!;
