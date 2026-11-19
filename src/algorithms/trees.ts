import type { Algorithm, Tone, Viz, GraphViz } from '../lib/types';
import { Recorder, nums, num, str, randArray, randInt } from '../lib/recorder';

interface BNode {
  id: string;
  v: number;
  left?: BNode;
  right?: BNode;
}

function treeViz(root: BNode | undefined, tones: Record<string, Tone> = {}, edgeTones: Record<string, Tone> = {}, title?: string): GraphViz {
  const nodes: GraphViz['nodes'] = [];
  const edges: GraphViz['edges'] = [];
  let x = 0;
  let maxD = 0;
  const walk = (n: BNode | undefined, d: number) => {
    if (!n) return;
    maxD = Math.max(maxD, d);
    walk(n.left, d + 1);
    nodes.push({ id: n.id, x: 0, y: 40 + d * 64, label: String(n.v) });
    (nodes[nodes.length - 1] as { x: number }).x = x++;
    if (n.left) edges.push({ a: n.id, b: n.left.id });
    if (n.right) edges.push({ a: n.id, b: n.right.id });
    walk(n.right, d + 1);
  };
  walk(root, 0);
  const W = Math.max(320, nodes.length * 52 + 40);
  for (const n of nodes) n.x = 30 + (n.x + 0.5) * ((W - 60) / Math.max(1, nodes.length));
  return { kind: 'graph', title, nodes, edges, nodeTones: tones, edgeTones, width: W, height: 80 + maxD * 64 };
}

const ek = (a: string, b: string) => (a < b ? `${a}-${b}` : `${b}-${a}`);

function buildBST(values: number[]) {
  let root: BNode | undefined;
  let uid = 0;
  for (const v of values) {
    const node: BNode = { id: `t${uid++}`, v };
    if (!root) {
      root = node;
      continue;
    }
    let cur = root;
    for (;;) {
      if (v === cur.v) break; // duplicates ignored
      const side = v < cur.v ? 'left' : 'right';
      if (!cur[side]) {
        cur[side] = node;
        break;
      }
      cur = cur[side]!;
    }
  }
  return root;
}

const BST_DEF = [50, 30, 70, -20, 40, 60, 80, 35, 65, 0];

