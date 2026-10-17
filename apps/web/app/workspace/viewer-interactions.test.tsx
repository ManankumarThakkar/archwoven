// @vitest-environment happy-dom
import React, { act, useState } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Edge, Node, NodeChange } from '@xyflow/react';
import { validFullModel, type SystemModel } from '@archwoven/model';
import { Canvas } from './Canvas';
import { NodeFinder } from './NodeFinder';
import * as manualRouting from '../../lib/manual-layout';

const camera = vi.hoisted(() => ({ requests: [] as { bounds?: { x: number; y: number; width: number; height: number }; options: { nodes?: { id: string }[]; duration?: number }; ids: string[] }[], ids: [] as string[] }));
const flow = vi.hoisted(() => ({ events: null as unknown as {onNodesChange:(changes:NodeChange[])=>void;onNodeDragStart:(event:unknown,node:Node)=>void;onNodeDragStop:(event:unknown,node:Node)=>Promise<void>;nodesDraggable:boolean;deleteKeyCode?:string|null} }));

// Layout and React Flow own geometry, which is unavailable in a DOM simulator.
// Keep Canvas, finder, outline, selection state, effects and DOM events real.
vi.mock('../../lib/layout', () => ({
  layoutModel: async (model: SystemModel, viewId: string) => ({
    width: 800, height: 600,
    nodes: model.nodes.filter((n) => model.views.find((v) => v.id === viewId)?.nodes.includes(n.id)).map((n, i) => ({ id: n.id, x: i * 200, y: 0, width: 150, height: 80 })),
    edges: model.edges.filter(e => model.views.find(v => v.id === viewId)?.edges.includes(e.id)).map(e => ({ id: e.id, points: [{ x: 1, y: 2 }, { x: 3, y: 4 }] })),
  }),
}));
vi.mock('@xyflow/react', async (importOriginal) => ({
  Position: (await importOriginal<typeof import('@xyflow/react')>()).Position,
  applyNodeChanges: (await importOriginal<typeof import('@xyflow/react')>()).applyNodeChanges,
  ReactFlow: ({ nodes, edges, onNodeClick, onEdgeClick, onInit, colorMode, children, ...events }: {
    nodes: Node[]; edges: Edge[]; onNodeClick: (e: unknown, n: Node) => void;
    onEdgeClick: (e: unknown, edge: Edge) => void;
    onInit: (instance: unknown) => void; colorMode?: string; children: React.ReactNode;
  } & typeof flow.events) => {
    flow.events=events;
    camera.ids = nodes.map((n) => n.id);
    React.useEffect(() => { onInit({ fitBounds: (bounds: { x: number; y: number; width: number; height: number }, options: { duration?: number }) => {
      camera.requests.push({ bounds, options, ids: [...camera.ids] }); return Promise.resolve(true);
    }, fitView: (options: { nodes?: { id: string }[]; duration?: number }) => {
      camera.requests.push({ options, ids: [...camera.ids] });
      return Promise.resolve(true);
    } }); }, []);
    return <div data-flow-theme={colorMode}>
    {nodes.map((n) => <button key={n.id} data-node={n.id} data-position={JSON.stringify(n.position)} data-node-type={n.type} data-inline-shadow={n.style?.boxShadow} data-source-position={n.sourcePosition} data-target-position={n.targetPosition} data-inside={(n.data as { inside?: string })?.inside ?? ''} data-has-detail={String(!!(n.data as { hasDetail?: boolean })?.hasDetail)} className={n.className} onClick={() => onNodeClick(null, n)}>{n.id}</button>)}
    {edges.map((e) => <button key={e.id} data-edge={e.id} data-edge-type={e.type} data-route={JSON.stringify(e.data?.route)} title={String(e.label ?? '')} data-start={typeof e.markerStart === 'string' ? e.markerStart : ''} data-end={typeof e.markerEnd === 'string' ? e.markerEnd : ''} className={e.className} data-animated={String(e.animated)} onClick={() => onEdgeClick(null, e)}>{e.id}</button>)}
    {children}
  </div>;
  },
  Background: () => null, Controls: ({ children }: { children: React.ReactNode }) => <div>{children}</div>, ControlButton: ({ onClick }: { onClick: () => void }) => <button onClick={onClick}>Fit View</button>, MiniMap: () => null,
}));

const model: SystemModel = {
  schemaVersion: '1', revision: 1, title: 'Viewer interactions', requirements: [], openQuestions: [],
  nodes: [
    { id: 'a', kind: 'service', label: 'API', provenance: 'user-specified', evidence: [] },
    { id: 'b', kind: 'queue', label: 'Queue', provenance: 'inferred', evidence: [] },
    { id: 'c', kind: 'datastore', label: 'Storage', provenance: 'source-supported', evidence: [] },
  ],
  edges: [
    { id: 'ab', from: 'a', to: 'b', type: 'sync', provenance: 'user-specified', evidence: [] },
    { id: 'bc', from: 'b', to: 'c', type: 'async', provenance: 'inferred', evidence: [] },
  ],
  views: [{ id: 'v', type: 'architecture', nodes: ['a', 'b', 'c'], edges: ['ab', 'bc'] }],
  boundaries: [], guidedViews: [], privacy: { classification: 'public', boundary: 'external-allowed' },
};

