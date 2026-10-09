'use client';

import { useEffect, useMemo, useState } from 'react';
import { ReactFlow, Background, Controls, MiniMap, type Node, type Edge } from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import type { SystemModel, Provenance } from '@archwoven/model';
import { layoutModel } from '../../lib/layout';

// proposed/inferred are visually distinct from user-specified/source-supported (scenario 6).
const PROVENANCE_STYLE: Record<Provenance, { border: string; bg: string; badge: string }> = {
  'user-specified': { border: '#5eead4', bg: '#0f2e2b', badge: 'you' },
  'source-supported': { border: '#93c5fd', bg: '#10233f', badge: 'code' },
  inferred: { border: '#fbbf24', bg: '#3a2e10', badge: 'inferred' },
  proposed: { border: '#c4b5fd', bg: '#2a2440', badge: 'proposed' },
};

export function Canvas({ model, viewId, onSelect }: { model: SystemModel; viewId: string; onSelect: (id: string) => void }) {
  const [placed, setPlaced] = useState<{ nodes: Node[]; edges: Edge[] }>({ nodes: [], edges: [] });

  useEffect(() => {
    let alive = true;
    layoutModel(model, viewId).then((r) => {
      if (!alive) return;
      const view = model.views.find((v) => v.id === viewId);
      const nodes: Node[] = r.nodes.map((n) => {
        const node = model.nodes.find((m) => m.id === n.id)!;
        const s = PROVENANCE_STYLE[node.provenance];
        return {
          id: n.id,
          position: { x: n.x, y: n.y },
          data: { label: `${s.badge} · ${node.label}` },
          style: { width: n.width, height: n.height, border: `2px solid ${s.border}`, background: s.bg, color: '#e5e7eb', borderRadius: 10, display: 'grid', placeItems: 'center', fontSize: 13 },
        };
      });
      const edges: Edge[] = (view?.edges ?? []).flatMap((id) => {
        const e = model.edges.find((m) => m.id === id);
        if (!e) return [];
        return [{ id, source: e.from, target: e.to, label: e.label ?? '', animated: e.type === 'async', style: { stroke: PROVENANCE_STYLE[e.provenance].border } }];
      });
      setPlaced({ nodes, edges });
    });
    return () => { alive = false; };
  }, [model, viewId]);

  return (
    <div style={{ width: '100%', height: '100%' }}>
      <ReactFlow nodes={placed.nodes} edges={placed.edges} fitView onNodeClick={(_, n) => onSelect(n.id)} onEdgeClick={(_, e) => onSelect(e.id)} proOptions={{ hideAttribution: true }}>
        <Background gap={16} color="#1a2333" />
        <Controls />
        <MiniMap pannable zoomable />
      </ReactFlow>
    </div>
  );
}
