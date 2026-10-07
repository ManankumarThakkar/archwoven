import type { Edge, Evidence, Node } from '@archwoven/model';

export interface FragmentEndpoint {
  method: string;
  path: string;
  evidence: Evidence;
}

/** A piece of a SystemModel extracted from source: everything source-supported, plus explicit gaps. */
export interface Fragment {
  nodes: Node[];
  edges: Edge[];
  endpoints: FragmentEndpoint[];
  gaps: string[];
}
