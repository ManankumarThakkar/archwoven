import type { EdgeType, NodeKind } from '@archwoven/model';
import type { Node as SyntaxNode } from 'web-tree-sitter';
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

const RELATIONS: Record<string, string> = { ManyToOne: 'N:1', OneToOne: 'N:1', OneToMany: '1:N', ManyToMany: 'N:M' };

const MAPPING_METHOD: Record<string, string> = {
  GetMapping: 'GET',
  PostMapping: 'POST',
  PutMapping: 'PUT',
  DeleteMapping: 'DELETE',
  PatchMapping: 'PATCH',
};

const HTTP_VERBS = /\b(GET|POST|PUT|DELETE|PATCH|HEAD|OPTIONS|TRACE)\b/g;

/** Annotation elements by name; a lone positional element is `value`. */
const elements = (args?: SyntaxNode | null): Map<string, SyntaxNode> => {
  const out = new Map<string, SyntaxNode>();
  for (const c of args?.namedChildren ?? []) {
    if (c.type === 'element_value_pair') out.set(c.childForFieldName('key')!.text, c.childForFieldName('value')!);
    else if (c.type !== 'comment') out.set('value', c);
  }
  return out;
};
/** Mapping paths of an annotation: string literals, arrays of them, or `{CONSTANT}` placeholders for references. */
const mappingPaths = (args: SyntaxNode | null | undefined, onUnresolved: (expr: string) => void): string[] => {
  const el = elements(args);
  const value = el.get('value') ?? el.get('path');
  if (!value) return [''];
  const items = value.type === 'element_value_array_initializer' ? value.namedChildren.filter((c) => c.type !== 'comment') : [value];
  return items.map((n) => {
    if (n.type === 'string_literal') return n.text.replace(/^"|"$/g, '');
    onUnresolved(n.text);
    return `{${n.text}}`;
  });
};
/** Spring's path rule: a missing leading slash is added and a trailing one dropped (`"tags/"` serves `/tags`). */
const slashed = (path: string): string => {
  const trimmed = path.replace(/\/+$/, '');
  return trimmed && !trimmed.startsWith('/') ? `/${trimmed}` : trimmed;
};
const stringsIn = (text: string): string[] => [...text.matchAll(/"([^"]*)"/g)].map((m) => m[1]!);

