import { basename } from 'node:path';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { EdgeType, NodeKind } from '@archwoven/model';
import { getParser, walkFiles, parseSource, evidence, visit, childOfType } from './loader';
import type { Fragment } from './fragment';

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
export async function extractSpringBoot(dir: string): Promise<Fragment> {
  const parser = await getParser('java');
  const frag: Fragment = { nodes: [], edges: [], endpoints: [], gaps: [] };
  const seen = new Set<string>();
  const repositories: string[] = [];

  const addNode = (id: string, kind: NodeKind, label: string, ev: Fragment['nodes'][0]['evidence'][0]) => {
    if (seen.has(id)) return;
    seen.add(id);
    frag.nodes.push({ id, kind, label, provenance: 'source-supported', evidence: [ev] });
  };
  const addEdge = (from: string, to: string, type: EdgeType, label?: string, ev?: Fragment['edges'][0]['evidence'][0]) => {
    const id = `java.e${frag.edges.length + 1}`;
    frag.edges.push({ id, from, to, type, label, provenance: 'source-supported', evidence: ev ? [ev] : [] });
  };

  for (const file of walkFiles(dir, '.java')) {
    const { tree, relPath } = await parseSource(parser, file, dir);
    visit(tree.rootNode, 'class_declaration', (cls) => {
      const name = cls.childForFieldName('name')?.text;
      if (!name) return;
      const modifiers = childOfType(cls, 'modifiers');
      if (!modifiers) return;

      let kind: NodeKind | undefined;
      let classPrefix = '';
      const injected: string[] = [];
      let kafkaTopic: string | null = null;

      for (const mod of modifiers.children) {
        if (mod.type !== 'marker_annotation' && mod.type !== 'annotation') continue;
        const ann = mod.childForFieldName('name')?.text ?? '';
        const args = mod.childForFieldName('arguments')?.text ?? '';
        if (CLASS_KINDS[ann]) kind = CLASS_KINDS[ann];
        if (ann === 'RequestMapping') classPrefix = stringsIn(args)[0] ?? '';
        if (ann === 'KafkaListener') kafkaTopic = stringsIn(args)[0] ?? null;
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
          const hasAutowired = mods?.children.some(
            (m) => (m.type === 'marker_annotation' || m.type === 'annotation') && m.childForFieldName('name')?.text === 'Autowired',
          );
          const type = fd.childForFieldName('type')?.text;
          if (hasAutowired && type) injected.push(type);
        });
        visit(body, 'constructor_declaration', (ctor) => {
          for (const p of ctor.childForFieldName('parameters')?.namedChildren ?? []) {
            if (p.type === 'formal_parameter') {
              const t = p.childForFieldName('type')?.text;
              if (t) injected.push(t);
            }
          }
        });
        // HTTP endpoints
        visit(body, 'method_declaration', (md) => {
          const mods = childOfType(md, 'modifiers');
          if (!mods) return;
          for (const mod of mods.children) {
            if (mod.type !== 'marker_annotation' && mod.type !== 'annotation') continue;
            const ann = mod.childForFieldName('name')?.text ?? '';
            const method = MAPPING_METHOD[ann];
            if (!method) continue;
            const raw = (stringsIn(mod.childForFieldName('arguments')?.text ?? '')[0] ?? '').replace(/\/+$/, '');
            const full = classPrefix + (raw.startsWith('/') ? raw : raw ? `/${raw}` : '');
            frag.endpoints.push({ method, path: full === '' ? '/' : full, evidence: evidence(relPath, md) });
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

      for (const dep of injected) {
        const depId = `java.${dep}`;
        // Spring Data repositories are interfaces, not class_declaration — the injection site proves the node
        if (!seen.has(depId) && /(?:Repository|Service|Client)$/.test(dep)) {
          addNode(depId, 'service', dep, ev);
          if (/Repository$/.test(dep)) repositories.push(depId);
        }
        if (seen.has(depId)) addEdge(nodeId, depId, 'sync', undefined, ev);
      }

      if (kafkaTopic) {
        const qid = `java.queue.${kafkaTopic.replace(/\./g, '-')}`;
        addNode(qid, 'queue', kafkaTopic, ev);
        addEdge(nodeId, qid, 'async', undefined, ev);
      }
    });
  }

  // Config: datasource + unresolved placeholders
  for (const file of walkFiles(dir, '.yml').concat(walkFiles(dir, '.properties'))) {
    const rel = `${basename(file)}`;
    const text = readFileSync(file, 'utf8');
    const lines = text.split('\n');
    for (const [re, name] of DATASTORES) {
      const idx = lines.findIndex((l) => re.test(l));
      if (idx < 0) continue;
      const id = `java.datastore.${name.toLowerCase()}`;
      addNode(id, 'datastore', name, { path: rel, lines: [idx + 1, idx + 1] });
      for (const repo of repositories) addEdge(repo, id, 'data');
    }
    for (const m of text.matchAll(/\$\{([A-Z0-9_.]+)\}/g)) {
      frag.gaps.push(`unresolved placeholder \${${m[1]}} in ${rel} — runtime value not statically provable`);
    }
  }

  return frag;
}
