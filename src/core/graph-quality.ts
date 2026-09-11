import type { ArchitectureGraph, IREdge } from './ir.js';

export interface GraphQuality {
  observedNodes: number;
  inferredNodes: number;
  sourcedNodes: number;
  observedEdges: number;
  inferredEdges: number;
  isolatedNodeIds: string[];
}

/** Reports evidence coverage without treating source detection as proof of runtime behavior. */
export function assessGraph(graph: ArchitectureGraph): GraphQuality {
  const connected = new Set(graph.edges.flatMap(edge => [edge.from, edge.to]));
  const observedNodes = graph.nodes.filter(node => node.status === 'observed').length;
  const observedEdges = graph.edges.filter(edge => edge.status === 'observed').length;
  return {
    observedNodes,
    inferredNodes: graph.nodes.length - observedNodes,
    sourcedNodes: graph.nodes.filter(node => node.evidence?.length).length,
    observedEdges,
    inferredEdges: graph.edges.length - observedEdges,
    isolatedNodeIds: graph.nodes.filter(node => !connected.has(node.id)).map(node => node.id),
  };
}

function nodeKey(label: string): string {
  return label.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
}

function connectionKey(edge: IREdge): string {
  return JSON.stringify([edge.from, edge.to, edge.kind, edge.label ?? '']);
}

/** Keeps source findings when an interpretation engine omits or renames them. */
export function mergeInterpretation(baseline: ArchitectureGraph, proposal: ArchitectureGraph): ArchitectureGraph {
  const result: ArchitectureGraph = JSON.parse(JSON.stringify(baseline));
  const nodesById = new Map(result.nodes.map(node => [node.id, node]));
  const aliases = new Map<string, string>();
  const groupsById = new Map(result.groups.map(group => [group.id, group]));
  for (const node of proposal.nodes) {
    const sameId = nodesById.get(node.id);
    const existing = sameId && nodeKey(sameId.label) === nodeKey(node.label) ? sameId : undefined;
    if (existing) {
      aliases.set(node.id, existing.id);
      continue;
    }
    let id = node.id;
    let suffix = 2;
    while (nodesById.has(id)) id = `${node.id}_${suffix++}`;
    aliases.set(node.id, id);
    const added = { ...node, id, status: 'inferred' as const, evidence: undefined, layout: undefined };
    if (node.groupId) {
      let group = groupsById.get(node.groupId);
      if (!group) {
        const proposed = proposal.groups.find(item => item.id === node.groupId);
        if (proposed) {
          group = { id: proposed.id, label: proposed.label, nodeIds: [] };
          result.groups.push(group);
          groupsById.set(group.id, group);
        }
      }
      if (group) group.nodeIds.push(id);
      else added.groupId = undefined;
    }
    result.nodes.push(added);
    nodesById.set(id, added);
  }
  const known = new Set(result.edges.map(connectionKey));
  for (const edge of proposal.edges) {
    const from = aliases.get(edge.from);
    const to = aliases.get(edge.to);
    if (!from || !to) continue;
    const added: IREdge = { from, to, label: edge.label, kind: edge.kind,
      bidirectional: edge.bidirectional, status: 'inferred' };
    const key = connectionKey(added);
    if (known.has(key)) continue;
    known.add(key);
    result.edges.push(added);
  }
  result.meta = { ...baseline.meta, source: proposal.meta?.source ?? 'agent' };
  return result;
}
