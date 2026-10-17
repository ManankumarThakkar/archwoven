import type { Node, SystemModel } from './schema';

const inOverview = (model: SystemModel, id: string): boolean =>
  model.views.some(v => v.type === 'architecture' && v.nodes.includes(id));

/** A node whose group names another existing component and which is in no architecture view.
 * Generated models that use `group` differently keep their nodes as ordinary components. */
export function isInternal(model: SystemModel, nodeId: string): boolean {
  const node = model.nodes.find(n => n.id === nodeId);
  return !!node?.group && node.group !== node.id && model.nodes.some(n => n.id === node.group) && !inOverview(model, node.id);
}

export function internalsOf(model: SystemModel, focus: string): Node[] {
  return model.nodes.filter(n => n.group === focus && isInternal(model, n.id));
}
