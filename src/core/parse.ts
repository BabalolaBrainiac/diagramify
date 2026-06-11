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

  const addNode = (nodeId: string, label: string, shape: ParsedNode['shape']) => {
    if (!nodeMap.has(nodeId)) {
      const node: ParsedNode = { id: nodeId, label, shape };
      nodes.push(node);
      nodeMap.set(nodeId, node);
      if (subgraphStack.length > 0) {
        subgraphStack[subgraphStack.length - 1].nodeIds.push(nodeId);
      }
    }
  };

  const extractNodesAndEdges = (line: string) => {
    // First extract edges to get node references, then extract nodes
    // Pattern: nodeId[label] --> nodeId[label] or nodeId -->|label| nodeId
    const edgePattern = /([a-zA-Z0-9_-]+)(?:\[[^\]]+\]|\([^)]+\)|\{[^}]+\})?\s*(?:-\.->|-->|<-->)\s*(?:\|([^|]+)\|)?\s*([a-zA-Z0-9_-]+)(?:\[[^\]]+\]|\([^)]+\)|\{[^}]+\})?/g;

    for (const match of line.matchAll(edgePattern)) {
      const from = match[1];
      const label = match[2];
      const to = match[3];
      const dashed = match[0].includes('-.-');
      const bidirectional = match[0].startsWith('<');

      if (from && to && from !== to) {
        edges.push({
          from,
          to,
          label: label ? label.trim() : undefined,
          dashed,
          bidirectional
        });
      }
    }

    // Extract nodes from the line (can have multiple)
    const nodePatterns = [
      { regex: /([a-zA-Z0-9_-]+)\[\[(.*?)\]\]/g, shape: 'stadium' as const },
      { regex: /([a-zA-Z0-9_-]+)\(\((.*?)\)\)/g, shape: 'circle' as const },
      { regex: /([a-zA-Z0-9_-]+)\[\(.*?\)\]/g, shape: 'stadium' as const },
      { regex: /([a-zA-Z0-9_-]+)\{(.*?)\}/g, shape: 'diamond' as const },
      { regex: /([a-zA-Z0-9_-]+)\[(.*?)\]/g, shape: 'rect' as const },
      { regex: /([a-zA-Z0-9_-]+)\((.*?)\)/g, shape: 'round' as const },
    ];

    for (const { regex, shape } of nodePatterns) {
      let match;
      while ((match = regex.exec(line)) !== null) {
        addNode(match[1], match[2], shape);
      }
    }
  };

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

    extractNodesAndEdges(line);
  }

  return {
    direction,
    nodes,
    edges,
    subgraphs,
  };
}
