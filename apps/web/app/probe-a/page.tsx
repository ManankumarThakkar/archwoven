'use client';

import { useEffect, useMemo, useState } from 'react';
import {
  ReactFlow,
  Background,
  Controls,
  Handle,
  Position,
  type Node as FlowNode,
  type Edge as FlowEdge,
} from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import { validateModel, validFullModel, type Node as ModelNode, type SystemModel } from '@archwoven/model';
import { layoutModel } from '../../probes/render/layout';
import { sequenceSvg } from '../../probes/render/sequence';
import { ensureResvg, renderPng } from '../../probes/render/export';
import stressRaw from '../../probes/render/stress-fixture.json';

const PROVENANCE_STYLE: Record<string, { border: string; badge: string; label: string }> = {
  'user-specified': { border: '#5eead4', badge: '#0f766e', label: 'you' },
  'source-supported': { border: '#34d399', badge: '#065f46', label: 'source' },
  inferred: { border: '#fbbf24', badge: '#92400e', label: 'inferred' },
  proposed: { border: '#a78bfa', badge: '#5b21b6', label: 'proposed' },
};

function ArchNode({ data }: { data: { node: ModelNode } }) {
  const p = PROVENANCE_STYLE[data.node.provenance]!;
  return (
    <div
      style={{
        padding: '10px 16px',
        borderRadius: 10,
        background: '#16213b',
        border: `1.5px ${data.node.provenance === 'proposed' ? 'dashed' : 'solid'} ${p.border}`,
        color: '#e6edf7',
        fontSize: 13,
        minWidth: 140,
      }}
    >
      <div style={{ display: 'flex', justifyContent: 'space-between', gap: 10 }}>
        <span style={{ fontWeight: 600 }}>{data.node.label}</span>
        <span style={{ fontSize: 10, background: p.badge, color: '#fff', borderRadius: 6, padding: '1px 6px' }}>
          {p.label}
        </span>
      </div>
      <div style={{ fontSize: 10, color: '#8b98b8' }}>{data.node.kind}</div>
      <Handle type="target" position={Position.Top} />
      <Handle type="source" position={Position.Bottom} />
    </div>
  );
}

function EntityNode({ data }: { data: { node: ModelNode } }) {
  return (
    <div
      style={{
        borderRadius: 10,
        background: '#16213b',
        border: '1.5px solid #5eead4',
        color: '#e6edf7',
        fontSize: 12,
        width: 190,
        overflow: 'hidden',
      }}
    >
      <div style={{ padding: '8px 12px', fontWeight: 700, background: '#0f766e' }}>{data.node.label}</div>
      {(data.node.fields ?? []).map((f) => (
        <div key={f.name} style={{ padding: '3px 12px', display: 'flex', justifyContent: 'space-between', borderTop: '1px solid #1f2c4a' }}>
          <span>
            {f.key === 'pk' ? '🔑 ' : ''}
            {f.name}
          </span>
          <span style={{ color: '#8b98b8' }}>
            {f.type}
            {f.key ? ` (${f.key})` : ''}
          </span>
        </div>
      ))}
      <Handle type="target" position={Position.Top} />
      <Handle type="source" position={Position.Bottom} />
    </div>
  );
}

const nodeTypes = { arch: ArchNode, entity: EntityNode };

type Tab = 'architecture' | 'er' | 'sequence' | 'stress';

const TABS: { id: Tab; label: string }[] = [
  { id: 'architecture', label: 'Architecture' },
  { id: 'sequence', label: 'Sequence' },
  { id: 'er', label: 'ER' },
  { id: 'stress', label: 'Stress (39 nodes)' },
];

async function fonts(): Promise<Uint8Array[]> {
  const [a, b] = await Promise.all([fetch('/fonts/inter-400.woff2'), fetch('/fonts/inter-600.woff2')]);
  return [new Uint8Array(await a.arrayBuffer()), new Uint8Array(await b.arrayBuffer())];
}

