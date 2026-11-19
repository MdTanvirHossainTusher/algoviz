import type { GraphEdge, GraphNode, GraphViz, Tone } from '../lib/types';
import { edgeKey } from '../lib/recorder';

export interface ParsedGraph {
  ids: string[];
  edges: (GraphEdge & { directed: boolean })[];
  errors: string[];
}

/**
 * Parse "A-B:4, B>C:-2, D" — `-` is undirected, `>` is directed, `:w` is optional (default 1),
 * a bare name adds an isolated node. Separators: comma, semicolon or newline.
 */
export function parseGraph(text: string): ParsedGraph {
  const ids = new Set<string>();
  const edges: ParsedGraph['edges'] = [];
  const errors: string[] = [];
  for (const raw of text.split(/[,;\n]+/)) {
    const tok = raw.trim();
    if (!tok) continue;
    const m = tok.match(/^([\w]+)\s*([->])\s*([\w]+)\s*(?::\s*(-?\d+(?:\.\d+)?))?$/);
    if (m) {
      const [, a, op, b, w] = m;
      ids.add(a);
      ids.add(b);
      edges.push({ a, b, w: w === undefined ? 1 : Number(w), directed: op === '>' });
    } else if (/^\w+$/.test(tok)) {
      ids.add(tok);
    } else {
      errors.push(`Could not read "${tok}"`);
    }
  }
  return { ids: [...ids].sort((x, y) => x.localeCompare(y, undefined, { numeric: true })), edges, errors };
}

/** Deterministic spring layout seeded from a circle, scaled into the viewbox. */
export function layout(ids: string[], edges: GraphEdge[], W = 640, H = 380): GraphNode[] {
  const n = ids.length;
  if (n === 0) return [];
  if (n === 1) return [{ id: ids[0], x: W / 2, y: H / 2, label: ids[0] }];
  const pos = ids.map((_, i) => {
    const t = (2 * Math.PI * i) / n - Math.PI / 2;
    return { x: Math.cos(t), y: Math.sin(t) };
  });
  const idx = new Map(ids.map((id, i) => [id, i]));
  const k = Math.sqrt(4 / n);
  for (let it = 0; it < 300; it++) {
    const disp = pos.map(() => ({ x: 0, y: 0 }));
    for (let i = 0; i < n; i++)
      for (let j = i + 1; j < n; j++) {
        const dx = pos[i].x - pos[j].x;
        const dy = pos[i].y - pos[j].y;
        const d = Math.max(0.01, Math.hypot(dx, dy));
        const f = (k * k) / d;
        disp[i].x += (dx / d) * f;
        disp[i].y += (dy / d) * f;
        disp[j].x -= (dx / d) * f;
        disp[j].y -= (dy / d) * f;
      }
    for (const e of edges) {
      const i = idx.get(e.a)!;
      const j = idx.get(e.b)!;
      if (i === j) continue;
      const dx = pos[i].x - pos[j].x;
      const dy = pos[i].y - pos[j].y;
      const d = Math.max(0.01, Math.hypot(dx, dy));
      const f = (d * d) / k;
      disp[i].x -= (dx / d) * f;
      disp[i].y -= (dy / d) * f;
      disp[j].x += (dx / d) * f;
      disp[j].y += (dy / d) * f;
    }
    const temp = 0.1 * (1 - it / 300) + 0.005;
    for (let i = 0; i < n; i++) {
      const d = Math.max(0.01, Math.hypot(disp[i].x, disp[i].y));
      pos[i].x += (disp[i].x / d) * Math.min(d, temp);
      pos[i].y += (disp[i].y / d) * Math.min(d, temp);
      // weak gravity keeps isolated nodes from drifting away
      pos[i].x *= 0.995;
      pos[i].y *= 0.995;
    }
  }
  const xs = pos.map((p) => p.x);
  const ys = pos.map((p) => p.y);
  const [x0, x1, y0, y1] = [Math.min(...xs), Math.max(...xs), Math.min(...ys), Math.max(...ys)];
  const pad = 50;
  return ids.map((id, i) => ({
    id,
    label: id,
    x: pad + ((pos[i].x - x0) / (x1 - x0 || 1)) * (W - 2 * pad),
    y: pad + ((pos[i].y - y0) / (y1 - y0 || 1)) * (H - 2 * pad),
  }));
}

export interface Graph {
  ids: string[];
  nodes: GraphNode[];
  /** what gets drawn; `both` marks a two-way edge inside a directed graph */
  edges: GraphEdge[];
  /** every traversable arc u→v (both directions for two-way edges) — what relaxation loops iterate */
  arcs: GraphEdge[];
  directed: boolean;
  /** adjacency list respecting `directed` */
  adj: Map<string, { to: string; w: number }[]>;
  errors: string[];
}

/** Build a graph; `directed` decides how `-` edges are treated for traversal. */
export function buildGraph(text: string, directed: boolean): Graph {
  const p = parseGraph(text);
  const adj = new Map<string, { to: string; w: number }[]>(p.ids.map((id) => [id, []]));
  const edges: GraphEdge[] = [];
  const arcs: GraphEdge[] = [];
  for (const e of p.edges) {
    adj.get(e.a)!.push({ to: e.b, w: e.w! });
    if (!directed || !e.directed) {
      if (e.a !== e.b) adj.get(e.b)!.push({ to: e.a, w: e.w! });
    }
    const twoWay = directed && !e.directed && e.a !== e.b;
    edges.push({ a: e.a, b: e.b, w: e.w, both: twoWay || undefined });
    arcs.push({ a: e.a, b: e.b, w: e.w });
    if (twoWay) arcs.push({ a: e.b, b: e.a, w: e.w });
  }
  for (const l of adj.values()) l.sort((x, y) => x.to.localeCompare(y.to, undefined, { numeric: true }));
  return { ids: p.ids, nodes: layout(p.ids, edges), edges, arcs, directed, adj, errors: p.errors };
}

export function gview(
  g: Graph,
  nodeTones: Record<string, Tone> = {},
  edgeTones: Record<string, Tone> = {},
  badges: Record<string, string> = {},
  title?: string,
  showWeights = true,
): GraphViz {
  return {
    kind: 'graph',
    title,
    nodes: g.nodes,
    edges: showWeights ? g.edges : g.edges.map((e) => ({ a: e.a, b: e.b, both: e.both })),
    directed: g.directed,
    nodeTones: { ...nodeTones },
    edgeTones: { ...edgeTones },
    badges: { ...badges },
  };
}

export const ek = (g: Graph, a: string, b: string) => edgeKey(a, b, g.directed);

export const fmtDist = (d: number) => (d === Infinity ? '∞' : d === -Infinity ? '−∞' : String(d));
