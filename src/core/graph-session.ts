import { z } from 'zod';
import { graphDocumentSchema, readGraphDocument } from './graph-document.js';
import type { ArchitectureGraph, IREdge } from './ir.js';

const fields = graphDocumentSchema.innerType().shape;
const id = z.string().regex(/^[A-Za-z_][A-Za-z0-9_]*$/);
export const graphOperationSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('node.add'), node: fields.nodes.element }),
  z.object({ type: z.literal('node.update'), id, changes: fields.nodes.element.omit({ id: true }).partial() }),
  z.object({ type: z.literal('node.remove'), id }),
  z.object({ type: z.literal('edge.add'), edge: fields.edges.element }),
  z.object({ type: z.literal('edge.update'), id, changes: fields.edges.element.omit({ id: true }).partial() }),
  z.object({ type: z.literal('edge.remove'), id }),
  z.object({ type: z.literal('group.add'), group: fields.groups.removeDefault().element }),
  z.object({ type: z.literal('group.update'), id, label: z.string().min(1) }),
  z.object({ type: z.literal('group.remove'), id }),
]);
export type GraphOperation = z.input<typeof graphOperationSchema>;
export interface GraphSnapshot { revision: number; graph: ArchitectureGraph }

export class GraphConflictError extends Error {
  constructor(public readonly revision: number, public readonly conflicts: string[] = []) {
    super(conflicts.length ? 'The source update conflicts with local edits.' : 'The graph revision is stale. Read the current graph before retrying.');
    this.name = 'GraphConflictError';
  }
}

function edgeSignature(edge: IREdge): string {
  return JSON.stringify([edge.from, edge.to, edge.kind, edge.label ?? '', edge.bidirectional]);
}

/** Assigns identifiers once so connections survive editing and undo. */
export function identifyGraph(value: unknown): ArchitectureGraph {
  const graph = readGraphDocument(value);
  const used = new Set(graph.edges.flatMap(edge => edge.id ? [edge.id] : []));
  for (const edge of graph.edges) {
    if (edge.id) continue;
    let hash = 2166136261;
    for (const character of edgeSignature(edge)) hash = Math.imul(hash ^ character.charCodeAt(0), 16777619);
    const prefix = `edge_${(hash >>> 0).toString(36)}`;
    let candidate = prefix, suffix = 2;
    while (used.has(candidate)) candidate = `${prefix}_${suffix++}`;
    edge.id = candidate;
    used.add(candidate);
  }
  return graph;
}

function find<T extends { id?: string }>(items: T[], identifier: string): T {
  const item = items.find(entry => entry.id === identifier);
  if (!item) throw new Error('The operation references a missing graph element.');
  return item;
}

function updateMembership(graph: ArchitectureGraph, nodeId: string, groupId?: string) {
  for (const group of graph.groups) group.nodeIds = group.nodeIds.filter(member => member !== nodeId);
  if (groupId) find(graph.groups, groupId).nodeIds.push(nodeId);
}

function applyOperation(graph: ArchitectureGraph, operation: z.output<typeof graphOperationSchema>) {
  switch (operation.type) {
    case 'node.add':
      if (graph.nodes.some(node => node.id === operation.node.id)) throw new Error('The node identifier already exists.');
      graph.nodes.push(operation.node);
      updateMembership(graph, operation.node.id, operation.node.groupId);
      break;
    case 'node.update': {
      const node = find(graph.nodes, operation.id);
      Object.assign(node, operation.changes);
      if ('groupId' in operation.changes) updateMembership(graph, node.id, node.groupId);
      if ('layout' in operation.changes) {
        for (const edge of graph.edges) if (edge.from === node.id || edge.to === node.id) delete edge.points;
      }
      break;
    }
    case 'node.remove':
      find(graph.nodes, operation.id);
      graph.nodes = graph.nodes.filter(node => node.id !== operation.id);
      graph.edges = graph.edges.filter(edge => edge.from !== operation.id && edge.to !== operation.id);
      updateMembership(graph, operation.id);
      break;
    case 'edge.add': graph.edges.push(operation.edge); break;
    case 'edge.update': {
      const edge = find(graph.edges, operation.id);
      Object.assign(edge, operation.changes);
      if ('from' in operation.changes || 'to' in operation.changes) delete edge.points;
      break;
    }
    case 'edge.remove':
      find(graph.edges, operation.id);
      graph.edges = graph.edges.filter(edge => edge.id !== operation.id);
      break;
    case 'group.add':
      if (graph.groups.some(group => group.id === operation.group.id)) throw new Error('The group identifier already exists.');
      graph.groups.push({ ...operation.group, nodeIds: [] });
      for (const nodeId of operation.group.nodeIds) {
        find(graph.nodes, nodeId).groupId = operation.group.id;
        updateMembership(graph, nodeId, operation.group.id);
      }
      break;
    case 'group.update': find(graph.groups, operation.id).label = operation.label; break;
    case 'group.remove':
      find(graph.groups, operation.id);
      graph.groups = graph.groups.filter(group => group.id !== operation.id);
      for (const node of graph.nodes) if (node.groupId === operation.id) delete node.groupId;
      break;
  }
}

export function applyGraphOperations(value: unknown, operations: unknown): ArchitectureGraph {
  const graph = identifyGraph(value);
  const parsed = z.array(graphOperationSchema).max(10000).parse(operations);
  for (const operation of parsed) applyOperation(graph, operation);
  return identifyGraph(graph);
}

