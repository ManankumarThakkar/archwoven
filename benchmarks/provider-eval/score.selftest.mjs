#!/usr/bin/env node
/** Selftest for diagram-level scoring: how assembled nodes are matched to ground truth, and what counts as an unsupported claim. */
import assert from 'node:assert/strict';
import { scoreDiagram } from './score.mjs';

const truth = {
  evidenceRoot: 'backend/',
  nodes: [
    { kind: 'service', label: 'items-router', evidence: 'app/api/routes/items.py:10' },
    { kind: 'service', label: 'OwnerRepository', evidence: 'owner/OwnerRepository.java:36' },
    { kind: 'datastore', label: 'PostgreSQL', evidence: 'app/core/config.py:31 (DATABASE_URL)' },
  ],
  edges: [
    { from: 'items-router', to: 'PostgreSQL', evidence: 'x' },
    { from: 'OwnerRepository', to: 'PostgreSQL', evidence: 'x' },
  ],
};
const node = (id, label, provenance, evidence = []) => ({ id, kind: 'service', label, provenance, evidence });
const model = {
  nodes: [
    node('n1', 'Items API', 'source-supported', [{ path: 'backend/app/api/routes/items.py', lines: [10, 10] }]), // matched by evidence
    node('n2', 'Owner Repository', 'source-supported'), // matched by whole name (camel case split)
    node('n3', 'Postgres Replica', 'source-supported'), // near miss: no evidence, different name
    node('n4', 'PostgreSQL (primary)', 'source-supported'), // matched by name before the parenthetical
    node('n5', 'Customer', 'proposed'), // an inferred addition, not a claim
  ],
  edges: [
    { id: 'e1', from: 'n1', to: 'n4', provenance: 'source-supported' },
    { id: 'e2', from: 'n2', to: 'n3', provenance: 'source-supported' },
    { id: 'e3', from: 'n5', to: 'n1', provenance: 'inferred' },
  ],
};
const s = scoreDiagram(model, truth);
assert.equal(s.nodeRecall, '3/3');
assert.equal(s.edgeRecall, '1/2');
assert.deepEqual(s.missedEdges, ['OwnerRepository → PostgreSQL']);
assert.equal(s.sourceSupportedNodePrecision, '3/4');
assert.deepEqual(s.unsupportedNodes, ['Postgres Replica']);
assert.equal(s.sourceSupportedEdgePrecision, '1/2');
assert.deepEqual(s.unsupportedEdges, ['Owner Repository → Postgres Replica']);
assert.deepEqual(s.inferredOrProposed, { nodes: 1, edges: 1 });
// Evidence outside the cited line does not count.
assert.equal(scoreDiagram({ nodes: [node('a', 'Router', 'source-supported', [{ path: 'backend/app/api/routes/items.py', lines: [11, 20] }])], edges: [] }, truth).nodeRecall, '0/3');
console.log('score selftest: ok');
