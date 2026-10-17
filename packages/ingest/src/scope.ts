import { isVendor } from './exclusions';
import { isSafeSourcePath, type Fragment } from '@archwoven/extract';
import type { Evidence } from '@archwoven/model';

/** Validate both ingestion boundaries before git or network work. */
export const isSafeSubdir = (value: string): boolean =>
  /^[\w.-]+(\/[\w.-]+)*$/.test(value) && value.split('/').every(part => part !== '.' && part !== '..') && isSafeSourcePath(value) && !isVendor(value);

export const withinScope = (path: string, subdir?: string): boolean => !subdir || path.startsWith(subdir + '/');

/** Framework inventories remain analysis-root-relative internally, while every
 * published evidence path must refer to the original repository tree. */
export function scopedEvidence(fragment: Fragment, subdir?: string): Fragment {
  if (!subdir) return fragment;
  const prefix = (e: Evidence): Evidence => e.path ? { ...e, path: `${subdir}/${e.path}` } : e;
  return {
    ...fragment,
    nodes: fragment.nodes.map(node => ({ ...node, evidence: node.evidence.map(prefix) })),
    edges: fragment.edges.map(edge => ({ ...edge, evidence: edge.evidence.map(prefix) })),
    endpoints: fragment.endpoints.map(endpoint => ({ ...endpoint, evidence: prefix(endpoint.evidence) })),
  };
}
