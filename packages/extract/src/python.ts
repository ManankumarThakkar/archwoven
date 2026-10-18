import type { NodeKind } from '@archwoven/model';
import type { Node as SyntaxNode } from 'web-tree-sitter';
import { getParser, loadSources, parseSource, evidence, visit, type SourceInventory } from './loader';
import type { Fragment } from './fragment';
import { deriveSemanticChecks } from './fragment';

type Ev = Fragment['nodes'][0]['evidence'][0];
interface Module { rel: string; text: string; tree: Awaited<ReturnType<typeof parseSource>>['tree'] }
/** An imported name: a whole module, or one symbol inside a module. */
interface Binding { module?: string; symbol?: string }
interface Router { id: string; label: string; prefix?: SyntaxNode; rel: string }
interface Include { parent: string; prefix?: SyntaxNode; rel: string }
interface DepFn { rel: string; node: SyntaxNode }

const HTTP_METHODS = new Set(['get', 'post', 'put', 'delete', 'patch', 'options', 'head', 'trace']);
const SESSION_CLASSES = /^(?:Session|AsyncSession|SessionLocal|async_session)$/;
const DSN_TYPES: [RegExp, string][] = [
  [/Postgres(?:ql)?Dsn|postgres(?:ql)?(?:\+\w+)?:\/\//i, 'PostgreSQL'],
  [/MySQLDsn|MariaDBDsn|mysql(?:\+\w+)?:\/\/|mariadb:\/\//i, 'MySQL'],
  [/MongoDsn|mongodb(?:\+srv)?:\/\//i, 'MongoDB'],
  [/sqlite(?:\+\w+)?:\/\//i, 'SQLite'],
];

/** The value of a plain string literal (no interpolation), or undefined. */
const literal = (n?: SyntaxNode | null): string | undefined => {
  if (!n || n.type !== 'string' || n.children.some((c) => c.type === 'interpolation')) return undefined;
  return /^[rRuUbB]*("""|'''|"|')([\s\S]*)\1$/.exec(n.text)?.[2];
};
const keyword = (args: SyntaxNode | null | undefined, name: string): SyntaxNode | undefined =>
  args?.namedChildren.find((a) => a.type === 'keyword_argument' && a.childForFieldName('name')?.text === name)?.childForFieldName('value') ?? undefined;
const positional = (args: SyntaxNode | null | undefined): SyntaxNode[] =>
  args?.namedChildren.filter((a) => a.type !== 'keyword_argument' && a.type !== 'comment') ?? [];

/**
 * Static FastAPI structure extraction: applications and routers,
 * include_router chains (module attributes, aliases, relative imports, nested
 * routers, constructor and include prefixes), endpoints with their full mounted
 * paths, Depends chains (factories that return or yield, Annotated aliases,
 * decorator dependencies, class dependencies) resolved to services and database
 * sessions, SQLAlchemy and SQLModel tables with foreign keys, httpx externals and
 * settings datastores. Anything not statically provable becomes an explicit gap.
 */
export async function extractFastApi(dir: string, inventory?: SourceInventory): Promise<Fragment> {
  const sources = loadSources(dir, ['.py'], inventory);
  const parser = await getParser('python');
  const frag: Fragment = { nodes: [], edges: [], endpoints: [], gaps: [] };
  const seen = new Set<string>();
  const gaps = new Set<string>();
  const requiredKeys = new Set<string>();
  const requiredEdges: { from: string; to: string; type: 'sync' }[] = [];

  const addNode = (id: string, kind: NodeKind, label: string, ev: Ev) => {
    if (seen.has(id)) return;
    seen.add(id);
    frag.nodes.push({ id, kind, label, provenance: 'source-supported', evidence: [ev] });
  };
  const edgeKeys = new Set<string>();
  const addEdge = (from: string, to: string, type: 'sync' | 'data' | 'relation' | 'async', ev: Ev, label?: string) => {
    const key = `${from}->${to}`;
    if (edgeKeys.has(key)) return;
    edgeKeys.add(key);
    frag.edges.push({ id: `py.e${frag.edges.length + 1}`, from, to, type, label, provenance: 'source-supported', evidence: [ev] });
  };

  const modules: Module[] = [];
  for (const [path, source] of sources) {
    const p = await parseSource(parser, source, path);
    modules.push({ rel: p.relPath, text: p.source, tree: p.tree });
  }

  // ── module names and imports ──
  const dottedOf = (rel: string) => rel.replace(/\.py$/, '').replace(/(^|\/)__init__$/, '').split('/').filter(Boolean).join('.');
  const relByDotted = new Map(modules.map((m) => [dottedOf(m.rel), m.rel]));
  const resolveModule = (dotted: string): string | undefined => {
    const exact = relByDotted.get(dotted);
    if (exact) return exact;
    const suffix = [...relByDotted].filter(([d]) => d.endsWith(`.${dotted}`));
    return suffix.length === 1 ? suffix[0]![1] : undefined;
  };
  const packageOf = (rel: string) => dottedOf(rel).split('.').slice(0, /(^|\/)__init__\.py$/.test(rel) ? undefined : -1);
  const bindings = new Map<string, Map<string, Binding>>();
  for (const m of modules) {
    const b = new Map<string, Binding>();
    for (const mm of m.text.matchAll(/^[ \t]*from[ \t]+(\.*)([\w.]*)[ \t]+import[ \t]+(?:\(([^)]*)\)|([^\n#]+))/gm)) {
      const level = mm[1]!.length;
      const base = level ? [...packageOf(m.rel).slice(0, packageOf(m.rel).length - (level - 1)), ...(mm[2] ? mm[2].split('.') : [])].join('.') : mm[2]!;
      for (const part of (mm[3] ?? mm[4]!).split(',')) {
        const [name, alias] = part.trim().split(/\s+as\s+/);
        if (!name || name === '*') continue;
        const asModule = level ? relByDotted.get(base ? `${base}.${name}` : name) : resolveModule(base ? `${base}.${name}` : name);
        b.set(alias ?? name, asModule ? { module: asModule } : { module: level ? relByDotted.get(base) : resolveModule(base), symbol: name });
      }
    }
    for (const mm of m.text.matchAll(/^[ \t]*import[ \t]+([\w.]+)[ \t]+as[ \t]+(\w+)/gm)) {
      const target = resolveModule(mm[1]!);
      if (target) b.set(mm[2]!, { module: target });
    }
    bindings.set(m.rel, b);
  }
  /** Resolve a name or `module.attr` expression in one module to a `rel:name` key that `known` accepts. */
  const resolveRef = (rel: string, expr: string, known: (key: string) => boolean): string | undefined => {
    const dot = /^(\w+)\.(\w+)$/.exec(expr);
    if (dot) {
      const mod = bindings.get(rel)?.get(dot[1]!);
      return mod?.module && !mod.symbol && known(`${mod.module}:${dot[2]}`) ? `${mod.module}:${dot[2]}` : undefined;
    }
    let at = rel;
    let name = expr;
    for (let hop = 0; hop < 4; hop++) {
      if (known(`${at}:${name}`)) return `${at}:${name}`;
      const b = bindings.get(at)?.get(name);
      if (!b?.module || !b.symbol) return undefined;
      at = b.module;
      name = b.symbol;
    }
    return undefined;
  };

  // ── pass 1: applications, routers, tables, services, settings ──
  const gateways = new Map<string, string>(); // rel:var -> node id
  const routers = new Map<string, Router>();
  const tables = new Map<string, string>(); // table name -> node id
  const foreignKeys: { from: string; table: string; ev: Ev }[] = [];
  const settingsDefaults = new Map<string, string | null>(); // settings field -> literal default (null: declared without one)
  const datastores = new Map<string, Ev>();
  const sessionServiceIds: string[] = [];
  const functions = new Map<string, DepFn[]>(); // function name -> definitions
  const aliases = new Map<string, { rel: string; node: SyntaxNode }>(); // rel:Alias -> Annotated[...] value

  // Settings classes: anything whose base chain reaches pydantic BaseSettings, across modules.
  const classBases = new Map<string, string[]>();
  for (const m of modules) visit(m.tree.rootNode, 'class_definition', (cls) => {
    const name = cls.childForFieldName('name')?.text ?? '';
    classBases.set(name, [...(classBases.get(name) ?? []), cls.childForFieldName('superclasses')?.text ?? '']);
  });
  const settingsClasses = new Set<string>();
  for (let grew = true; grew;) {
    grew = false;
    for (const [name, bases] of classBases) {
      if (settingsClasses.has(name)) continue;
      if (bases.some((b) => /\bBaseSettings\b/.test(b) || [...settingsClasses].some((s) => new RegExp(`\\b${s}\\b`).test(b)))) {
        settingsClasses.add(name);
        grew = true;
      }
    }
  }

  for (const m of modules) {
    const modBase = m.rel.replace(/\.py$/, '').split('/').pop()!;
    visit(m.tree.rootNode, 'assignment', (a) => {
      const target = a.childForFieldName('left')?.text ?? '';
      const value = a.childForFieldName('right');
      if (!/^\w+$/.test(target) || value?.type !== 'call') return;
      const fn = value.childForFieldName('function')?.text ?? '';
      const args = value.childForFieldName('arguments');
      if (/^(?:fastapi\.)?FastAPI$/.test(fn)) {
        const id = `py:${m.rel}:${target}`;
        addNode(id, 'gateway', target, evidence(m.rel, a));
        gateways.set(`${m.rel}:${target}`, id);
      }
      if (/^(?:fastapi\.)?APIRouter$/.test(fn)) {
        const id = `py:${m.rel}:${target}`;
        const label = target === 'router' ? `${modBase}-router` : target;
        addNode(id, 'service', label, evidence(m.rel, a));
        routers.set(`${m.rel}:${target}`, { id, label, prefix: keyword(args, 'prefix'), rel: m.rel });
      }
    });
    for (const child of m.tree.rootNode.namedChildren) {
      const a = child.type === 'expression_statement' ? child.namedChildren[0] : undefined;
      const value = a?.type === 'assignment' ? a.childForFieldName('right') : undefined;
      if (value && /^Annotated\[/.test(value.text) && /Depends\(/.test(value.text)) aliases.set(`${m.rel}:${a!.childForFieldName('left')!.text}`, { rel: m.rel, node: value });
    }
    visit(m.tree.rootNode, 'function_definition', (fn) => {
      const name = fn.childForFieldName('name')?.text ?? '';
      functions.set(name, [...(functions.get(name) ?? []), { rel: m.rel, node: fn }]);
    });
    visit(m.tree.rootNode, 'class_definition', (cls) => {
      const name = cls.childForFieldName('name')?.text ?? '';
      const bases = cls.childForFieldName('superclasses')?.text ?? '';
      const id = `py:${m.rel}:${name}`;
      const ev = evidence(m.rel, cls);
      const sqlalchemy = /\bBase\b/.test(bases) && !/DeclarativeBase/.test(bases);
      const sqlmodel = /\btable\s*=\s*True\b/.test(bases);
      if (sqlalchemy || sqlmodel) {
        const declared = /__tablename__\s*=\s*["']([^"']+)["']/.exec(cls.text)?.[1];
        const table = declared ?? (sqlmodel ? name.toLowerCase() : undefined);
        if (!table) return;
        addNode(id, 'entity', table, ev);
        tables.set(table, id);
        for (const fk of cls.text.matchAll(/(?:ForeignKey\(\s*|foreign_key\s*=\s*)["'](\w+)\.\w+["']/g)) foreignKeys.push({ from: id, table: fk[1]!, ev });
      } else if (settingsClasses.has(name)) {
        for (const field of cls.childForFieldName('body')?.namedChildren ?? []) {
          const a = field.type === 'expression_statement' ? field.namedChildren[0] : undefined;
          const key = a?.type === 'assignment' ? a.childForFieldName('left')?.text : undefined;
          if (!key || !/^\w+$/.test(key)) continue;
          const declared = literal(a!.childForFieldName('right')) ?? null;
          // Classes that disagree on a default leave the runtime value unprovable.
          settingsDefaults.set(key, settingsDefaults.has(key) && settingsDefaults.get(key) !== declared ? null : declared);
          if (/(?:DATABASE|DB|SQLALCHEMY_DATABASE)_(?:URL|URI|DSN)$/i.test(key)) {
            const store = DSN_TYPES.find(([re]) => re.test(a!.text))?.[1];
            if (store && !datastores.has(store)) datastores.set(store, evidence(m.rel, a!));
          }
        }
      } else if (/(?:^|\/)services\//.test(m.rel)) {
        addNode(id, 'service', name, ev);
        if (/Session|session\.query/.test(cls.text)) sessionServiceIds.push(id);
        for (const hx of cls.text.matchAll(/https?:\/\/([^/"'\s]+)/g)) {
          const extId = `py:${m.rel}:ext:${hx[1]}`;
          addNode(extId, 'external', hx[1]!, ev);
          addEdge(id, extId, 'sync', ev);
        }
      }
    });
  }
  for (const [store, ev] of datastores) addNode(`py:datastore:${store.toLowerCase()}`, 'datastore', store, ev);
  // One configured database is the only statically provable target for sessions.
  const datastoreId = datastores.size === 1 ? `py:datastore:${[...datastores.keys()][0]!.toLowerCase()}` : undefined;
  if (datastores.size > 1) gaps.add(`multiple datasources (${[...datastores.keys()].join(', ')}) — session→datastore mapping not statically provable`);
  if (datastoreId) for (const sid of sessionServiceIds) addEdge(sid, datastoreId, 'data', frag.nodes.find((n) => n.id === datastoreId)!.evidence[0]!);
  for (const fk of foreignKeys) {
    const to = tables.get(fk.table);
    if (to) addEdge(fk.from, to, 'relation', fk.ev, 'N:1');
    else gaps.add(`foreign key to table ${fk.table} in ${fk.ev.path} — table not found in the analyzed source`);
  }

  // ── prefixes: literals, module constants, settings defaults ──
  const constants = new Map<string, string>(); // rel:NAME -> module-level string constant
  for (const m of modules) {
    for (const child of m.tree.rootNode.namedChildren) {
      const a = child.type === 'expression_statement' ? child.namedChildren[0] : undefined;
      const value = a?.type === 'assignment' ? literal(a.childForFieldName('right')) : undefined;
      if (value !== undefined) constants.set(`${m.rel}:${a!.childForFieldName('left')!.text}`, value);
    }
  }

  const prefixValue = (rel: string, node?: SyntaxNode): string => {
    if (!node) return '';
    const value = literal(node);
    if (value !== undefined) return value;
    const expr = node.text;
    const attr = /^\w+\.(\w+)$/.exec(expr)?.[1];
    if (attr && settingsDefaults.has(attr)) {
      const declared = settingsDefaults.get(attr);
      if (declared !== null && declared !== undefined) {
        gaps.add(`computed prefix ${expr} resolved to its declared default "${declared}" — an environment override would change these paths`);
        return declared;
      }
    }
    if (/^\w+$/.test(expr)) {
      const key = resolveRef(rel, expr, (k) => constants.has(k));
      if (key) return constants.get(key)!;
    }
    gaps.add(`computed prefix ${expr} — include_router prefix not statically resolved`);
    return `{${expr}}`;
  };
  // ── pass 2: include_router chains ──
  const includes = new Map<string, Include[]>(); // router key -> where it is included
  const isMountable = (k: string) => routers.has(k) || gateways.has(k);
  for (const m of modules) {
    visit(m.tree.rootNode, 'call', (c) => {
      const fn = c.childForFieldName('function');
      if (fn?.type !== 'attribute' || fn.childForFieldName('attribute')?.text !== 'include_router') return;
      const parent = resolveRef(m.rel, fn.childForFieldName('object')?.text ?? '', isMountable);
      const args = c.childForFieldName('arguments');
      const child = positional(args)[0] ?? keyword(args, 'router');
      const childKey = child ? resolveRef(m.rel, child.text, (k) => routers.has(k)) : undefined;
      if (!parent || !childKey) {
        gaps.add(`include_router(${child?.text ?? '?'}) in ${m.rel} — router not statically resolved`);
        return;
      }
      addEdge(gateways.get(parent) ?? routers.get(parent)!.id, routers.get(childKey)!.id, 'sync', evidence(m.rel, c));
      includes.set(childKey, [...(includes.get(childKey) ?? []), { parent, prefix: keyword(args, 'prefix'), rel: m.rel }]);
    });
  }
  /** Every path prefix under which a router's routes are served (a router can be included more than once). */
  const mounts = (key: string, stack: string[] = []): string[] => {
    if (gateways.has(key)) return [''];
    const router = routers.get(key)!;
    const own = prefixValue(router.rel, router.prefix);
    const inc = includes.get(key) ?? [];
    if (inc.length === 0) {
      gaps.add(`router ${router.label} is not included by any application in the analyzed source; its endpoints are listed without a mount prefix`);
      return [own];
    }
    if (stack.includes(key)) return [];
    return [...new Set(inc.flatMap((i) => mounts(i.parent, [...stack, key]).map((p) => p + prefixValue(i.rel, i.prefix) + own)))];
  };

  // ── dependencies: what a Depends() target ultimately provides ──
  const depFn = (rel: string, name: string): DepFn | undefined => {
    const defs = functions.get(name) ?? [];
    const imported = bindings.get(rel)?.get(name);
    return defs.find((d) => d.rel === rel) ?? defs.find((d) => d.rel === imported?.module) ?? (defs.length === 1 ? defs[0] : undefined);
  };
  /** Dependency function names or classes referenced directly by a parameter list or decorator. */
  const directDeps = (rel: string, text: string, seenAliases = new Set<string>()): { fn?: DepFn; cls?: string }[] => {
    const out: { fn?: DepFn; cls?: string }[] = [];
    for (const d of text.matchAll(/Depends\(\s*(\w+)\s*[,)]/g)) {
      const f = depFn(rel, d[1]!);
      out.push(f ? { fn: f } : { cls: d[1]! });
    }
    for (const d of text.matchAll(/(\w+)\s*\]?\s*(?:,\s*Depends\(\s*\)|=\s*Depends\(\s*\))/g)) out.push({ cls: d[1]! });
    for (const word of new Set(text.match(/\b[A-Za-z_]\w*\b/g) ?? [])) {
      const key = resolveRef(rel, word, (k) => aliases.has(k) && !seenAliases.has(k));
      if (key) out.push(...directDeps(aliases.get(key)!.rel, aliases.get(key)!.node.text, seenAliases.add(key)));
    }
    return out;
  };
  /** The classes a dependency function hands out: `return X(...)`, `yield X(...)`, `v = X(...); yield v`, `with X(...) as v: yield v`. */
  const provides = (fn: SyntaxNode): string[] => {
    const text = fn.text;
    const out = [...text.matchAll(/(?:return|yield)\s+(\w+)\s*\(/g)].map((r) => r[1]!);
    for (const y of text.matchAll(/yield\s+(\w+)\s*$/gm)) {
      const bound = new RegExp(`(?:\\b${y[1]}\\s*=\\s*(\\w+)\\s*\\(|with\\s+(\\w+)\\s*\\([^\\n]*\\)\\s+as\\s+${y[1]}\\b)`).exec(text);
      if (bound) out.push(bound[1] ?? bound[2]!);
    }
    return out;
  };
  const targetsOf = (rel: string, text: string, stack: SyntaxNode[] = []): string[] => {
    const out: string[] = [];
    for (const d of directDeps(rel, text)) {
      if (d.cls) out.push(d.cls);
      if (!d.fn || stack.includes(d.fn.node)) continue;
      out.push(...provides(d.fn.node));
      out.push(...targetsOf(d.fn.rel, d.fn.node.childForFieldName('parameters')?.text ?? '', [...stack, d.fn.node]));
    }
    return out;
  };
  const routerIds = new Set([...routers.values()].map((r) => r.id));
  const serviceByLabel = (label: string) => frag.nodes.find((n) => n.kind === 'service' && n.label === label && !routerIds.has(n.id));

  // ── pass 3: endpoints, dependency edges, background tasks ──
  for (const m of modules) {
    visit(m.tree.rootNode, 'decorated_definition', (dd) => {
      const fn = dd.childForFieldName('definition');
      for (const deco of dd.children.filter((c) => c.type === 'decorator')) {
        const call = deco.namedChildren[0];
        const callee = call?.type === 'call' ? call.childForFieldName('function') : undefined;
        if (callee?.type !== 'attribute') continue;
        const verb = callee.childForFieldName('attribute')?.text ?? '';
        if (!HTTP_METHODS.has(verb) && verb !== 'api_route') continue;
        const owner = resolveRef(m.rel, callee.childForFieldName('object')?.text ?? '', isMountable);
        if (!owner) continue;
        const args = call!.childForFieldName('arguments');
        const path = literal(positional(args)[0] ?? keyword(args, 'path'));
        if (path === undefined) continue;
        const methods = verb === 'api_route'
          ? (keyword(args, 'methods')?.namedChildren.map((n) => literal(n)?.toUpperCase()).filter((x): x is string => !!x) ?? ['GET'])
          : [verb.toUpperCase()];
        const ev = evidence(m.rel, dd);
        for (const mount of mounts(owner)) {
          for (const method of methods) {
            const full = mount + path || '/';
            if (!frag.endpoints.some((e) => e.method === method && e.path === full)) frag.endpoints.push({ method, path: full, evidence: ev });
          }
        }
        const src = gateways.get(owner) ?? routers.get(owner)!.id;
        const depText = `${fn?.childForFieldName('parameters')?.text ?? ''} ${keyword(args, 'dependencies')?.text ?? ''}`;
        for (const cls of new Set(targetsOf(m.rel, depText))) {
          if (SESSION_CLASSES.test(cls)) {
            if (datastoreId) addEdge(src, datastoreId, 'data', ev, 'Depends');
            continue;
          }
          const target = serviceByLabel(cls);
          if (!target) continue;
          addEdge(src, target.id, 'sync', ev, 'Depends');
          if (!requiredKeys.has(`${src}->${target.id}`)) {
            requiredKeys.add(`${src}->${target.id}`);
            requiredEdges.push({ from: src, to: target.id, type: 'sync' });
          }
        }
        // BackgroundTasks.add_task(fn, ...) → async edge to a background queue node (messaging subset)
        for (const bt of (fn?.text ?? '').matchAll(/add_task\(\s*(\w+)/g)) {
          const qid = `py:${m.rel}:bg:${bt[1]}`;
          addNode(qid, 'queue', `background:${bt[1]}`, ev);
          addEdge(src, qid, 'async', ev);
        }
      }
    });
  }

  frag.gaps = [...gaps];
  frag.semanticChecks = deriveSemanticChecks(frag, requiredEdges);
  return frag;
}