let root: Root;
let host: HTMLDivElement;
beforeEach(() => {
  camera.requests = [];
  camera.ids = [];
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true, React });
  history.replaceState(null, '', '/workspace');
  localStorage.clear();
  host = document.createElement('div');
  document.body.append(host);
  root = createRoot(host);
});
afterEach(async () => {
  await act(async () => root.unmount());
  vi.useRealTimers();
  host.remove();
  vi.restoreAllMocks();
});
async function renderCanvas() {
  function Workspace() {
    const [selected, setSelected] = useState<string | null>(null);
    return <><output aria-label="Inspector selection">{selected ?? 'none'}</output>
      <Canvas model={model} modelId="m" viewId="v" onSelect={setSelected} onDeselect={() => setSelected(null)} />
    </>;
  }
  await act(async () => root.render(<Workspace />));
}

describe('persisted graph dragging',()=>{
  it('uses lightweight geometry during pointer movement and routes on completion',async()=>{
    const save=vi.fn(async(_positions:unknown)=>true),routing=vi.spyOn(manualRouting,'manualLayout');
    await act(async()=>root.render(<Canvas model={model} modelId="m" viewId="v" onSelect={()=>{}} onDeselect={()=>{}} onMove={save}/>));
    routing.mockClear();const node={id:'a',position:{x:30,y:100}} as Node;
    await act(async()=>{flow.events.onNodeDragStart(null,node);flow.events.onNodesChange([{type:'position',id:'a',position:node.position,dragging:true}]);});
    expect(routing).not.toHaveBeenCalled();expect(host.querySelector('[data-node="a"]')!.getAttribute('data-position')).toBe(JSON.stringify(node.position));
    await act(async()=>{await flow.events.onNodeDragStop(null,node);});expect(routing).toHaveBeenCalledOnce();
  });
  it('preserves the viewport after a saved move and keeps explicit Fit View available',async()=>{
    function Editable(){const [current,setCurrent]=useState(model);return <Canvas model={current} modelId="m" viewId="v" onSelect={()=>{}} onDeselect={()=>{}} onMove={async positions=>{setCurrent({...current,revision:current.revision+1,layout:positions});return true;}}/>;}
    await act(async()=>root.render(<Editable/>));camera.requests=[];const node={id:'a',position:{x:30,y:100}} as Node;
    await act(async()=>{flow.events.onNodeDragStart(null,node);await flow.events.onNodeDragStop(null,node);});
    expect(camera.requests).toHaveLength(0);await click(button('Fit View'));expect(camera.requests).toHaveLength(1);
  });
  it.each([true,false])('ignores implicit deletion events even when busy=%s',async busy=>{
    const save=vi.fn(async(_positions:unknown)=>true);
    await act(async()=>root.render(<Canvas model={model} modelId="m" viewId="v" onSelect={()=>{}} onDeselect={()=>{}} onMove={save} busy={busy}/>));
    await act(async()=>flow.events.onNodesChange([{type:'remove',id:'a'}]));
    expect(host.querySelector('[data-node="a"]')).toBeTruthy();expect(save).not.toHaveBeenCalled();expect(flow.events.deleteKeyCode).toBeNull();
  });
  it.each([true,false])('saves all visible positions and rolls back a failed save (%s)',async accepted=>{
    const save=vi.fn(async(_positions:unknown)=>accepted);
    await act(async()=>root.render(<Canvas model={model} modelId="m" viewId="v" onSelect={()=>{}} onDeselect={()=>{}} onMove={save}/>));
    const node={id:'a',position:{x:40,y:130}} as Node;
    await act(async()=>{flow.events.onNodeDragStart(null,node);flow.events.onNodesChange([{type:'position',id:'a',position:node.position,dragging:true}]);});
    expect(host.querySelector('[data-node="a"]')!.getAttribute('data-position')).toBe(JSON.stringify(node.position));
    await act(async()=>{await flow.events.onNodeDragStop(null,node);});
    expect(save).toHaveBeenCalledTimes(1);expect(save.mock.calls[0]![0]).toEqual({a:{x:40,y:130},b:{x:200,y:0},c:{x:400,y:0}});
    expect(host.querySelector('[data-node="a"]')!.getAttribute('data-position')).toBe(JSON.stringify(accepted?node.position:{x:0,y:0}));
  });
  it('persists keyboard position changes and disables movement while busy',async()=>{
    const save=vi.fn(async(_positions:unknown)=>true);
    const show=async(busy:boolean)=>act(async()=>root.render(<Canvas model={model} modelId="m" viewId="v" onSelect={()=>{}} onDeselect={()=>{}} onMove={save} busy={busy}/>));
    await show(false);await act(async()=>flow.events.onNodesChange([{type:'position',id:'a',position:{x:10,y:0},dragging:false}]));
    expect(save).toHaveBeenCalledOnce();await show(true);expect(flow.events.nodesDraggable).toBe(false);
  });
  it('preserves positions for node ids that shadow object prototype names',async()=>{
    const named={...model,nodes:[...model.nodes,{...model.nodes[0]!,id:'constructor'}],views:[{...model.views[0]!,nodes:['a','b','c','constructor']}]};
    const save=vi.fn(async(_positions:unknown)=>true);
    await act(async()=>root.render(<Canvas model={named} modelId="m" viewId="v" onSelect={()=>{}} onDeselect={()=>{}} onMove={save}/>));
    const node={id:'a',position:{x:20,y:30}} as Node;
    await act(async()=>{flow.events.onNodeDragStart(null,node);await flow.events.onNodeDragStop(null,node);});
    expect((save.mock.calls[0]![0] as Record<string,unknown>)['constructor']).toEqual({x:600,y:0});
  });
});
async function click(el: Element | null) {
  expect(el).toBeTruthy();
  await act(async () => (el as HTMLElement).click());
}
function button(text: string) { return [...host.querySelectorAll('button')].find((b) => b.textContent === text)!; }
async function key(el: Element, value: string) {
  await act(async () => el.dispatchEvent(new KeyboardEvent('keydown', { key: value, bubbles: true })));
}
async function select(label: string, value: string) {
  const el = host.querySelector<HTMLSelectElement>(`[aria-label="${label}"]`)!;
  await act(async () => { el.value = value; el.dispatchEvent(new Event('change', { bubbles: true })); });
}

