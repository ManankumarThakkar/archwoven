import type { EdgeType, NodeKind } from '@archwoven/model';
import { getParser, loadSources, parseSource, evidence, visit, childOfType, type SourceInventory } from './loader';
import type { Fragment } from './fragment';
import { deriveSemanticChecks } from './fragment';

const CLASS_KINDS: Record<string, NodeKind> = {
  RestController: 'service',
  Controller: 'service',
  Service: 'service',
  Repository: 'service',
  Entity: 'entity',
  Component: 'component',
};

const MAPPING_METHOD: Record<string, string> = {
  GetMapping: 'GET',
  PostMapping: 'POST',
  PutMapping: 'PUT',
  DeleteMapping: 'DELETE',
  PatchMapping: 'PATCH',
};

const stringsIn = (text: string): string[] => [...text.matchAll(/"([^"]*)"/g)].map((m) => m[1]!);

const DATASTORES: [RegExp, string][] = [
  [/jdbc:postgresql/i, 'PostgreSQL'],
  [/jdbc:mysql/i, 'MySQL'],
  [/jdbc:mariadb/i, 'MariaDB'],
  [/mongodb:/i, 'MongoDB'],
];

/**
 * Static Spring Boot structure extraction (SPEC §3 matrix): controllers, services,
 * repositories, DI edges, JPA entity owning-side relations, Kafka topics, datasource.
 * Placeholders (${VAR}) and dynamic wiring become explicit gaps — never guesses.
 */
