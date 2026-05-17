export interface ParsedNode {
  id: string;
  label: string;
  shape: 'rect' | 'round' | 'diamond' | 'stadium' | 'circle';
}

export interface ParsedEdge {
  from: string;
  to: string;
  label?: string;
  dashed: boolean;
  bidirectional: boolean;
}

export interface ParsedSubgraph {
  id: string;
  label: string;
  nodeIds: string[];
}

export interface ParsedGraph {
  direction: 'TD' | 'LR' | 'BT' | 'RL';
  nodes: ParsedNode[];
  edges: ParsedEdge[];
  subgraphs: ParsedSubgraph[];
}

export function parseMermaidSource(source: string): ParsedGraph {
  const lines = source.split('\n').map(l => l.trim()).filter(l => l);

  let direction: 'TD' | 'LR' | 'BT' | 'RL' = 'TD';
  const nodes: ParsedNode[] = [];
  const edges: ParsedEdge[] = [];
  const subgraphs: ParsedSubgraph[] = [];
  const nodeMap = new Map<string, ParsedNode>();
  const subgraphStack: { id: string; label: string; nodeIds: string[] }[] = [];
  const idToNodeMap = new Map<string, string>();

  for (const line of lines) {
    const dirMatch = line.match(/^(?:flowchart|graph)\s+([TDLRBF]+)/i);
    if (dirMatch) {
      const dir = dirMatch[1].toUpperCase();
      if (['TD', 'LR', 'BT', 'RL'].includes(dir)) {
        direction = dir as 'TD' | 'LR' | 'BT' | 'RL';
      }
      continue;
    }

    const subgraphStartMatch = line.match(/^subgraph\s+([a-zA-Z0-9_-]+)(?:\s+\[([^\]]+)\])?/);
    if (subgraphStartMatch) {
      const subgraphId = subgraphStartMatch[1];
      const subgraphLabel = subgraphStartMatch[2] || subgraphId;
      subgraphStack.push({ id: subgraphId, label: subgraphLabel, nodeIds: [] });
      continue;
    }

    if (line === 'end') {
      if (subgraphStack.length > 0) {
        const completed = subgraphStack.pop()!;
        subgraphs.push({
          id: completed.id,
          label: completed.label,
          nodeIds: completed.nodeIds,
        });
      }
      continue;
    }

    const nodeMatch = line.match(/^([a-zA-Z0-9_-]+)\[(.*?)\]/);
    if (nodeMatch) {
      const nodeId = nodeMatch[1];
      const label = nodeMatch[2];
      const shape: 'rect' = 'rect';
      const node: ParsedNode = { id: nodeId, label, shape };
      nodes.push(node);
      nodeMap.set(nodeId, node);
      idToNodeMap.set(nodeId, label);
      if (subgraphStack.length > 0) {
        subgraphStack[subgraphStack.length - 1].nodeIds.push(nodeId);
      }
      continue;
    }

    const circleNodeMatch = line.match(/^([a-zA-Z0-9_-]+)\(\((.*?)\)\)/);
    if (circleNodeMatch) {
      const nodeId = circleNodeMatch[1];
      const label = circleNodeMatch[2];
      const shape: 'circle' = 'circle';
      const node: ParsedNode = { id: nodeId, label, shape };
      nodes.push(node);
      nodeMap.set(nodeId, node);
      idToNodeMap.set(nodeId, label);
      if (subgraphStack.length > 0) {
        subgraphStack[subgraphStack.length - 1].nodeIds.push(nodeId);
      }
      continue;
    }

    const stadiumNodeMatch = line.match(/^([a-zA-Z0-9_-]+)\(\[(.*?)\]\)/);
    if (stadiumNodeMatch) {
      const nodeId = stadiumNodeMatch[1];
      const label = stadiumNodeMatch[2];
      const shape: 'stadium' = 'stadium';
      const node: ParsedNode = { id: nodeId, label, shape };
      nodes.push(node);
      nodeMap.set(nodeId, node);
      idToNodeMap.set(nodeId, label);
      if (subgraphStack.length > 0) {
        subgraphStack[subgraphStack.length - 1].nodeIds.push(nodeId);
      }
      continue;
    }

    const roundNodeMatch = line.match(/^([a-zA-Z0-9_-]+)\((.*?)\)/);
    if (roundNodeMatch) {
      const nodeId = roundNodeMatch[1];
      const label = roundNodeMatch[2];
      const shape: 'round' = 'round';
      const node: ParsedNode = { id: nodeId, label, shape };
      nodes.push(node);
      nodeMap.set(nodeId, node);
      idToNodeMap.set(nodeId, label);
      if (subgraphStack.length > 0) {
        subgraphStack[subgraphStack.length - 1].nodeIds.push(nodeId);
      }
      continue;
    }

    const diamondNodeMatch = line.match(/^([a-zA-Z0-9_-]+)\{(.*?)\}/);
    if (diamondNodeMatch) {
      const nodeId = diamondNodeMatch[1];
      const label = diamondNodeMatch[2];
      const shape: 'diamond' = 'diamond';
      const node: ParsedNode = { id: nodeId, label, shape };
      nodes.push(node);
      nodeMap.set(nodeId, node);
      idToNodeMap.set(nodeId, label);
      if (subgraphStack.length > 0) {
        subgraphStack[subgraphStack.length - 1].nodeIds.push(nodeId);
      }
      continue;
    }

    const edgeMatch = line.match(
      /^([a-zA-Z0-9_-]+)\s*(<)?(?:\-\.->|-->|<-->)\s*(\|.*?\|)?\s*([a-zA-Z0-9_-]+)$/
    );
    if (edgeMatch) {
      const from = edgeMatch[1];
      const bidirectional = Boolean(edgeMatch[2]);
      const labelPart = edgeMatch[3];
      const to = edgeMatch[4];
      const label = labelPart ? labelPart.slice(1, -1) : undefined;
      const dashed = line.includes('-.-');

      edges.push({ from, to, label, dashed, bidirectional });
      continue;
    }

    const edgeWithLabelMatch = line.match(
      /^([a-zA-Z0-9_-]+)\s*(?:\-\.->|-->|<-->)\s*\|([^|]+)\|\s*([a-zA-Z0-9_-]+)$/
    );
    if (edgeWithLabelMatch) {
      const from = edgeWithLabelMatch[1];
      const label = edgeWithLabelMatch[2];
      const to = edgeWithLabelMatch[3];
      const dashed = line.includes('-.-');

      edges.push({ from, to, label, dashed, bidirectional: false });
      continue;
    }

    const edgeWithSpaceMatch = line.match(
      /^([a-zA-Z0-9_-]+)\s*--\s*([^-]+)\s*-->\s*([a-zA-Z0-9_-]+)$/
    );
    if (edgeWithSpaceMatch) {
      const from = edgeWithSpaceMatch[1];
      const label = edgeWithSpaceMatch[2];
      const to = edgeWithSpaceMatch[3];

      edges.push({ from, to, label, dashed: false, bidirectional: false });
    }
  }

  return {
    direction,
    nodes,
    edges,
    subgraphs,
  };
}