const multiviewModel: SystemModel = {
  ...model,
  nodes: [...model.nodes, { id: 'entity', kind: 'entity', label: 'Record', provenance: 'user-specified', evidence: [] }],
  views: [...model.views,
    { id: 'er', type: 'er', nodes: ['entity'], edges: [] },
    { id: 'compatible', type: 'component-detail', nodes: ['a', 'b'], edges: ['ab'] },
  ],
  guidedViews: [{ id: 'happy', label: 'Happy path', focus: ['a', 'b'], note: 'Follow the request' }],
};
function SwitchingWorkspace({ viewId }: { viewId: string }) {
  const [selected, setSelected] = useState<string | null>(null);
  return <><output aria-label="Inspector selection">{selected ?? 'none'}</output>
    <Canvas model={multiviewModel} modelId="m" viewId={viewId} onSelect={setSelected} onDeselect={() => setSelected(null)} />
  </>;
}
async function renderView(viewId: string) {
  await act(async () => root.render(<SwitchingWorkspace viewId={viewId} />));
}

describe('Canvas view transitions', () => {
  it.each([
    ['LR', 'right', 'left'],
    ['TB', 'bottom', 'top'],
    [undefined, 'bottom', 'top'],
  ] as const)('places connection handles along the %s layout direction', async (orientation, source, target) => {
    const directed: SystemModel = { ...model, views: [{ ...model.views[0]!, orientation }] };
    await act(async () => root.render(<Canvas model={directed} modelId="m" viewId="v" onSelect={() => {}} onDeselect={() => {}} />));
    const nodes = host.querySelectorAll('[data-node]');
    expect(nodes).toHaveLength(3);
    for (const node of nodes) {
      expect(node.getAttribute('data-source-position')).toBe(source);
      expect(node.getAttribute('data-target-position')).toBe(target);
    }
  });

  it('fits each newly placed view after its nodes render and uses the dark viewer theme', async () => {
    await renderView('v');
    camera.requests = [];
    await renderView('er');
    expect(camera.requests).toHaveLength(1);
    expect(camera.requests[0]?.ids).toEqual(['entity']);
    await renderView('v');
    expect(camera.requests).toHaveLength(2);
    expect(camera.requests[1]?.ids).toEqual(['a', 'b', 'c']);
    expect(host.querySelector('[data-flow-theme]')?.getAttribute('data-flow-theme')).toBe('dark');
  });

  it('fits the complete routed scene initially and when Fit View is pressed', async () => {
    await renderView('v');
    expect(camera.requests.at(-1)?.bounds).toMatchObject({ x: -8, y: -8, width: 808, height: 608 });
    camera.requests = [];
    await click(button('Fit View'));
    expect(camera.requests).toHaveLength(1);
    expect(camera.requests[0]?.bounds).toMatchObject({ x: -8, y: -8, width: 808, height: 608 });
  });

  it('fits a replacement revision without refitting for focus, route steps or motion toggles', async () => {
    let current = multiviewModel;
    const show = async () => act(async () => root.render(<Canvas model={current} modelId="m" viewId="v" onSelect={() => {}} onDeselect={() => {}} />));
    await show();
    camera.requests = [];
    vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval'] });
    await click(host.querySelector('[data-node="a"]'));
    await select('route from', 'a');
    await select('route to', 'b');
    await click(button('▶ probe'));
    await act(async () => vi.advanceTimersByTimeAsync(1100));
    expect(host.querySelector('[data-node="b"]')?.className).toBe('aw-route-current');
    await click(button('◉ motion'));
    expect(camera.requests).toHaveLength(0);
    current = { ...multiviewModel, revision: 2 };
    await show();
    expect(camera.requests).toHaveLength(1);
    expect(camera.requests[0]?.ids).toEqual(['a', 'b', 'c']);
    expect(camera.requests[0]?.options.duration).toBe(0);
  });

  it('fits an active chapter subset after a new layout and leaves its camera still on motion changes', async () => {
    history.replaceState(null, '', '#chapter=happy');
    await renderView('v');
    expect(camera.requests.at(-1)?.options.nodes).toEqual([{ id: 'a' }, { id: 'b' }]);
    camera.requests = [];
    await renderView('compatible');
    expect(camera.requests).toHaveLength(1);
    expect(camera.requests[0]?.ids).toEqual(['a', 'b']);
    expect(camera.requests[0]?.options.nodes).toEqual([{ id: 'a' }, { id: 'b' }]);
    await click(button('◉ motion'));
    expect(camera.requests).toHaveLength(1);
  });

  it('clears invalid focus, lens, chapter and route endpoints on an explicit switch', async () => {
    history.replaceState(null, '', '#model=m&view=v&lens=service&chapter=happy&note=keep%2Cencoded');
    await renderView('v');
    await click(host.querySelector('[data-node="a"]'));
    await select('route from', 'a');
    await select('route to', 'b');
    expect(host.querySelector('output')?.textContent).toBe('a');
    history.replaceState(null, '', location.hash + '&view=er');
    await renderView('er');
    expect(host.querySelector('[data-node="entity"]')?.className).toBe('');
    expect(host.querySelector('output')?.textContent).toBe('none');
    expect((host.querySelector('[aria-label="route from"]') as HTMLSelectElement).value).toBe('');
    expect((host.querySelector('[aria-label="route to"]') as HTMLSelectElement).value).toBe('');
    expect(button('▶ probe').disabled).toBe(true);
    expect(button('⤓ share')).toBeUndefined();
    expect((host.querySelector('[aria-label="chapter"]') as HTMLSelectElement).value).toBe('-1');
    const hash = new URLSearchParams(location.hash.slice(1));
    expect(hash.get('focus')).toBeNull();
    expect(hash.get('lens')).toBeNull();
    expect(hash.get('chapter')).toBeNull();
    expect(hash.get('model')).toBe('m');
    expect(hash.get('view')).toBe('er');
    expect(location.hash).toContain('note=keep%2Cencoded');
  });

  it('stops incompatible playback and clears a relationship inspector when switching views', async () => {
    await renderView('v');
    await select('route from', 'a');
    await select('route to', 'b');
    await click(button('▶ probe'));
    await click(host.querySelector('[data-edge="bc"]'));
    expect(host.querySelector('output')?.textContent).toBe('bc');
    await renderView('er');
    expect(host.querySelector('output')?.textContent).toBe('none');
    expect(button('clear')).toBeUndefined();
    expect(button('▶ probe').disabled).toBe(true);
    expect(button('⤓ share')).toBeUndefined();
    const hash = new URLSearchParams(location.hash.slice(1));
    expect(hash.get('relation')).toBeNull();
    expect(hash.get('route')).toBeNull();
  });

  it('preserves compatible focus, lens, chapter and route endpoints across views', async () => {
    history.replaceState(null, '', '#model=m&focus=a&lens=service&chapter=happy');
    await renderView('v');
    await click(host.querySelector('[data-node="a"]'));
    await select('route from', 'a');
    await select('route to', 'b');
    await renderView('compatible');
    expect(host.querySelector('[data-node="a"]')?.className).toBe('aw-route-current');
    expect(host.querySelector('output')?.textContent).toBe('a');
    expect(button('service').getAttribute('aria-pressed')).toBe('true');
    expect((host.querySelector('[aria-label="route from"]') as HTMLSelectElement).value).toBe('a');
    expect((host.querySelector('[aria-label="route to"]') as HTMLSelectElement).value).toBe('b');
    expect(button('▶ probe').disabled).toBe(false);
    expect((host.querySelector('[aria-label="chapter"]') as HTMLSelectElement).value).toBe('0');
  });

  it('preserves playback and relationship selection when the entire route remains in the new view', async () => {
    await renderView('v');
    await select('route from', 'a');
    await select('route to', 'b');
    await click(button('▶ probe'));
    await click(host.querySelector('[data-edge="ab"]'));
    await renderView('compatible');
    expect(host.querySelector('output')?.textContent).toBe('ab');
    expect(button('clear')).toBeDefined();
    const hash = new URLSearchParams(location.hash.slice(1));
    expect(hash.get('route')).toBe('a~b');
    expect(hash.get('relation')).toBe('ab');
  });

  it('drops only lens kinds absent from the destination view', async () => {
    history.replaceState(null, '', '#lens=service,datastore');
    await renderView('v');
    await renderView('compatible');
    expect(button('service').getAttribute('aria-pressed')).toBe('true');
    expect(new URLSearchParams(location.hash.slice(1)).get('lens')).toBe('service');
  });

  it('restores the full initial permalink without treating mount as a view switch', async () => {
    localStorage.setItem('archwoven-motion', 'still');
    history.replaceState(null, '', '#model=m&view=v&focus=a&lens=service,queue&route=a~b&chapter=happy&note=keep%2Cencoded');
    await renderView('v');
    const hash = new URLSearchParams(location.hash.slice(1));
    for (const [key, value] of [['focus', 'a'], ['lens', 'service,queue'], ['route', 'a~b'], ['chapter', 'happy'], ['model', 'm'], ['view', 'v']]) {
      expect(hash.get(key!)).toBe(value);
    }
    expect(button('service').getAttribute('aria-pressed')).toBe('true');
    expect(button('queue').getAttribute('aria-pressed')).toBe('true');
    expect(button('clear')).toBeDefined();
    expect((host.querySelector('[aria-label="chapter"]') as HTMLSelectElement).value).toBe('0');
    expect(location.hash).toContain('note=keep%2Cencoded');
  });
});

