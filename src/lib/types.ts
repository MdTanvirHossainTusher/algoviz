export type Tone =
  | 'compare'
  | 'swap'
  | 'active'
  | 'sorted'
  | 'found'
  | 'pivot'
  | 'visited'
  | 'frontier'
  | 'path'
  | 'dim'
  | 'bad'
  | 'range'
  | 'wall'
  | 'start'
  | 'goal';

export interface Pointer {
  i: number;
  label: string;
}

export interface ArrayViz {
  kind: 'array';
  title?: string;
  values: (number | string)[];
  /** stable identity per element so bars can slide when swapped */
  ids?: number[];
  tones?: Record<number, Tone>;
  pointers?: Pointer[];
  /** render as tall bars (numeric) or flat cells */
  style?: 'bars' | 'cells';
  /** labels under each element (e.g. indexes or names) */
  labels?: string[];
}

export interface TableViz {
  kind: 'table';
  title?: string;
  cells: (string | number | null)[][];
  rowHeaders?: string[];
  colHeaders?: string[];
  /** key "r,c" */
  tones?: Record<string, Tone>;
  /** square, label-less grid cells (mazes, boards) */
  grid?: boolean;
}

export interface GraphNode {
  id: string;
  x: number;
  y: number;
  label?: string;
}

export interface GraphEdge {
  a: string;
  b: string;
  w?: number;
  /** two-way edge drawn without arrowheads in a directed graph; tones may use either a->b or b->a */
  both?: boolean;
}

export interface GraphViz {
  kind: 'graph';
  title?: string;
  nodes: GraphNode[];
  edges: GraphEdge[];
  directed?: boolean;
  nodeTones?: Record<string, Tone>;
  /** key "a->b" (directed) or "a-b" with a<b ordering handled by edgeKey() */
  edgeTones?: Record<string, Tone>;
  /** small text shown under a node, e.g. distance */
  badges?: Record<string, string>;
  width?: number;
  height?: number;
}

export interface ListViz {
  kind: 'list';
  title: string;
  items: (string | number)[];
  /** queue = left→right FIFO, stack = top on the right */
  mode?: 'queue' | 'stack' | 'set';
  tones?: Record<number, Tone>;
}

export type Viz = ArrayViz | TableViz | GraphViz | ListViz;

export interface Step {
  /** 0-based line in the algorithm's pseudocode */
  line?: number;
  msg: string;
  views: Viz[];
  vars?: Record<string, string | number | boolean>;
  stats?: Record<string, number>;
}

export type CategoryId =
  | 'sorting'
  | 'searching'
  | 'graph'
  | 'dp'
  | 'greedy'
  | 'backtracking'
  | 'trees'
  | 'technique';

export interface InputField {
  key: string;
  label: string;
  kind: 'numbers' | 'number' | 'text';
  hint?: string;
  min?: number;
  max?: number;
}

export type Params = Record<string, number[] | number | string>;

export interface Preset {
  label: string;
  params: Params;
  /** why this case is interesting */
  note?: string;
}

export interface Algorithm {
  id: string;
  name: string;
  category: CategoryId;
  difficulty: 'Beginner' | 'Intermediate' | 'Advanced';
  summary: string;
  about: string[];
  time: { best: string; avg: string; worst: string };
  space: string;
  code: string[];
  fields: InputField[];
  defaults: Params;
  random?: () => Params;
  /** one-click inputs, mostly edge cases (empty, duplicates, negatives, not-found…) */
  presets?: Preset[];
  run: (p: Params) => Step[];
  legend?: Tone[];
}