const bst: Algorithm = {
  id: 'bst-insert-search',
  name: 'BST Insert & Search',
  category: 'trees',
  difficulty: 'Beginner',
  summary: 'Insert values into a binary search tree, then search for a key by walking left or right.',
  about: [
    'Every node keeps smaller keys in its left subtree and larger keys in its right. Insert and search both follow a single root-to-leaf path, so they cost O(height).',
    'Edge cases: duplicates are ignored here (a policy choice); inserting sorted input produces a degenerate, list-shaped tree where height = n and operations become O(n).',
  ],
  time: { best: 'O(log n)', avg: 'O(log n)', worst: 'O(n)' },
  space: 'O(n)',
  code: [
    'procedure insert(root, x):',
    '  if root is null: return new node(x)',
    '  if x = root.key: return root          // duplicate ignored',
    '  if x < root.key: root.left ← insert(root.left, x)',
    '  else: root.right ← insert(root.right, x)',
    'procedure search(root, k):',
    '  while root ≠ null and root.key ≠ k:',
    '    root ← k < root.key ? root.left : root.right',
    '  return root (null = not found)',
  ],
  fields: [
    { key: 'array', label: 'Insert order', kind: 'numbers', hint: 'negatives OK' },
    { key: 'target', label: 'Search for', kind: 'number' },
  ],
  defaults: { array: BST_DEF, target: 65 },
  random: () => {
    const a = randArray(10, -50, 99);
    return { array: a, target: Math.random() < 0.7 ? a[randInt(0, 9)] : randInt(-50, 99) };
  },
  presets: [
    { label: 'Sorted input', params: { array: [1, 2, 3, 4, 5, 6, 7], target: 7 }, note: 'Degenerates into a linked list — height n.' },
    { label: 'Duplicates', params: { array: [5, 3, 5, 8, 3, 5], target: 3 }, note: 'Repeated keys are skipped.' },
    { label: 'Negatives', params: { array: [0, -10, 10, -15, -5, 5, 15], target: -5 } },
    { label: 'Not found', params: { array: BST_DEF, target: 55 }, note: 'Search falls off the tree at a null child.' },
    { label: 'Single', params: { array: [42], target: 42 } },
    { label: 'Empty', params: { array: [], target: 1 }, note: 'Searching an empty tree returns null immediately.' },
  ],
  legend: ['active', 'compare', 'found', 'bad'],
  run(p) {
    const values = nums(p.array, BST_DEF);
    const target = num(p.target, 65);
    const r = new Recorder(['comparisons']);
    let root: BNode | undefined;
    let uid = 0;
    const view = (t: Record<string, Tone> = {}, e: Record<string, Tone> = {}): Viz[] => [treeViz(root, t, e)];
    for (const v of values) {
      const node: BNode = { id: `t${uid++}`, v };
      if (!root) {
        root = node;
        r.push(1, `Tree is empty → ${v} becomes the root.`, view({ [node.id]: 'found' }), { x: v });
        continue;
      }
      let cur = root;
      const trail: Record<string, Tone> = {};
      for (;;) {
        r.inc('comparisons');
        trail[cur.id] = 'compare';
        if (v === cur.v) {
          r.push(2, `${v} = ${cur.v}: duplicate, ignore it.`, view({ ...trail, [cur.id]: 'bad' }), { x: v });
          break;
        }
        const side = v < cur.v ? 'left' : 'right';
        r.push(side === 'left' ? 3 : 4, `${v} ${side === 'left' ? '<' : '>'} ${cur.v} → go ${side}.`, view({ ...trail, [cur.id]: 'active' }), { x: v, at: cur.v });
        if (!cur[side]) {
          cur[side] = node;
          r.push(1, `Empty ${side} child → insert ${v} here.`, view({ ...trail, [node.id]: 'found' }, { [ek(cur.id, node.id)]: 'path' }), { x: v });
          break;
        }
        cur = cur[side]!;
      }
    }
    if (!root) {
      r.push(8, 'Edge case: no values → the tree is empty, so any search returns null.', view());
      return r.steps;
    }
    let cur: BNode | undefined = root;
    const trail: Record<string, Tone> = {};
    const etr: Record<string, Tone> = {};
    r.push(5, `Search for ${target}, starting at the root.`, view(), { k: target });
    while (cur) {
      r.inc('comparisons');
      if (cur.v === target) {
        r.push(8, `Found ${target}.`, view({ ...trail, [cur.id]: 'found' }, etr), { k: target });
        return r.steps;
      }
      trail[cur.id] = 'compare';
      const next: BNode | undefined = target < cur.v ? cur.left : cur.right;
      r.push(7, `${target} ${target < cur.v ? '<' : '>'} ${cur.v} → go ${target < cur.v ? 'left' : 'right'}${next ? '' : ' … but that child is null'}.`, view({ ...trail, [cur.id]: 'active' }, etr), { k: target, at: cur.v });
      if (next) etr[ek(cur.id, next.id)] = 'path';
      cur = next;
    }
    r.push(8, `Reached a null child — ${target} is not in the tree.`, view(trail, etr), { k: target });
    return r.steps;
  },
};