describe('Canvas interaction state', () => {
  it('opens the finder from its touch-accessible toolbar button', async () => {
    await renderCanvas();
    await click(button('Find node /'));
    expect(host.querySelector('[role="dialog"][aria-label="Node finder"]')).not.toBeNull();
    expect(document.activeElement).toBe(host.querySelector('[aria-label="Find node"]'));
    await click([...host.querySelectorAll('.aw-finder-item')].find((b) => b.textContent?.includes('Queue'))!);
    expect(host.querySelector('[data-node="b"]')?.className).toBe('aw-route-current');
    expect(host.querySelector('[role="dialog"]')).toBeNull();
  });

  it('restores focus outside the saved lens visibly and removes only the incompatible lens', async () => {
    history.replaceState(null, '', '#model=saved-model&focus=b&lens=service&note=keep%2Cencoded');
    await renderCanvas();
    expect(host.querySelector('[data-node="b"]')?.className).toBe('aw-route-current');
    expect(button('service').getAttribute('aria-pressed')).toBe('false');
    const hash = new URLSearchParams(location.hash.slice(1));
    expect(hash.get('lens')).toBeNull();
    expect(hash.get('focus')).toBe('b');
    expect(hash.get('model')).toBe('saved-model');
    expect(location.hash).toContain('note=keep%2Cencoded');
  });

  it.each([['a', 'service'], ['b', 'service,queue']])('preserves compatible restored focus %s and lens %s', async (focus, lens) => {
    history.replaceState(null, '', `#model=saved-model&focus=${focus}&lens=${lens}`);
    await renderCanvas();
    expect(host.querySelector(`[data-node="${focus}"]`)?.className).toBe('aw-route-current');
    const hash = new URLSearchParams(location.hash.slice(1));
    expect(hash.get('focus')).toBe(focus);
    expect(hash.get('lens')).toBe(lens);
    expect(hash.get('model')).toBe('saved-model');
    for (const kind of lens!.split(',')) expect(button(kind).getAttribute('aria-pressed')).toBe('true');
  });

  it.each(['outline', 'finder'] as const)('focusing outside the lens through %s reveals the node and reconciles controls/hash', async (via) => {
    history.replaceState(null, '', '#lens=service');
    await renderCanvas();
    expect(host.querySelector('[data-node="b"]')?.className).toBe('aw-dim');
    if (via === 'outline') await click(host.querySelector('.aw-outline-rail button:nth-of-type(2)'));
    else {
      await key(document.body, '/');
      await click([...host.querySelectorAll('.aw-finder-item')].find((b) => b.textContent?.includes('Queue'))!);
    }
    expect(host.querySelector('[data-node="b"]')?.className).toBe('aw-route-current');
    expect(button('service').getAttribute('aria-pressed')).toBe('false');
    expect(new URLSearchParams(location.hash.slice(1)).get('lens')).toBeNull();
    expect(new URLSearchParams(location.hash.slice(1)).get('focus')).toBe('b');
    expect(host.querySelector('output')?.textContent).toBe('b');
  });

  it('keeps a compatible lens when focusing a matching node', async () => {
    history.replaceState(null, '', '#lens=service');
    await renderCanvas();
    await click(host.querySelector('[data-node="a"]'));
    expect(button('service').getAttribute('aria-pressed')).toBe('true');
    expect(new URLSearchParams(location.hash.slice(1)).get('lens')).toBe('service');
  });

  it('focusing from the outline stops an active route so the chosen node is visible', async () => {
    await renderCanvas();
    await select('route from', 'a');
    await select('route to', 'b');
    await click(button('▶ probe'));
    await click(host.querySelector('.aw-outline-rail button:nth-of-type(3)'));
    expect(host.querySelector('[data-node="c"]')?.className).toBe('aw-route-current');
    expect(new URLSearchParams(location.hash.slice(1)).get('route')).toBeNull();
    expect(host.querySelector('[aria-label="route from"]')?.hasAttribute('disabled')).toBe(false);
  });

  it.each(['motion', 'still'] as const)('starting a route in %s clears stale relationship selection, inspector and hash', async (motion) => {
    localStorage.setItem('archwoven-motion', motion);
    await renderCanvas();
    await click(host.querySelector('[data-edge="bc"]'));
    expect(host.querySelector('output')?.textContent).toBe('bc');
    await select('route from', 'a');
    await select('route to', 'b');
    await click(button('▶ probe'));
    expect(host.querySelector('output')?.textContent).toBe('none');
    expect(new URLSearchParams(location.hash.slice(1)).get('relation')).toBeNull();
    expect(new URLSearchParams(location.hash.slice(1)).get('route')).toBe('a~b');
    expect(host.querySelector('[data-edge="bc"]')?.className).toBe('aw-dim-edge');
  });

  it('never animates a dimmed edge while a visible edge still pulses', async () => {
    await renderCanvas();
    await click(host.querySelector('[data-node="a"]'));
    const dim = host.querySelector('[data-edge="bc"]')!;
    expect(dim.classList.contains('aw-dim-edge')).toBe(true);
    expect(dim.classList.contains('aw-pulse')).toBe(false);
    expect(dim.getAttribute('data-animated')).toBe('false');
    expect(host.querySelector('[data-edge="ab"]')?.classList.contains('aw-pulse')).toBe(true);
  });

  it('does not animate edges whose endpoints are dimmed by the semantic lens', async () => {
    history.replaceState(null, '', '#lens=service');
    await renderCanvas();
    for (const edge of host.querySelectorAll('[data-edge]')) {
      expect(edge.classList.contains('aw-dim-edge')).toBe(true);
      expect(edge.classList.contains('aw-pulse')).toBe(false);
      expect(edge.getAttribute('data-animated')).toBe('false');
    }
  });

  it('Still mode has zero pulse classes and zero animated edges', async () => {
    await renderCanvas();
    await click(button('◉ motion'));
    expect(host.querySelectorAll('.aw-pulse')).toHaveLength(0);
    expect(host.querySelectorAll('[data-animated="true"]')).toHaveLength(0);
  });

  it('hash writes preserve encoded commas in unrelated keys while clearing invalid focus', async () => {
    history.replaceState(null, '', '#note=keep%2Cencoded&focus=a%2Cb&lens=service%2Cqueue');
    await renderCanvas();
    await click(host.querySelector('[data-edge="ab"]'));
    expect(location.hash).toContain('note=keep%2Cencoded');
    expect(location.hash).not.toContain('focus=');
    expect(location.hash).toContain('lens=service,queue');
  });
});

