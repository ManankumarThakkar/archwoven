import { readFileSync } from 'node:fs';
import type { NodeKind } from '@archwoven/model';
import { getParser, walkFiles, parseSource, evidence, visit } from './loader';
import type { Fragment } from './fragment';

const stringsIn = (text: string): string[] => [...text.matchAll(/["']([^"']*)["']/g)].map((m) => m[1]!);

/**
 * Static FastAPI structure extraction (SPEC §3 matrix): app + routers, endpoints
 * (with statically-known include_router prefixes), Depends chains resolved through
 * their factory functions, SQLAlchemy entities + FK relations, httpx externals,
 * pydantic-settings datasources. Computed prefixes and mounts become explicit gaps.
 */
export async function extractFastApi(dir: string): Promise<Fragment> {
  const parser = await getParser('python');
  const frag: Fragment = { nodes: [], edges: [], endpoints: [], gaps: [] };
  const seen = new Set<string>();

  const addNode = (id: string, kind: NodeKind, label: string, ev: Fragment['nodes'][0]['evidence'][0]) => {
    if (seen.has(id)) return;
    seen.add(id);
    frag.nodes.push({ id, kind, label, provenance: 'source-supported', evidence: [ev] });
  };
  const edgeKeys = new Set<string>();
  const addEdge = (from: string, to: string, type: 'sync' | 'data' | 'relation' | 'async', ev: Fragment['edges'][0]['evidence'][0], label?: string) => {
    const key = `${from}->${to}`;
    if (edgeKeys.has(key)) return;
    edgeKeys.add(key);
    frag.edges.push({ id: `py.e${frag.edges.length + 1}`, from, to, type, label, provenance: 'source-supported', evidence: [ev] });
  };

  // Pass 1: parse everything, collect bindings.
  interface Module { rel: string; text: string; tree: Awaited<ReturnType<typeof parseSource>>['tree'] }
  const modules: Module[] = [];
  for (const file of walkFiles(dir, '.py')) {
    const p = await parseSource(parser, file, dir);
    modules.push({ rel: p.relPath, text: p.source, tree: p.tree });
  }

  // import alias -> module file (regex: tree-sitter alias shapes vary across grammar versions)
  const aliasToFile = new Map<string, string>();
  for (const m of modules) {
    for (const mm of m.text.matchAll(/from\s+([\w.]+)\s+import\s+(\w+)\s+as\s+(\w+)/g)) {
      aliasToFile.set(mm[3]!, `${mm[1]!.replace(/\./g, '/')}.py`);
    }
  }

  const routerIdOfLabel = new Map<string, string>();
  const prefixByRouter = new Map<string, string>();
  const factoryToClass = new Map<string, string>();
  let datastoreLabel: string | null = null;
  let settingsEv: Fragment['edges'][0]['evidence'][0] = { path: 'settings.py', lines: [1, 1] };
  const sessionServiceIds: string[] = []; // resolved to datastore edges after pass 1 (settings.py may parse last)

  // Detect app vars, routers, services, entities, factories, settings datastore
  for (const m of modules) {
    const modBase = m.rel.replace(/\.py$/, '');
    visit(m.tree.rootNode, 'assignment', (a) => {
      const target = a.childForFieldName('left')?.text ?? '';
      const value = a.childForFieldName('right')?.text ?? '';
      if (/FastAPI\(/.test(value)) addNode(`py:${m.rel}:${target}`, 'gateway', target, evidence(m.rel, a));
      if (/APIRouter\(/.test(value)) {
        const label = target === 'router' ? `${modBase.split('/').pop()}-router` : target;
        const id = `py:${m.rel}:${target}`;
        addNode(id, 'service', label, evidence(m.rel, a));
        routerIdOfLabel.set(label, id);
      }
    });
    visit(m.tree.rootNode, 'class_definition', (cls) => {
      const name = cls.childForFieldName('name')?.text ?? '';
      const bases = cls.childForFieldName('superclasses')?.text ?? '';
      const id = `py:${m.rel}:${name}`;
      if (/Base\b/.test(bases) && !/DeclarativeBase/.test(bases)) {
        const tn = /__tablename__\s*=\s*["']([^"']+)["']/.test(cls.text) ? RegExp.$1 : null;
        if (tn) {
          addNode(id, 'entity', tn, evidence(m.rel, cls));
          for (const fk of cls.text.matchAll(/ForeignKey\(\s*["'](\w+)\.(\w+)["']/g)) {
            addEdge(id, entityLabelLookup(modules, fk[1]!) ?? fk[1]!, 'relation', evidence(m.rel, cls), 'N:1');
          }
        }
      } else if (/BaseSettings/.test(bases)) {
        const url = /DATABASE_URL[^=]*=\s*["']([^"']+)["']/.test(cls.text) ? RegExp.$1 : null;
        if (url && /postgres/i.test(url)) {
          datastoreLabel = 'PostgreSQL';
          settingsEv = evidence(m.rel, cls);
          addNode('py:settings:datastore', 'datastore', 'PostgreSQL', settingsEv);
        }
      } else if (/^services\//.test(m.rel)) {
        addNode(id, 'service', name, evidence(m.rel, cls));
        if (/Session|session\.query/.test(cls.text)) sessionServiceIds.push(id);
        for (const hx of cls.text.matchAll(/https?:\/\/([^/"'\s]+)/g)) {
          const extId = `py:${m.rel}:ext:${hx[1]}`;
          addNode(extId, 'external', hx[1]!, evidence(m.rel, cls));
          addEdge(id, extId, 'sync', evidence(m.rel, cls));
        }
      }
    });
    // Depends factory resolution: def get_x(...): return ClassName(...)
    visit(m.tree.rootNode, 'function_definition', (fn) => {
      const name = fn.childForFieldName('name')?.text ?? '';
      const ret = /return\s+(\w+)\s*\(/.exec(fn.text);
      if (ret) factoryToClass.set(name, ret[1]!);
    });
  }
  if (datastoreLabel) {
    for (const sid of sessionServiceIds) addEdge(sid, 'py:settings:datastore', 'data', settingsEv);
  }

  // Pass 2a: include_router prefixes for every module first — endpoint paths see them regardless of file order
  for (const m of modules) {
    visit(m.tree.rootNode, 'call', (c) => {
      const fnText = c.childForFieldName('function')?.text ?? '';
      if (!/\.include_router$/.test(fnText)) return;
      const args = (c.childForFieldName('arguments')?.text ?? '').replace(/^\(|\)$/g, '');
      const alias = /^\s*(\w+)/.exec(args)?.[1];
      const targetFile = alias ? aliasToFile.get(alias) : undefined;
      const rid = targetFile ? routerIdOfLabel.get(targetFile.replace(/\.py$/, '').split('/').pop() + '-router') : undefined;
      const appNode = frag.nodes.find((n) => n.kind === 'gateway');
      if (!appNode || !rid) return;
      addEdge(appNode.id, rid, 'sync', evidence(m.rel, c));
      const staticPrefix = /prefix\s*=\s*["']([^"']+)["']/.exec(args);
      if (staticPrefix) prefixByRouter.set(rid, staticPrefix[1]!);
      const computed = /prefix\s*=\s*([\w.]+)/.exec(args);
      if (!staticPrefix && computed) {
        frag.gaps.push(`computed prefix ${computed[1]} — include_router prefix not statically resolved`);
      }
    });
  }

  // Pass 2b: endpoints + Depends edges
  for (const m of modules) {
    const modBase = m.rel.replace(/\.py$/, '').split('/').pop()!;
    visit(m.tree.rootNode, 'decorated_definition', (dd) => {
      const deco = dd.children.find((c) => c.type === 'decorator');
      if (!deco) return;
      const text = deco.text.slice(1); // strip @
      const call = /^(\w+)\.(get|post|put|delete|patch)\(\s*["']([^"']*)["']/.exec(text);
      if (!call) return;
      const varName = call[1]!;
      const method = call[2]!;
      const path = call[3]!;
      const routerLabel = varName === 'app' ? null : modBase + '-router';
      const rid = routerLabel ? routerIdOfLabel.get(routerLabel) : undefined;
      const prefix = rid ? (prefixByRouter.get(rid) ?? '') : '';
      const full = varName === 'app' ? path : prefix + path;
      if (routerLabel && rid) {
        const appNode = frag.nodes.find((n) => n.kind === 'gateway');
        if (appNode) addEdge(appNode.id, rid, 'sync', evidence(m.rel, dd));
      }
      frag.endpoints.push({ method: method.toUpperCase(), path: full, evidence: evidence(m.rel, dd) });
      // Depends edges on this endpoint's params
      const fn = dd.childForFieldName('definition');
      if (fn && rid) {
        for (const dep of fn.text.matchAll(/Depends\(\s*(\w+)\s*\)/g)) {
          const cls = factoryToClass.get(dep[1]!);
          if (cls) {
            const target = frag.nodes.find((n) => n.kind === 'service' && n.label === cls);
            if (target) addEdge(rid, target.id, 'sync', evidence(m.rel, dd), 'Depends');
          }
        }
      }
      // BackgroundTasks.add_task(fn, ...) → async edge to a background queue node (SPEC §3 messaging subset)
      if (fn) {
        const src = rid ?? frag.nodes.find((n) => n.kind === 'gateway')?.id;
        for (const bt of fn.text.matchAll(/add_task\(\s*(\w+)/g)) {
          const qid = `py:${m.rel}:bg:${bt[1]}`;
          addNode(qid, 'queue', `background:${bt[1]}`, evidence(m.rel, dd));
          if (src) addEdge(src, qid, 'async', evidence(m.rel, dd));
        }
      }
    });
  }

  // FK edges need entity ids resolved by label — second sweep
  const byLabel = new Map(frag.nodes.map((n) => [n.label, n.id]));
  frag.edges = frag.edges.map((e) => {
    if (e.type === 'relation' && !seen.has(e.to)) {
      const real = byLabel.get(e.to);
      if (real) { e.to = real; }
    }
    return e;
  });

  return frag;
}

function entityLabelLookup(modules: { text: string }[], tableName: string): string | null {
  for (const m of modules) if (new RegExp(`__tablename__\\s*=\\s*["']${tableName}["']`).test(m.text)) return tableName;
  return null;
}
