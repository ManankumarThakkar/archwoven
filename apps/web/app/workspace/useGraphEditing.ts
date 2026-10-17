'use client';
import { useRef, useState, type Dispatch, type SetStateAction, type RefObject } from 'react';
import { applyNodeChanges, type Node, type Edge, type NodeChange } from '@xyflow/react';
import type { SystemModel } from '@archwoven/model';
import type { LayoutResult } from '../../lib/layout';
import type { Point } from '../../lib/direct-edit';
import { manualLayout, dragLayout } from '../../lib/manual-layout';
import { graphScene } from '../../lib/graph-geometry';
export type GraphPlacement = {
    key: string;
    nodes: Node[];
    edges: Edge[];
    bounds: {
        x: number;
        y: number;
        width: number;
        height: number;
    };
    warnings?: string[];
};
export function useGraphEditing({ model, viewId, placed, setPlaced, layout, busy, onMove }: {
    model: SystemModel;
    viewId: string;
    placed: GraphPlacement;
    setPlaced: Dispatch<SetStateAction<GraphPlacement>>;
    layout: RefObject<LayoutResult | null>;
    busy: boolean;
    onMove?: (positions: Record<string, Point>) => Promise<boolean>;
}) {
    const snapshot = useRef<GraphPlacement | null>(null), pending = useRef(false), [saving, setSaving] = useState(false);
    const positions = (overrides: Record<string, Point>) => Object.fromEntries(placed.nodes.filter(n => n.type !== 'boundary').map(n => [n.id, Object.hasOwn(overrides, n.id) ? overrides[n.id]! : n.position]));
    const preview = (next: Record<string, Point>, lightweight = false) => {
        const view = model.views.find(v => v.id === viewId);
        if (!layout.current || !view)
            return;
        const draft = { ...model, layout: { ...model.layout, ...next } }, routed = (lightweight ? dragLayout : manualLayout)(draft, view, layout.current), scene = graphScene(draft, routed), routesById = new Map(routed.edges.map(route => [route.id, route]));
        setPlaced(current => ({ ...current, bounds: scene.bounds, warnings: scene.warnings, nodes: [
                ...scene.boundaries.map(box => ({
                    id: `bnd:${box.id}`, type: 'boundary', position: { x: box.x, y: box.y },
                    data: { label: box.label, lines: box.lines }, style: { width: box.width, height: box.height },
                    draggable: false, selectable: false, zIndex: -1,
                })),
                ...current.nodes.filter(node => node.type !== 'boundary').map(node =>
                    Object.hasOwn(next, node.id) ? { ...node, position: next[node.id]! } : node),
            ], edges: current.edges.map(edge => ({ ...edge, data: { ...edge.data, route: routesById.get(edge.id) } })) }));
    };
    const save = async (next: Record<string, Point>) => {
        if (!onMove || busy || pending.current)
            return;
        const backup = snapshot.current ?? placed;
        pending.current = true;
        setSaving(true);
        preview(next);
        let accepted = false;
        try {
            accepted = await onMove(next);
        }
        catch { /* Parent transport errors restore the last accepted layout. */ }
        finally {
            if (!accepted)
                setPlaced(current => current.key === backup.key ? backup : current);
            snapshot.current = null;
            pending.current = false;
            setSaving(false);
        }
    };
    return {
        nodesDraggable: !!onMove && !busy && !saving,
        onNodesChange: (changes: NodeChange[]) => {
            const moved = changes.filter((change): change is Extract<NodeChange, {
                type: 'position';
            }> => change.type === 'position' && !!change.position && placed.nodes.some(n => n.id === change.id && n.type !== 'boundary'));
            const cosmetic = changes.filter(change => change.type === 'select' || change.type === 'dimensions');
            if (cosmetic.length)
                setPlaced(current => ({ ...current, nodes: applyNodeChanges(cosmetic, current.nodes) }));
            if (!moved.length || !onMove || busy || pending.current)
                return;
            const next = positions(Object.fromEntries(moved.map(change => [change.id, change.position!])));
            if (snapshot.current || moved.some(change => change.type === 'position' && change.dragging)) {
                snapshot.current ??= placed;
                preview(next, true);
            }
            else
                void save(next); // React Flow keyboard nudges have no drag-start/stop pair.
        },
        onNodeDragStart: () => {
            if (!busy && !pending.current)
                snapshot.current = placed;
        },
        onNodeDragStop: async (_event: unknown, node: Node) => { await save(positions({ [node.id]: node.position })); },
    };
}