describe('NodeFinder keyboard visibility', () => {
  it('scrolls each active arrow result into view without moving input focus', async () => {
    const scroll = vi.fn();
    vi.spyOn(Element.prototype, 'scrollIntoView').mockImplementation(scroll);
    const many: SystemModel = { ...model, nodes: Array.from({ length: 40 }, (_, i) => ({
      id: `n${i}`, kind: 'service', label: `Node ${i}`, provenance: 'user-specified', evidence: [],
    })) };
    await act(async () => root.render(<NodeFinder model={many} viewNodes={many.nodes.map((n) => n.id)} onPick={() => {}} onClose={() => {}} />));
    const input = host.querySelector('input')!;
    scroll.mockClear();
    for (let i = 0; i < 25; i++) await key(input, 'ArrowDown');
    expect(host.querySelector('[aria-selected="true"]')?.textContent).toContain('n25');
    expect(scroll).toHaveBeenLastCalledWith({ block: 'nearest' });
    expect(scroll.mock.contexts.at(-1)).toBe(host.querySelector('[aria-selected="true"]'));
    expect(document.activeElement).toBe(input);
    await key(input, 'ArrowUp');
    expect((scroll.mock.contexts.at(-1) as Element)?.textContent).toContain('n24');
    expect(document.activeElement).toBe(input);
  });
});