const traversals: Algorithm = {
  id: 'tree-traversals',
  name: 'Tree Traversals',
  category: 'trees',
  difficulty: 'Beginner',
  summary: 'Visit every node in-order, pre-order, post-order or level-order.',
  about: [
    'In-order (left, node, right) prints a BST in sorted order. Pre-order (node, left, right) copies a tree. Post-order (left, right, node) frees or evaluates it bottom-up. Level-order uses a queue to go breadth-first.',
    'Edge cases: an empty tree yields an empty list; a single node is the whole output in every order.',
  ],
  time: { best: 'O(n)', avg: 'O(n)', worst: 'O(n)' },
  space: 'O(h)',
  code: [
    'procedure traverse(node):',
    '  if node is null: return',
    '  PRE:   visit(node)',
    '  traverse(node.left)',
    '  IN:    visit(node)',
    '  traverse(node.right)',
    '  POST:  visit(node)',
    'LEVEL: queue ← [root]; while queue: n ← dequeue; visit(n); enqueue children',
  ],
  fields: [
    { key: 'array', label: 'BST insert order', kind: 'numbers' },
    { key: 'order', label: 'Order', kind: 'text', hint: 'in · pre · post · level' },
  ],
  defaults: { array: [8, 3, 10, 1, 6, 14, 4, 7, 13, -2], order: 'in' },
  random: () => ({ array: randArray(9, -30, 60), order: ['in', 'pre', 'post', 'level'][randInt(0, 3)] }),
  presets: [
    { label: 'In-order', params: { array: [8, 3, 10, 1, 6, 14, 4, 7, 13, -2], order: 'in' }, note: 'Sorted output.' },
    { label: 'Pre-order', params: { array: [8, 3, 10, 1, 6, 14, 4, 7, 13, -2], order: 'pre' } },
    { label: 'Post-order', params: { array: [8, 3, 10, 1, 6, 14, 4, 7, 13, -2], order: 'post' } },
    { label: 'Level-order', params: { array: [8, 3, 10, 1, 6, 14, 4, 7, 13, -2], order: 'level' } },
    { label: 'Skewed', params: { array: [5, 4, 3, 2, 1], order: 'in' }, note: 'Recursion depth = n.' },
    { label: 'Empty', params: { array: [], order: 'in' } },
  ],
  legend: ['active', 'compare', 'found'],
  run(p) {
    const root = buildBST(nums(p.array, [8, 3, 10]));
    const order = str(p.order, 'in').toLowerCase().replace(/[^a-z]/g, '').replace(/order$/, '');
    const mode = ['in', 'pre', 'post', 'level'].includes(order) ? order : 'in';
    const r = new Recorder(['visits']);
    const out: number[] = [];
    const done: Record<string, Tone> = {};
    const view = (t: Record<string, Tone> = {}, extra: Viz[] = []): Viz[] => [treeViz(root, { ...done, ...t }), { kind: 'list', title: `${mode}-order output`, items: out, mode: 'queue' }, ...extra];
    if (!root) {
      r.push(1, 'Edge case: the tree is empty — the traversal returns [].', view());
      return r.steps;
    }
    if (mode !== order) r.push(0, `Unknown order "${p.order}" — using in-order.`, view());
    if (mode === 'level') {
      const q: BNode[] = [root];
      r.push(7, 'Start with the root in the queue.', view({}, [{ kind: 'list', title: 'Queue', items: q.map((n) => n.v), mode: 'queue' }]));
      while (q.length) {
        const n = q.shift()!;
        out.push(n.v);
        done[n.id] = 'found';
        r.inc('visits');
        if (n.left) q.push(n.left);
        if (n.right) q.push(n.right);
        r.push(7, `Dequeue and visit ${n.v}; enqueue its children.`, view({ [n.id]: 'active' }, [{ kind: 'list', title: 'Queue', items: q.map((x) => x.v), mode: 'queue' }]));
      }
    } else {
      const stack: number[] = [];
      const go = (n: BNode | undefined, from?: BNode) => {
        if (!n) {
          if (from) r.push(1, `Null child of ${from.v} — return.`, view({ [from.id]: 'compare' }, [{ kind: 'list', title: 'Call stack', items: stack, mode: 'stack' }]));
          return;
        }
        stack.push(n.v);
        const st = () => [{ kind: 'list' as const, title: 'Call stack', items: [...stack], mode: 'stack' as const }];
        const visit = (line: number) => {
          out.push(n.v);
          done[n.id] = 'found';
          r.inc('visits');
          r.push(line, `Visit ${n.v}.`, view({ [n.id]: 'active' }, st()));
        };
        r.push(0, `Enter ${n.v}.`, view({ [n.id]: 'compare' }, st()));
        if (mode === 'pre') visit(2);
        r.push(3, `Go left from ${n.v}.`, view({ [n.id]: 'compare' }, st()));
        go(n.left, n);
        if (mode === 'in') visit(4);
        r.push(5, `Go right from ${n.v}.`, view({ [n.id]: 'compare' }, st()));
        go(n.right, n);
        if (mode === 'post') visit(6);
        stack.pop();
      };
      go(root);
    }
    r.push(mode === 'level' ? 7 : 6, `${mode}-order: ${out.join(', ')}.`, view());
    return r.steps;
  },
};

export const treeAlgorithms: Algorithm[] = [bst, traversals];
