import type { Evidence, SystemModel } from '@archwoven/model';

export type ModelJsonVariant = 'full' | 'no-evidence';

const references = (e: Evidence): boolean => e.repo != null || e.commit != null || e.path != null || e.lines != null;

/** Whether any evidence points at source (repo/commit/path/lines). Note-only evidence is not a source reference. */
export function sourceReferences(model: SystemModel): { present: boolean; repos: string[] } {
  const evidence = [...model.nodes, ...model.edges].flatMap((item) => item.evidence);
  return {
    present: evidence.some(references),
    repos: [...new Set(evidence.flatMap((e) => (e.repo ? [e.repo] : [])))],
  };
}

/** The saved model as a downloadable file. 'no-evidence' empties evidence lists; every other field is unchanged. */
export function modelJson(model: SystemModel, variant: ModelJsonVariant): string {
  const output = variant === 'full' ? model : {
    ...model,
    nodes: model.nodes.map((node) => ({ ...node, evidence: [] })),
    edges: model.edges.map((edge) => ({ ...edge, evidence: [] })),
  };
  return `${JSON.stringify(output, null, 2)}\n`;
}

export function modelJsonFileName(model: SystemModel, variant: ModelJsonVariant): string {
  const slug = model.title.normalize('NFKD').replace(/[̀-ͯ]/g, '').toLowerCase()
    .replace(/[^a-z0-9]+/g, '-').slice(0, 60).replace(/^-+|-+$/g, '') || 'model';
  return `archwoven-${slug}-r${model.revision}${variant === 'no-evidence' ? '-no-evidence' : ''}.json`;
}