describe('sequence workspace viewer', () => {
  const sequenceModel: SystemModel = { ...model, views: [{ id: 'sequence', type: 'sequence', nodes: ['a', 'b', 'c'], edges: ['ab', 'bc'], sequence: { participants: ['a', 'b', 'c'], messages: [
    { seq: 1, from: 'a', to: 'b', label: 'Enqueue work', kind: 'async' },
    { seq: 2, from: 'b', to: 'b', label: 'Validate job', kind: 'call', fragment: { type: 'loop', covers: [2] } },
    { seq: 3, from: 'b', to: 'a', label: 'Accepted', kind: 'return' },
  ] } }] };
  const show = async (current = sequenceModel) => act(async () => root.render(<Canvas model={current} modelId="sequence-model" viewId="sequence" onSelect={selected} onDeselect={deselected} />));
  const selected = vi.fn(), deselected = vi.fn();
  beforeEach(() => { selected.mockClear(); deselected.mockClear(); });
  it('uses lifelines and ordered messages with a readable text alternative, without graph controls', async () => {
    await show();
    expect(host.querySelectorAll('[data-lifeline]')).toHaveLength(3);
    expect(host.querySelectorAll('[data-message]')).toHaveLength(3);
    expect(host.querySelector('[data-self-call]')).toBeTruthy();
    expect(host.querySelector('[data-flow-theme]')).toBeNull();
    expect(host.querySelector('[aria-label="route from"]')).toBeNull();
    expect(host.querySelector('ol')?.textContent).toContain('API → Queue: Enqueue work');
    expect(host.querySelector('ol')?.textContent).toContain('return');
    expect(host.querySelector('[data-participant="b"]')?.textContent).toContain('inferred');
    expect(host.querySelector('button[aria-label="Inspect Storage"]')?.textContent).toContain('code');
  });
  it('supports participant inspection, permalink restoration and fit/zoom controls', async () => {
    history.replaceState(null, '', '/workspace#model=sequence-model&view=sequence&focus=b&route=a~b&lens=service');
    await show();
    expect(selected).toHaveBeenLastCalledWith('b');
    expect(window.location.hash).not.toContain('route=');
    expect(window.location.hash).not.toContain('lens=');
    await click(host.querySelector('button[aria-label="Inspect Storage"]'));
    expect(selected).toHaveBeenLastCalledWith('c');
    expect(window.location.hash).toContain('focus=c');
    await click(host.querySelector('button[aria-label="Zoom in timeline"]'));
    expect(host.querySelector('[aria-label="Timeline zoom"]')?.textContent).not.toBe('Fit');
    await click(button('Fit'));
    expect(host.querySelector('[aria-label="Timeline zoom"]')?.textContent).toBe('Fit');
  });
  it('shows an honest missing-timeline state for legacy views instead of a node graph', async () => {
    await show({ ...sequenceModel, views: [{ ...sequenceModel.views[0]!, sequence: null }] });
    expect(host.querySelector('[role="alert"]')?.textContent).toContain('no message timeline');
    expect(host.querySelector('[data-flow-theme]')).toBeNull();
  });
  it('clears an invisible sequence selection when returning to an architecture view', async () => {
    const mixed: SystemModel = { ...sequenceModel, views: [...sequenceModel.views, { id: 'architecture', type: 'architecture', nodes: ['a', 'b'], edges: ['ab'] }] };
    await show(mixed); await click(host.querySelector('button[aria-label="Inspect Storage"]'));
    deselected.mockClear();
    await act(async () => root.render(<Canvas model={mixed} modelId="sequence-model" viewId="architecture" onSelect={selected} onDeselect={deselected} />));
    expect(deselected).toHaveBeenCalled();
    expect(new URLSearchParams(window.location.hash.slice(1)).get('focus')).toBeNull();
  });
});

