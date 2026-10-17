/** Diagram-level scoring of an assembled model against repository ground truth (probes/ground-truth/*.json). */
const normalize = (name) => String(name).replace(/([a-z0-9])([A-Z])/g, '$1 $2').toLowerCase().replace(/&/g, ' and ').replace(/[^a-z0-9]+/g, ' ').trim()
  .split(' ').map((w) => (w.length > 3 && w.endsWith('s') && !w.endsWith('ss') ? w.slice(0, -1) : w)).join(' ');
const namesOf = (label) => new Set([label, label.replace(/\([^)]*\)/g, ' '), ...[...label.matchAll(/\(([^)]*)\)/g)].map((m) => m[1])].map(normalize).filter(Boolean));
/** An assembled node stands for a truth node when its evidence cites the truth line, or its whole name matches. */
export function scoreDiagram(model, truth) {
  const loc = (ev) => { const m = /^([^\s:]+):(\d+)/.exec(ev); return m && { path: m[1].startsWith('src/') ? m[1] : `${truth.evidenceRoot ?? ''}${m[1]}`, line: Number(m[2]) }; };
  const stands = new Map(model.nodes.map((n) => [n.id, new Set(truth.nodes.filter((t) => {
    const at = loc(t.evidence);
    const cited = at && (n.evidence ?? []).some((e) => e.path === at.path && e.lines?.[0] <= at.line && at.line <= e.lines?.[1]);
    return cited || namesOf(String(n.label)).has(normalize(t.label));
  }).map((t) => t.label))]));
  const edgeHits = (e) => truth.edges.filter((t) => stands.get(e.from)?.has(t.from) && stands.get(e.to)?.has(t.to));
  const foundNodes = truth.nodes.filter((t) => [...stands.values()].some((s) => s.has(t.label)));
  const foundEdges = truth.edges.filter((t) => model.edges.some((e) => edgeHits(e).includes(t)));
  const ssNodes = model.nodes.filter((n) => n.provenance === 'source-supported');
  const ssEdges = model.edges.filter((e) => e.provenance === 'source-supported');
  const unsupportedNodes = ssNodes.filter((n) => stands.get(n.id).size === 0).map((n) => n.label);
  const unsupportedEdges = ssEdges.filter((e) => edgeHits(e).length === 0).map((e) => `${model.nodes.find((n) => n.id === e.from)?.label} → ${model.nodes.find((n) => n.id === e.to)?.label}`);
  return {
    nodeRecall: `${foundNodes.length}/${truth.nodes.length}`, edgeRecall: `${foundEdges.length}/${truth.edges.length}`,
    sourceSupportedNodePrecision: `${ssNodes.length - unsupportedNodes.length}/${ssNodes.length}`,
    sourceSupportedEdgePrecision: `${ssEdges.length - unsupportedEdges.length}/${ssEdges.length}`,
    missedNodes: truth.nodes.filter((t) => !foundNodes.includes(t)).map((t) => t.label),
    missedEdges: truth.edges.filter((t) => !foundEdges.includes(t)).map((t) => `${t.from} → ${t.to}`),
    unsupportedNodes, unsupportedEdges,
    inferredOrProposed: { nodes: model.nodes.length - ssNodes.length, edges: model.edges.length - ssEdges.length },
  };
}