function equal(left: unknown, right: unknown): boolean {
  if (Object.is(left, right)) return true;
  if (!left || !right || typeof left !== 'object' || typeof right !== 'object') return false;
  if (Array.isArray(left) || Array.isArray(right)) {
    return Array.isArray(left) && Array.isArray(right) && left.length === right.length && left.every((value, index) => equal(value, right[index]));
  }
  const a = left as Record<string, unknown>, b = right as Record<string, unknown>;
  const keys = Object.keys(a).filter(key => a[key] !== undefined);
  return keys.length === Object.keys(b).filter(key => b[key] !== undefined).length && keys.every(key => equal(a[key], b[key]));
}

function mergeValue(base: unknown, local: unknown, incoming: unknown, path: string, conflicts: string[]): unknown {
  if (equal(local, base) || equal(local, incoming)) return incoming;
  if (equal(incoming, base)) return local;
  if (base && local && incoming && [base, local, incoming].every(value => typeof value === 'object' && !Array.isArray(value))) {
    const result: Record<string, unknown> = {};
    const objects = [base, local, incoming] as Record<string, unknown>[];
    for (const key of new Set(objects.flatMap(Object.keys))) {
      result[key] = mergeValue(objects[0][key], objects[1][key], objects[2][key], `${path}.${key}`, conflicts);
    }
    return result;
  }
  conflicts.push(path);
  return local;
}

/** Retains independent edits and rejects conflicting source changes. */
export function mergeGraphUpdate(base: ArchitectureGraph, local: ArchitectureGraph, incoming: ArchitectureGraph) {
  const conflicts: string[] = [];
  const result = { ...incoming };
  for (const key of ['nodes', 'edges', 'groups'] as const) {
    const indexes = [base, local, incoming].map(graph => new Map(graph[key].map(item => [item.id!, item])));
    const merged = [];
    for (const identifier of new Set([...indexes[2].keys(), ...indexes[1].keys()])) {
      const value = mergeValue(indexes[0].get(identifier), indexes[1].get(identifier), indexes[2].get(identifier), `${key}.${identifier}`, conflicts);
      if (value) merged.push(value);
    }
    Object.assign(result, { [key]: merged });
  }
  result.title = mergeValue(base.title, local.title, incoming.title, 'title', conflicts) as string | undefined;
  result.direction = mergeValue(base.direction, local.direction, incoming.direction, 'direction', conflicts) as ArchitectureGraph['direction'];
  return { graph: result, conflicts };
}

/** Owns atomic edits, revision checks, and bounded history for one viewer. */
export function createGraphSession(initial: unknown, historyLimit = 50) {
  if (!Number.isInteger(historyLimit) || historyLimit < 1) throw new Error('The history limit must be a positive integer.');
  let graph = identifyGraph(initial), source = identifyGraph(initial), revision = 0;
  const undo: ArchitectureGraph[] = [], redo: ArchitectureGraph[] = [];
  const listeners = new Set<(snapshot: GraphSnapshot) => void>();
  const read = (): GraphSnapshot => ({ revision, graph: structuredClone(graph) });
  function check(expectedRevision: number) {
    if (expectedRevision !== revision) throw new GraphConflictError(revision);
  }
  function publish(next: ArchitectureGraph, remember = true) {
    if (equal(next, graph)) return read();
    if (remember) { undo.push(graph); if (undo.length > historyLimit) undo.shift(); redo.length = 0; }
    graph = next;
    revision++;
    for (const listener of listeners) {
      try { listener(read()); }
      catch (error) { console.error('A graph listener failed.', error); }
    }
    return read();
  }
  function replacement(value: unknown, expectedRevision: number, preserveEdits: boolean) {
    check(expectedRevision);
    const incoming = identifyGraph(value);
    const merged = preserveEdits ? mergeGraphUpdate(source, graph, incoming) : { graph: incoming, conflicts: [] };
    if (merged.conflicts.length) throw new GraphConflictError(revision, merged.conflicts);
    return { incoming, next: identifyGraph(merged.graph) };
  }
  return {
    read,
    getRevision: () => revision,
    acknowledge(value: unknown, expectedRevision: number) {
      check(expectedRevision);
      source = identifyGraph(value);
    },
    previewReplacement(value: unknown, expectedRevision: number, preserveEdits = true) {
      return replacement(value, expectedRevision, preserveEdits).next;
    },
    apply(operations: unknown, expectedRevision: number) {
      check(expectedRevision);
      return publish(applyGraphOperations(graph, operations));
    },
    commit(value: unknown, expectedRevision: number) {
      check(expectedRevision);
      return publish(identifyGraph(value));
    },
    replace(value: unknown, expectedRevision: number, preserveEdits = true) {
      const { incoming, next } = replacement(value, expectedRevision, preserveEdits);
      source = incoming;
      return publish(next);
    },
    undo(expectedRevision: number) {
      check(expectedRevision);
      const previous = undo.pop();
      if (!previous) return read();
      redo.push(graph);
      return publish(previous, false);
    },
    redo(expectedRevision: number) {
      check(expectedRevision);
      const next = redo.pop();
      if (!next) return read();
      undo.push(graph);
      return publish(next, false);
    },
    subscribe(listener: (snapshot: GraphSnapshot) => void) {
      listeners.add(listener);
      return () => { listeners.delete(listener); };
    },
  };
}