describe('ER workspace dispatch', () => {
  it('uses entity nodes and one/many relationship markers with explicit cardinality labels', async () => {
    await act(async () => root.render(<Canvas model={validFullModel} modelId="er-model" viewId="view.er" onSelect={() => {}} onDeselect={() => {}} />));
    expect(host.querySelectorAll('[data-node-type="entity"]')).toHaveLength(3);
    const oneMany = host.querySelector('[data-edge="er.user-order"]')!;
    expect(oneMany.getAttribute('title')).toContain('1:N');
    expect(oneMany.getAttribute('data-start')).toContain('er-one');
    expect(oneMany.getAttribute('data-end')).toContain('er-many');
    expect(host.querySelector('[data-edge="er.order-product"]')?.getAttribute('data-start')).toContain('er-many');
    await click(host.querySelector('[data-node="entity.user"]'));
    expect(host.querySelector('[data-node="entity.user"]')?.className).toBe('aw-route-current');
    expect(host.querySelector('[data-node="entity.user"]')?.getAttribute('data-inline-shadow')).toBeNull();
  });
});

describe('shared routed graph scene', () => {
  it('uses shared system nodes and sends the canonical routed section to the edge renderer', async () => {
    await renderCanvas();
    expect(host.querySelector('[data-node="a"]')?.getAttribute('data-node-type')).toBe('system');
    const edge = host.querySelector('[data-edge="ab"]')!;
    expect(edge.getAttribute('data-edge-type')).toBe('routed');
    expect(JSON.parse(edge.getAttribute('data-route')!).points).toEqual([{ x: 1, y: 2 }, { x: 3, y: 4 }]);
    expect(edge.getAttribute('data-end')).toContain('graph-arrow');
  });
});

