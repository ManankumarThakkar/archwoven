import { isDetailView, type SystemModel, type View } from '@archwoven/model';
import type { LayoutResult, PlacedNode, RoutedEdge } from './layout';
import { validPosition, type Point } from './direct-edit';
type Box = Point & {
    width: number;
    height: number;
};
const overlap = (a: Box, b: Box) => a.x < b.x + b.width && a.x + a.width > b.x && a.y < b.y + b.height && a.y + a.height > b.y;
const crosses = (a: Point, b: Point, box: Box) => a.x === b.x
    ? a.x > box.x && a.x < box.x + box.width && Math.max(a.y, b.y) > box.y && Math.min(a.y, b.y) < box.y + box.height
    : a.y > box.y && a.y < box.y + box.height && Math.max(a.x, b.x) > box.x && Math.min(a.x, b.x) < box.x + box.width;
const simplify = (points: Point[]) => points.filter((p, i) => !i || i === points.length - 1 || !((points[i - 1]!.x === p.x && p.x === points[i + 1]!.x) || (points[i - 1]!.y === p.y && p.y === points[i + 1]!.y)));
/** A bounded orthogonal visibility-grid search; coordinates, not pixel distances, bound work. */
function routeBetween(start: Point, end: Point, boxes: Box[], prior: Point[][], clearance: number, budget: {
    remaining: number;
}): Point[] | null {
    if (boxes.length > 80)
        return null;
    const xs = [...new Set([start.x, end.x, ...boxes.flatMap(b => [b.x - clearance, b.x + b.width + clearance])])].sort((a, b) => a - b);
    const ys = [...new Set([start.y, end.y, ...boxes.flatMap(b => [b.y - clearance, b.y + b.height + clearance])])].sort((a, b) => a - b);
    const point = (key: number): Point => ({ x: xs[Math.floor(key / ys.length)]!, y: ys[key % ys.length]! });
    const key = (p: Point) => xs.indexOf(p.x) * ys.length + ys.indexOf(p.y);
    const first = key(start) * 3, target = key(end), cost = new Map([[first, 0]]), prev = new Map<number, number>();
    const heap: {
        state: number;
        score: number;
        cost: number;
    }[] = [];
    const push = (item: typeof heap[number]) => {
        let i = heap.length;
        heap.push(item);
        while (i > 0) {
            const p = (i - 1) >> 1;
            if (heap[p]!.score <= item.score)
                break;
            heap[i] = heap[p]!;
            i = p;
        }
        heap[i] = item;
    };
    const pop = () => {
        const top = heap[0]!, tail = heap.pop()!;
        if (heap.length) {
            let i = 0;
            while (i * 2 + 1 < heap.length) {
                let c = i * 2 + 1;
                if (c + 1 < heap.length && heap[c + 1]!.score < heap[c]!.score)
                    c++;
                if (heap[c]!.score >= tail.score)
                    break;
                heap[i] = heap[c]!;
                i = c;
            }
            heap[i] = tail;
        }
        return top;
    };
    push({ state: first, score: 0, cost: 0 });
    let visits = 0;
    while (heap.length && visits++ < 20000 && budget.remaining > 0) {
        const current = pop();
        if (current.cost !== cost.get(current.state))
            continue;
        const cell = Math.floor(current.state / 3), direction = current.state % 3, a = point(cell);
        if (cell === target) {
            const result: Point[] = [];
            let state: number | undefined = current.state;
            while (state !== undefined) {
                result.push(point(Math.floor(state / 3)));
                state = prev.get(state);
            }
            return simplify(result.reverse());
        }
        const ix = Math.floor(cell / ys.length), iy = cell % ys.length;
        for (const [nx, ny, dir] of [[ix - 1, iy, 1], [ix + 1, iy, 1], [ix, iy - 1, 2], [ix, iy + 1, 2]]) {
            if (nx! < 0 || ny! < 0 || nx! >= xs.length || ny! >= ys.length)
                continue;
            const nextCell = nx! * ys.length + ny!, b = point(nextCell);
            budget.remaining -= boxes.length;
            if (budget.remaining <= 0)
                return null;
            if (boxes.some(box => crosses(a, b, box)))
                continue;
            let shared = 0;
            for (const route of prior)
                for (let i = 1; i < route.length; i++) {
                    if (--budget.remaining <= 0)
                        return null;
                    const p = route[i - 1]!, q = route[i]!;
                    if (a.x === b.x && p.x === q.x && a.x === p.x)
                        shared += Math.max(0, Math.min(Math.max(a.y, b.y), Math.max(p.y, q.y)) - Math.max(Math.min(a.y, b.y), Math.min(p.y, q.y)));
                    if (a.y === b.y && p.y === q.y && a.y === p.y)
                        shared += Math.max(0, Math.min(Math.max(a.x, b.x), Math.max(p.x, q.x)) - Math.max(Math.min(a.x, b.x), Math.min(p.x, q.x)));
                }
            const next = nextCell * 3 + dir!, g = current.cost + Math.abs(a.x - b.x) + Math.abs(a.y - b.y) + (direction && direction !== dir ? 12 : 0) + shared * 2;
            if (g >= (cost.get(next) ?? Infinity))
                continue;
            cost.set(next, g);
            prev.set(next, current.state);
            push({ state: next, cost: g, score: g + Math.abs(b.x - end.x) + Math.abs(b.y - end.y) });
        }
    }
    return null;
}
function placeCaption(route: RoutedEdge, boxes: Box[]): RoutedEdge['label'] {
    if (!route.label)
        return undefined;
    const { width, height } = route.label, candidates: Point[] = [];
    for (let i = 1; i < route.points.length; i++) {
        const a = route.points[i - 1]!, b = route.points[i]!;
        if (a.y === b.y)
            candidates.push({ x: (a.x + b.x - width) / 2, y: a.y - height - 8 }, { x: (a.x + b.x - width) / 2, y: a.y + 8 });
        else
            candidates.push({ x: a.x + 8, y: (a.y + b.y - height) / 2 }, { x: a.x - width - 8, y: (a.y + b.y - height) / 2 });
    }
    const found = candidates.find(p => !boxes.some(box => overlap({ ...p, width, height }, box)));
    // A clear gutter remains truthful when crowded user placement has no adjacent slot.
    const position = found ?? { x: Math.max(...boxes.map(b => b.x + b.width)) + 16, y: route.points[0]!.y };
    return { ...route.label, ...position };
}
export function manualLayout(model: SystemModel, view: View, auto: LayoutResult): LayoutResult {
    // Positions are a global node-id map (schema v1); detail views never inherit overview placement.
    if (isDetailView(view))
        return auto;
    const entries = auto.nodes.filter(node => model.layout && Object.hasOwn(model.layout, node.id));
    if (!entries.length)
        return auto;
    const warnings: string[] = [];
    const nodes: PlacedNode[] = auto.nodes.map(node => {
        const saved = model.layout && Object.hasOwn(model.layout, node.id) ? model.layout[node.id] : undefined;
        if (saved && !validPosition(saved)) {
            warnings.push('Some saved positions are outside the supported range and were ignored.');
            return node;
        }
        return validPosition(saved) ? { ...node, ...saved } : node;
    });
    const obstacles = nodes.map(n => ({ ...n, x: n.x - 8, y: n.y - 8, width: n.width + 16, height: n.height + 16 }));
    if (nodes.some((node, i) => nodes.slice(i + 1).some(other => overlap(node, other))))
        warnings.push('Some nodes overlap. Move them apart to improve readability.');
    if (nodes.length > 80)
        warnings.push('Manual routing is limited to 80 nodes per view. Larger views use simplified connection paths.');
    const prior: Point[][] = [], labels: Box[] = [], budget = { remaining: 2000000 };
    const edges = auto.edges.map((route, index) => {
        const edge = model.edges.find(edge => edge.id === route.id)!, from = nodes.find(n => n.id === edge.from)!, to = nodes.find(n => n.id === edge.to)!;
        const horizontal = view.orientation === 'LR', clearance = 16 + (index % 8) * 6;
        const start = { x: from.x + (horizontal ? from.width : from.width / 2), y: from.y + (horizontal ? from.height / 2 : from.height) };
        const end = { x: to.x + (horizontal ? 0 : to.width / 2), y: to.y + (horizontal ? to.height / 2 : 0) };
        const out = { x: start.x + (horizontal ? clearance : 0), y: start.y + (horizontal ? 0 : clearance) };
        const incoming = { x: end.x - (horizontal ? clearance : 0), y: end.y - (horizontal ? 0 : clearance) };
        const middle = routeBetween(out, incoming, obstacles, prior, clearance + 8, budget);
        const fallback = start.x === end.x && start.y === end.y
            ? [{ x: start.x, y: Math.min(...nodes.map(n => n.y)) - 40 }, { x: Math.max(...nodes.map(n => n.x + n.width)) + 40, y: Math.min(...nodes.map(n => n.y)) - 40 }, { x: Math.max(...nodes.map(n => n.x + n.width)) + 40, y: Math.max(...nodes.map(n => n.y + n.height)) + 40 }, { x: start.x, y: Math.max(...nodes.map(n => n.y + n.height)) + 40 }]
            : [out, { x: out.x, y: incoming.y }, incoming];
        const points = simplify([start, ...(middle ?? fallback), end]);
        if (!middle)
            warnings.push('Some connections use simplified routing; paths may overlap. Adjust positions or use a smaller view.');
        if (nodes.some(node => points.some((p, i) => i > 0 && crosses(points[i - 1]!, p, node))))
            warnings.push('Some connections overlap nodes. Move nodes apart to improve routing.');
        prior.push(points);
        const result = { ...route, points };
        result.label = placeCaption(result, [...nodes, ...labels]);
        if (result.label)
            labels.push(result.label);
        return result;
    });
    if (budget.remaining <= 0)
        warnings.push('Routing work limit reached. Some connections use simplified paths.');
    const boxes = [...nodes, ...labels], points = edges.flatMap(e => e.points);
    const x = Math.min(...boxes.map(b => b.x), ...points.map(p => p.x)) - 40, y = Math.min(...boxes.map(b => b.y), ...points.map(p => p.y)) - 40;
    const width = Math.max(...boxes.map(b => b.x + b.width), ...points.map(p => p.x)) - x + 40, height = Math.max(...boxes.map(b => b.y + b.height), ...points.map(p => p.y)) - y + 40;
    return { nodes, edges, width, height, bounds: { x, y, width, height }, warnings: [...new Set(warnings)] };
}
/** Pointer preview is linear in nodes/edges. Obstacle routing waits for release. */
export function dragLayout(model: SystemModel, view: View, auto: LayoutResult): LayoutResult {
    const nodes = auto.nodes.map(node => {
        const position = model.layout && Object.hasOwn(model.layout, node.id) ? model.layout[node.id] : undefined;
        return validPosition(position) ? { ...node, ...position } : node;
    });
    const byId = new Map(nodes.map(node => [node.id, node])), edgesById = new Map(model.edges.map(edge => [edge.id, edge]));
    const edges = auto.edges.map((route, index) => {
        const edge = edgesById.get(route.id)!, from = byId.get(edge.from)!, to = byId.get(edge.to)!, horizontal = view.orientation === 'LR', offset = 32 + (index % 8) * 6;
        const start = { x: from.x + (horizontal ? from.width : from.width / 2), y: from.y + (horizontal ? from.height / 2 : from.height) };
        const end = { x: to.x + (horizontal ? 0 : to.width / 2), y: to.y + (horizontal ? to.height / 2 : 0) };
        const points = horizontal
            ? [start, { x: start.x + offset, y: start.y }, { x: start.x + offset, y: Math.max(start.y, end.y) + offset }, { x: end.x - offset, y: Math.max(start.y, end.y) + offset }, { x: end.x - offset, y: end.y }, end]
            : [start, { x: start.x, y: start.y + offset }, { x: Math.max(start.x, end.x) + offset, y: start.y + offset }, { x: Math.max(start.x, end.x) + offset, y: end.y - offset }, { x: end.x, y: end.y - offset }, end];
        return { ...route, points: simplify(points), ...(route.label ? { label: { ...route.label, x: (start.x + end.x - route.label.width) / 2, y: (start.y + end.y) / 2 + 8 } } : {}) };
    });
    return { ...auto, nodes, edges };
}
