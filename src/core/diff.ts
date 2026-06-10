import { ParsedGraph, ParsedNode, ParsedEdge, ParsedSubgraph } from './parse.js';
import { generateInteractiveHTML } from './html.js';
import { renderDiagram } from './render.js';

export interface NodeDiffEntry {
  id: string;
  label: string;
  status: 'added' | 'removed' | 'unchanged';
}

export interface EdgeDiffEntry {
  from: string;
  to: string;
  label?: string;
  status: 'added' | 'removed' | 'unchanged';
}

export interface SubgraphDiffEntry {
  id: string;
  label: string;
  status: 'added' | 'removed' | 'unchanged' | 'modified';
}

export interface DiagramDiff {
  nodes: NodeDiffEntry[];
  edges: EdgeDiffEntry[];
  subgraphs: SubgraphDiffEntry[];
  stats: {
    added: number;
    removed: number;
    unchanged: number;
  };
}

export function computeDiff(before: ParsedGraph, after: ParsedGraph): DiagramDiff {
  const nodes: NodeDiffEntry[] = [];
  const edges: EdgeDiffEntry[] = [];
  const subgraphs: SubgraphDiffEntry[] = [];
  
  let added = 0;
  let removed = 0;
  let unchanged = 0;

  const beforeNodeMap = new Map(before.nodes.map(n => [n.id, n]));
  const afterNodeMap = new Map(after.nodes.map(n => [n.id, n]));

  // Nodes
  for (const n of before.nodes) {
    if (!afterNodeMap.has(n.id)) {
      nodes.push({ id: n.id, label: n.label, status: 'removed' });
      removed++;
    } else {
      nodes.push({ id: n.id, label: n.label, status: 'unchanged' });
      unchanged++;
    }
  }
  for (const n of after.nodes) {
    if (!beforeNodeMap.has(n.id)) {
      nodes.push({ id: n.id, label: n.label, status: 'added' });
      added++;
    }
  }

  // Edges
  const edgeKey = (e: ParsedEdge) => `${e.from}:${e.to}:${e.label || ''}`;
  const beforeEdgeMap = new Map(before.edges.map(e => [edgeKey(e), e]));
  const afterEdgeMap = new Map(after.edges.map(e => [edgeKey(e), e]));

  for (const e of before.edges) {
    const k = edgeKey(e);
    if (!afterEdgeMap.has(k)) {
      edges.push({ from: e.from, to: e.to, label: e.label, status: 'removed' });
    } else {
      edges.push({ from: e.from, to: e.to, label: e.label, status: 'unchanged' });
    }
  }
  for (const e of after.edges) {
    const k = edgeKey(e);
    if (!beforeEdgeMap.has(k)) {
      edges.push({ from: e.from, to: e.to, label: e.label, status: 'added' });
    }
  }

  // Subgraphs
  const beforeSgMap = new Map(before.subgraphs.map(sg => [sg.id, sg]));
  const afterSgMap = new Map(after.subgraphs.map(sg => [sg.id, sg]));

  for (const sg of before.subgraphs) {
    const afterSg = afterSgMap.get(sg.id);
    if (!afterSg) {
      subgraphs.push({ id: sg.id, label: sg.label, status: 'removed' });
    } else {
      const beforeIds = new Set(sg.nodeIds);
      const afterIds = new Set(afterSg.nodeIds);
      let isModified = false;
      if (beforeIds.size !== afterIds.size) {
        isModified = true;
      } else {
        for (const id of beforeIds) {
          if (!afterIds.has(id)) {
            isModified = true;
            break;
          }
        }
      }
      subgraphs.push({ id: sg.id, label: sg.label, status: isModified ? 'modified' : 'unchanged' });
    }
  }
  for (const sg of after.subgraphs) {
    if (!beforeSgMap.has(sg.id)) {
      subgraphs.push({ id: sg.id, label: sg.label, status: 'added' });
    }
  }

  return { nodes, edges, subgraphs, stats: { added, removed, unchanged } };
}

export function generateDiffMermaid(before: ParsedGraph, diff: DiagramDiff): string {
  let out = `flowchart ${before.direction || 'LR'}\n`;

  out += `\n  classDef added fill:#10b981,stroke:#047857,stroke-width:2px,color:#ffffff;\n`;
  out += `  classDef removed fill:#ef4444,stroke:#be123c,stroke-width:2px,color:#ffffff,stroke-dasharray: 5 5;\n`;
  out += `  classDef unchanged fill:#f1f5f9,stroke:#94a3b8,color:#334155,opacity:0.6;\n`;

  // Define nodes
  for (const n of diff.nodes) {
    out += `  ${n.id}[${n.label}]\n`;
    out += `  class ${n.id} ${n.status}\n`;
  }

  // Define edges
  for (const e of diff.edges) {
    const link = e.status === 'removed' ? '-.->' : '-->';
    const label = e.label ? `|${e.status === 'added' ? '+' : ''}${e.label}|` : '';
    out += `  ${e.from} ${link}${label} ${e.to}\n`;
  }

  return out;
}

export function generateDiffHTML(
  diff: DiagramDiff,
  beforeSvg: string,
  afterSvg: string,
  options?: { theme?: string }
): string {
  // Simple side by side
  return `<!DOCTYPE html>
<html>
<head>
  <style>
    body { font-family: sans-serif; display: flex; flex-direction: column; height: 100vh; margin: 0; }
    .header { padding: 16px; background: #f8fafc; border-bottom: 1px solid #e2e8f0; display: flex; justify-content: space-between; }
    .stats span { margin-right: 16px; padding: 4px 8px; border-radius: 4px; font-weight: bold; }
    .stats .added { background: #d1fae5; color: #047857; }
    .stats .removed { background: #ffe4e6; color: #be123c; }
    .stats .unchanged { background: #f1f5f9; color: #475569; }
    .container { display: flex; flex: 1; overflow: hidden; }
    .panel { flex: 1; border-right: 1px solid #e2e8f0; position: relative; }
    .panel-title { position: absolute; top: 16px; left: 16px; background: white; padding: 8px 16px; box-shadow: 0 2px 4px rgba(0,0,0,0.1); border-radius: 4px; font-weight: bold; }
    .svg-container { width: 100%; height: 100%; overflow: auto; }
    .svg-container svg { width: 100%; height: 100%; }
  </style>
</head>
<body>
  <div class="header">
    <h2>Architecture Diff</h2>
    <div class="stats">
      <span class="added">+ ${diff.stats.added} Added</span>
      <span class="removed">- ${diff.stats.removed} Removed</span>
      <span class="unchanged">${diff.stats.unchanged} Unchanged</span>
    </div>
  </div>
  <div class="container">
    <div class="panel">
      <div class="panel-title">Before</div>
      <div class="svg-container">${beforeSvg}</div>
    </div>
    <div class="panel">
      <div class="panel-title">After</div>
      <div class="svg-container">${afterSvg}</div>
    </div>
  </div>
</body>
</html>`;
}