describe('component detail focus', () => {
  const detailModel: SystemModel = { ...model, views: [...model.views, { id: 'detail:b', type: 'component-detail', focus: 'b', nodes: ['b', 'a', 'c'], edges: ['ab', 'bc'] }] };
  const mount = (m: SystemModel, viewId: string) => act(async () => root.render(<Canvas model={m} modelId="m" viewId={viewId} onSelect={() => {}} onDeselect={() => {}} />));

  it('outlines the focus component in its detail view only', async () => {
    await mount(detailModel, 'detail:b');
    expect(host.querySelector('[data-node="b"]')!.className).toBe('aw-detail-focus');
    expect(host.querySelector('[data-node="a"]')!.className).toBe('');
    await mount(detailModel, 'v');
    expect(host.querySelector('[data-node="b"]')!.className).toBe('');
  });

  it('does not outline the focus of a generated component-detail view', async () => {
    const generated: SystemModel = { ...model, views: [...model.views, { id: 'view.component', type: 'component-detail', focus: 'b', nodes: ['b', 'a'], edges: ['ab'] }] };
    await mount(generated, 'view.component');
    expect(host.querySelector('[data-node="b"]')!.className).toBe('');
  });
});

describe('view-scoped focus highlighting', () => {
  it('does not mark a component reachable through a connection the view does not show', async () => {
    const scoped: SystemModel = { ...model, views: [{ id: 'v', type: 'architecture', nodes: ['a', 'b', 'c'], edges: ['ab'] }] };
    await act(async () => root.render(<Canvas model={scoped} modelId="m" viewId="v" onSelect={() => {}} onDeselect={() => {}} />));
    await act(async () => (host.querySelector('[data-node="a"]') as HTMLButtonElement).click());
    expect(host.querySelector('[data-node="b"]')!.className).toBe('aw-reach');
    expect(host.querySelector('[data-node="c"]')!.className).toBe('aw-dim');
  });
});

describe('internals on the canvas', () => {
  const withInternals: SystemModel = {
    ...model,
    nodes: [...model.nodes, { id: 'b/x', kind: 'component', label: 'Part X', provenance: 'inferred', evidence: [], group: 'b' }, { id: 'b/y', kind: 'component', label: 'Part Y', provenance: 'inferred', evidence: [], group: 'b' }],
    edges: [...model.edges, { id: 'b/link-1', from: 'a', to: 'b/x', type: 'sync', provenance: 'inferred', evidence: [] }, { id: 'b/link-2', from: 'b/x', to: 'b/y', type: 'sync', provenance: 'inferred', evidence: [] }, { id: 'b/link-3', from: 'b/y', to: 'c', type: 'async', provenance: 'inferred', evidence: [] }],
    views: [...model.views, { id: 'detail:b', type: 'component-detail', focus: 'b', nodes: ['b/x', 'b/y', 'a', 'c'], edges: ['b/link-1', 'b/link-2', 'b/link-3'] }],
  };
  const mount = (viewId: string) => act(async () => root.render(<Canvas model={withInternals} modelId="m" viewId={viewId} onSelect={() => {}} onDeselect={() => {}} />));

  it('names the parent of each internal in its detail view', async () => {
    await mount('detail:b');
    expect(host.querySelector('[data-node="b/x"]')!.getAttribute('data-inside')).toBe('Queue');
    expect(host.querySelector('[data-node="a"]')!.getAttribute('data-inside')).toBe('');
  });

  it('marks the expanded component in the overview', async () => {
    await mount('v');
    expect(host.querySelector('[data-node="b"]')!.getAttribute('data-has-detail')).toBe('true');
    expect(host.querySelector('[data-node="a"]')!.getAttribute('data-has-detail')).toBe('false');
  });
});