const DATASTORES: [RegExp, string][] = [
  [/jdbc:postgresql/i, 'PostgreSQL'],
  [/jdbc:mysql/i, 'MySQL'],
  [/jdbc:mariadb/i, 'MariaDB'],
  [/mongodb:/i, 'MongoDB'],
  [/jdbc:h2:/i, 'H2'],
  [/jdbc:hsqldb:/i, 'HSQLDB'],
];
/** Embedded databases Spring Boot configures itself when the default profile names no datasource URL. */
const EMBEDDED: [RegExp, string][] = [
  [/<artifactId>h2<\/artifactId>|['"]com\.h2database:h2\b/, 'H2'],
  [/<artifactId>hsqldb<\/artifactId>|['"]org\.hsqldb:hsqldb\b/, 'HSQLDB'],
  [/<artifactId>derby<\/artifactId>|['"]org\.apache\.derby:derby\b/, 'Derby'],
];

/**
 * Static Spring Boot structure extraction: controllers, services,
 * repositories, DI edges, JPA entity owning-side relations, Kafka topics, datasource.
 * Placeholders (${VAR}) and dynamic wiring become explicit gaps — never guesses.
 */
export async function extractSpringBoot(dir: string, inventory?: SourceInventory): Promise<Fragment> {
  const sources = loadSources(dir, ['.java', '.yml', '.yaml', '.properties', 'pom.xml', 'build.gradle', 'build.gradle.kts'], inventory);
  const parser = await getParser('java');
  const frag: Fragment = { nodes: [], edges: [], endpoints: [], gaps: [] };
  const seen = new Set<string>();
  const repositories: string[] = [];
  const controllerIds = new Set<string>();
  const requiredKeys = new Set<string>();
  const requiredEdges: { from: string; to: string; type: 'sync' }[] = [];
  const unresolvedPath = (rel: string) => (expr: string) => {
    const gap = `mapping path ${expr} in ${rel} — not statically resolved`;
    if (!frag.gaps.includes(gap)) frag.gaps.push(gap);
  };

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
      let classPrefixes = [''];
      const injected: string[] = [];
      let lombokCtor = false;

      for (const mod of modifiers.children) {
        if (mod.type !== 'marker_annotation' && mod.type !== 'annotation') continue;
        const ann = mod.childForFieldName('name')?.text ?? '';
        const args = mod.childForFieldName('arguments')?.text ?? '';
        if (CLASS_KINDS[ann]) kind = CLASS_KINDS[ann];
        if (ann === 'RequestMapping') classPrefixes = mappingPaths(mod.childForFieldName('arguments'), unresolvedPath(relPath));
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
            const verbs = MAPPING_METHOD[ann] ? [MAPPING_METHOD[ann]]
              : ann === 'RequestMapping' ? [...new Set([...(elements(mod.childForFieldName('arguments')).get('method')?.text ?? '').matchAll(HTTP_VERBS)].map((v) => v[1]!))] : undefined;
            if (verbs) {
              for (const prefix of classPrefixes) {
                for (const p of mappingPaths(mod.childForFieldName('arguments'), unresolvedPath(relPath))) {
                  const full = slashed(prefix) + slashed(p);
                  for (const method of verbs.length ? verbs : ['ANY']) {
                    frag.endpoints.push({ method, path: full === '' ? '/' : full, evidence: evidence(relPath, md) });
                  }
                }
              }
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
        // Entity owning-side relations; inverse sides (mappedBy) repeat a relation the owner already states
        if (kind === 'entity') {
          visit(body, 'field_declaration', (fd) => {
            const type = fd.childForFieldName('type')?.text;
            for (const m of childOfType(fd, 'modifiers')?.children ?? []) {
              if (m.type !== 'marker_annotation' && m.type !== 'annotation') continue;
              const cardinality = RELATIONS[m.childForFieldName('name')?.text ?? ''];
              if (!cardinality || !type || elements(m.childForFieldName('arguments')).has('mappedBy')) continue;
              const target = cardinality === 'N:1' ? type : /<\s*(?:[\w.]+\s*,\s*)?([\w.]+)\s*>/.exec(type)?.[1]?.replace(/^.*\./, '');
              if (target) addEdge(nodeId, `java.${target}`, 'relation', cardinality, evidence(relPath, fd));
            }
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

      // External calls: URL literals in service/component/controller bodies + @FeignClient urls
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
  // Embedded database from a non-test build dependency, used only when the default profile names no URL
  const defaultConfig = [...sources].filter(([rel]) => /(?:^|\/)application\.(?:ya?ml|properties)$/.test(rel)).map(([, text]) => text).join('\n');
  const configuresUrl = /^[ \t]*[^#\s].*(?:jdbc:|mongodb:|datasource\.url[ \t]*[=:])/m.test(defaultConfig)
    || /^[ \t]*datasource:[ \t]*\n(?:[ \t]+.*\n)*?[ \t]+url:/m.test(defaultConfig);
  for (const [rel, text] of sources) {
    if (configuresUrl || !/(?:^|\/)(?:pom\.xml|build\.gradle(?:\.kts)?)$/.test(rel)) continue;
    const blocks = rel.endsWith('pom.xml')
      ? [...text.matchAll(/<dependency>[\s\S]*?<\/dependency>/g)].filter((b) => !/<scope>\s*test\s*<\/scope>/.test(b[0]))
      : [...text.matchAll(/^[ \t]*(?!test)\w+[ \t(]+['"][^'"\n]+['"].*$/gm)];
    for (const b of blocks) {
      const name = EMBEDDED.find(([re]) => re.test(b[0]))?.[1];
      if (!name || datastores.some((d) => d.name === name)) continue;
      const start = text.slice(0, b.index).split('\n').length;
      const ev = { path: rel, lines: [start, start + b[0].split('\n').length - 1] as [number, number] };
      const id = `java.datastore.${name.toLowerCase()}`;
      addNode(id, 'datastore', name, ev);
      datastores.push({ id, name, ev });
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