export default function ProbeAPage() {
  const [tab, setTab] = useState<Tab>('architecture');
  const [flow, setFlow] = useState<{ nodes: FlowNode[]; edges: FlowEdge[] }>({ nodes: [], edges: [] });
  const [error, setError] = useState<string | null>(null);

  const stress = useMemo(() => validateModel(stressRaw), []);

  useEffect(() => {
    void ensureResvg(fetch('/resvg/index_bg.wasm').then((r) => r.arrayBuffer()));
  }, []);

  useEffect(() => {
    let cancelled = false;
    const model: SystemModel | null =
      tab === 'stress' ? (stress.ok ? stress.model : null) : validFullModel;
    const viewId = tab === 'architecture' ? 'view.architecture' : tab === 'er' ? 'view.er' : 'view.stress';
    if (!model) {
      setError('stress fixture failed validation');
      return;
    }
    setError(null);
    layoutModel(model, viewId)
      .then((r) => {
        if (cancelled) return;
        const view = model.views.find((v) => v.id === viewId)!;
        setFlow({
          nodes: r.nodes.map((n) => {
            const modelNode = model.nodes.find((x) => x.id === n.id)!;
            return {
              id: n.id,
              position: { x: n.x, y: n.y },
              width: n.width,
              height: n.height,
              type: tab === 'er' ? 'entity' : 'arch',
              data: { node: modelNode },
            };
          }),
          edges: view.edges.map((eid) => {
            const e = model.edges.find((x) => x.id === eid)!;
            return {
              id: eid,
              source: e.from,
              target: e.to,
              label: e.label ?? undefined,
              animated: e.type === 'async',
              style: {
                stroke: e.provenance === 'proposed' ? '#a78bfa' : '#3b4763',
                strokeDasharray: e.provenance === 'proposed' ? '6 4' : undefined,
              },
            };
          }),
        });
      })
      .catch((err: unknown) => !cancelled && setError(String(err)));
    return () => {
      cancelled = true;
    };
  }, [tab, stress]);

  const seqSvg = tab === 'sequence' ? sequenceSvg(validFullModel, 'view.sequence') : null;

  const exportPng = async () => {
    if (seqSvg) {
      const png = await renderPng(seqSvg, await fonts());
      const url = URL.createObjectURL(new Blob([png as BlobPart], { type: 'image/png' }));
      const a = document.createElement('a');
      a.href = url;
      a.download = 'archwoven-sequence.png';
      a.click();
      URL.revokeObjectURL(url);
    }
  };

  return (
    <main style={{ padding: '1rem 2rem', height: '100vh', display: 'flex', flexDirection: 'column', gap: 12 }}>
      <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
        <h1 style={{ fontSize: '1.1rem', margin: 0, marginRight: 16 }}>Probe A — rendering</h1>
        {TABS.map((t) => (
          <button
            key={t.id}
            onClick={() => setTab(t.id)}
            style={{
              padding: '6px 14px',
              borderRadius: 8,
              border: tab === t.id ? '1.5px solid #5eead4' : '1px solid #3b4763',
              background: tab === t.id ? '#0f766e' : 'transparent',
              color: '#e6edf7',
              cursor: 'pointer',
            }}
          >
            {t.label}
          </button>
        ))}
        {seqSvg && (
          <button onClick={() => void exportPng()} style={{ marginLeft: 'auto', padding: '6px 14px', borderRadius: 8, border: 'none', background: '#6366f1', color: '#fff', cursor: 'pointer' }}>
            Export PNG
          </button>
        )}
      </div>
      {error && <div style={{ color: '#f87171' }}>{error}</div>}
      <div style={{ flex: 1, borderRadius: 12, overflow: 'hidden', border: '1px solid #1f2c4a', background: '#0d1526' }}>
        {seqSvg ? (
          <div style={{ padding: 16, overflow: 'auto', height: '100%' }} dangerouslySetInnerHTML={{ __html: seqSvg }} />
        ) : (
          <ReactFlow nodes={flow.nodes} edges={flow.edges} nodeTypes={nodeTypes} fitView proOptions={{ hideAttribution: false }}>
            <Background color="#1f2c4a" gap={24} />
            <Controls />
          </ReactFlow>
        )}
      </div>
    </main>
  );
}