export async function extractSpringBoot(dir: string, inventory?: SourceInventory): Promise<Fragment> {
  const sources = loadSources(dir, ['.java', '.yml', '.yaml', '.properties'], inventory);
  const parser = await getParser('java');
  const frag: Fragment = { nodes: [], edges: [], endpoints: [], gaps: [] };
  const seen = new Set<string>();
  const repositories: string[] = [];
  const controllerIds = new Set<string>();
  const requiredKeys = new Set<string>();
  const requiredEdges: { from: string; to: string; type: 'sync' }[] = [];

  const addNode = (id: string, kind: NodeKind, label: string, ev: Fragment['nodes'][0]['evidence'][0]) => {
    if (seen.has(id)) return;
    seen.add(id);
    frag.nodes.push({ id, kind, label, provenance: 'source-supported', evidence: [ev] });
  };
  const addEdge = (from: string, to: string, type: EdgeType, label?: string, ev?: Fragment['edges'][0]['evidence'][0]) => {
    const id = `java.e${frag.edges.length + 1}`;
    frag.edges.push({ id, from, to, type, label, provenance: 'source-supported', evidence: ev ? [ev] : [] });
  };

  for (const [path, source] of sources) {
    if (!path.endsWith('.java')) continue;
    const { tree, relPath } = await parseSource(parser, source, path);
    visit(tree.rootNode, 'class_declaration', (cls) => {
      const name = cls.childForFieldName('name')?.text;
      if (!name) return;
      const modifiers = childOfType(cls, 'modifiers');
      if (!modifiers) return;

      let kind: NodeKind | undefined;
      let classPrefix = '';
      const injected: string[] = [];
      let lombokCtor = false;

      for (const mod of modifiers.children) {
        if (mod.type !== 'marker_annotation' && mod.type !== 'annotation') continue;
        const ann = mod.childForFieldName('name')?.text ?? '';
        const args = mod.childForFieldName('arguments')?.text ?? '';
        if (CLASS_KINDS[ann]) kind = CLASS_KINDS[ann];
        if (ann === 'RequestMapping') classPrefix = stringsIn(args)[0] ?? '';
        if (ann === 'RequiredArgsConstructor' || ann === 'AllArgsConstructor') lombokCtor = true;
      }
      if (!kind) return;

      const nodeId = `java.${name}`;
      const ev = evidence(relPath, cls);
      addNode(nodeId, kind, name, ev);
      if (kind === 'service' && /Repository/.test(name)) repositories.push(nodeId);

      // DI edges: @Autowired fields + constructor params
      const body = cls.childForFieldName('body');
      if (body) {
        visit(body, 'field_declaration', (fd) => {
          const mods = childOfType(fd, 'modifiers');
          if (!mods || mods.children.some((m) => m.text === 'static')) return;
          const anns = mods.children
            .filter((m) => m.type === 'marker_annotation' || m.type === 'annotation')
            .map((m) => m.childForFieldName('name')?.text ?? '');
          const type = fd.childForFieldName('type')?.text;
          if (!type) return;
          // Lombok @RequiredArgsConstructor: every private final field is constructor-injected
          if (anns.includes('Autowired') || anns.includes('Inject') || (lombokCtor && /\bfinal\b/.test(fd.text))) {
            injected.push(type);
          }
        });
        visit(body, 'constructor_declaration', (ctor) => {
          for (const p of ctor.childForFieldName('parameters')?.namedChildren ?? []) {
            if (p.type === 'formal_parameter') {
              const t = p.childForFieldName('type')?.text;
              if (t) injected.push(t);
            }
          }
        });
        // HTTP endpoints, method-level listeners, setter injection
        visit(body, 'method_declaration', (md) => {
          const mods = childOfType(md, 'modifiers');
          if (!mods) return;
          for (const mod of mods.children) {
            if (mod.type !== 'marker_annotation' && mod.type !== 'annotation') continue;
            const ann = mod.childForFieldName('name')?.text ?? '';
            const annArgs = mod.childForFieldName('arguments')?.text ?? '';
            const method = MAPPING_METHOD[ann];
            if (method) {
              const raw = (stringsIn(annArgs)[0] ?? '').replace(/\/+$/, '');
              const full = classPrefix + (raw.startsWith('/') ? raw : raw ? `/${raw}` : '');
              frag.endpoints.push({ method, path: full === '' ? '/' : full, evidence: evidence(relPath, md) });
              controllerIds.add(nodeId);
            }
            if ((ann === 'KafkaListener' || ann === 'RabbitListener') && !/class_declaration/.test(md.parent?.type ?? '')) {
              const topic = stringsIn(annArgs)[0];
              if (topic) {
                const qid = `java.queue.${topic.replace(/\./g, '-')}`;
                addNode(qid, 'queue', topic, evidence(relPath, md));
                addEdge(nodeId, qid, 'async', undefined, evidence(relPath, md));
              }
            }
            if (ann === 'Autowired' || ann === 'Inject') {
              for (const p of md.childForFieldName('parameters')?.namedChildren ?? []) {
                if (p.type === 'formal_parameter') {
                  const t = p.childForFieldName('type')?.text;
                  if (t) injected.push(t);
                }
              }
            }
          }
        });
        // Entity owning-side relations (ManyToOne/OneToOne); inverse sides labeled in gaps
        if (kind === 'entity') {
          visit(body, 'field_declaration', (fd) => {
            const mods = childOfType(fd, 'modifiers');
            const rel = mods?.children.some(
              (m) => (m.type === 'marker_annotation' || m.type === 'annotation') &&
                (m.childForFieldName('name')?.text === 'ManyToOne' || m.childForFieldName('name')?.text === 'OneToOne'),
            );
            const type = fd.childForFieldName('type')?.text;
            if (rel && type) addEdge(nodeId, `java.${type}`, 'relation', 'N:1', evidence(relPath, fd));
          });
        }
      }

      for (const rawDep of injected) {
        const dep = rawDep.replace(/^.*\./, ''); // strip package qualifier from FQN param types
        const depId = `java.${dep}`;
        // Spring Data repositories are interfaces, not class_declaration — the injection site proves the node
        if (!seen.has(depId) && /(?:Repository|Service|Client)$/.test(dep)) {
          addNode(depId, 'service', dep, ev);
          if (/Repository$/.test(dep)) repositories.push(depId);
        }
        if (seen.has(depId)) {
          addEdge(nodeId, depId, 'sync', undefined, ev);
          if (controllerIds.has(nodeId) && !requiredKeys.has(`${nodeId}->${depId}`)) {
            requiredKeys.add(`${nodeId}->${depId}`);
            requiredEdges.push({ from: nodeId, to: depId, type: 'sync' });
          }
        }
      }

      // External calls (SPEC §3 matrix): URL literals in service/component/controller bodies + @FeignClient urls
      if (kind && kind !== 'entity') {
        for (const m of cls.text.matchAll(/https?:\/\/([^/"'\s]+)/g)) {
          const extId = `java.ext.${m[1]!.replace(/\W+/g, '-')}`;
          addNode(extId, 'external', m[1]!, ev);
          addEdge(nodeId, extId, 'sync', undefined, ev);
        }
        const feign = /@FeignClient\([^)]*url\s*=\s*["']([^"']+)["']/.exec(cls.text);
        if (feign) {
          const host = feign[1]!.replace(/^https?:\/\//, '').replace(/\/.*$/, '');
          const extId = `java.ext.${host.replace(/\W+/g, '-')}`;
          addNode(extId, 'external', host, ev);
          addEdge(nodeId, extId, 'sync', 'Feign', ev);
        }
      }
    });
  }

  // Config: datasource + unresolved placeholders
  const datastores: { id: string; name: string; ev: { path: string; lines: [number, number] } }[] = [];
  for (const [rel, text] of sources) {
    if (!/\.(?:ya?ml|properties)$/.test(rel)) continue;
    const lines = text.split('\n');
    for (const [re, name] of DATASTORES) {
      const idx = lines.findIndex((l) => !/^\s*#/.test(l) && re.test(l)); // commented-out URLs are not live config
      if (idx < 0) continue;
      const ev = { path: rel, lines: [idx + 1, idx + 1] as [number, number] };
      const id = `java.datastore.${name.toLowerCase()}`;
      addNode(id, 'datastore', name, ev);
      if (!datastores.some((d) => d.id === id)) datastores.push({ id, name, ev });
    }
    for (const m of text.matchAll(/\$\{([A-Z0-9_.]+)\}/g)) {
      frag.gaps.push(`unresolved placeholder \${${m[1]}} in ${rel} — runtime value not statically provable`);
    }
  }
  if (datastores.length === 1) {
    for (const repo of repositories) addEdge(repo, datastores[0]!.id, 'data', undefined, datastores[0]!.ev);
  } else if (datastores.length > 1) {
    frag.gaps.push(`multiple datasources (${datastores.map((d) => d.name).join(', ')}) — repo→datastore mapping not statically provable`);
  }

  frag.semanticChecks = deriveSemanticChecks(frag, requiredEdges);
  return frag;
}
