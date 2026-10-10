import type { SystemModel } from '@archwoven/model';

/** BFS reachability from a node: forward = descendants, backward = ancestors,
 *  values = hop depth. The focus node itself is absent from both maps.
 *  Visited-set BFS — cycles and fastapi-scale graphs terminate by construction. */
export function reachability(model: SystemModel, id: string): { forward: Map<string, number>; backward: Map<string, number> } {
  const fwd = new Map<string, string[]>();
  const bwd = new Map<string, string[]>();
  for (const e of model.edges) {
    (fwd.get(e.from) ?? fwd.set(e.from, []).get(e.from)!).push(e.to);
    (bwd.get(e.to) ?? bwd.set(e.to, []).get(e.to)!).push(e.from);
  }
  const bfs = (from: string, adj: Map<string, string[]>): Map<string, number> => {
    const out = new Map<string, number>();
    if (!model.nodes.some((n) => n.id === from)) return out;
    const queue: [string, number][] = [[from, 0]];
    const seen = new Set([from]);
    while (queue.length) {
      const [cur, d] = queue.shift()!;
      for (const next of adj.get(cur) ?? []) {
        if (!seen.has(next)) { seen.add(next); out.set(next, d + 1); queue.push([next, d + 1]); }
      }
    }
    return out;
  };
  return { forward: bfs(id, fwd), backward: bfs(id, bwd) };
}

/** Shortest forward node path from→to (inclusive); null when unreachable. */
export function journey(model: SystemModel, from: string, to: string): string[] | null {
  if (!model.nodes.some((n) => n.id === from) || !model.nodes.some((n) => n.id === to)) return null;
  if (from === to) return [from];
  const adj = new Map<string, string[]>();
  for (const e of model.edges) (adj.get(e.from) ?? adj.set(e.from, []).get(e.from)!).push(e.to);
  const prev = new Map<string, string>();
  const seen = new Set([from]);
  const queue = [from];
  while (queue.length) {
    const cur = queue.shift()!;
    for (const next of adj.get(cur) ?? []) {
      if (seen.has(next)) continue;
      seen.add(next);
      prev.set(next, cur);
      if (next === to) {
        const path = [to];
        for (let c = to; c !== from; c = prev.get(c)!) path.unshift(prev.get(c)!);
        return path;
      }
      queue.push(next);
    }
  }
  return null;
}
