import type { ParsedGraph, ParsedEdge } from './parse.js';

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
  const dark = options?.theme === 'dark';
  return `<!DOCTYPE html>
<html lang="en"${dark ? ' data-theme="dark"' : ''}>
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Architecture Diff</title>
  <style>
    :root {
      --bg: #f8fafc; --surface: #ffffff; --text: #0f172a; --muted: #475569; --border: #e2e8f0;
      --add-bg: #dcfce7; --add-fg: #166534; --rem-bg: #fee2e2; --rem-fg: #991b1b;
    }
    html[data-theme="dark"] {
      --bg: #0a0a0f; --surface: #15151f; --text: #e2e8f0; --muted: #94a3b8; --border: #27273a;
      --add-bg: rgba(34,197,94,0.16); --add-fg: #86efac; --rem-bg: rgba(239,68,68,0.16); --rem-fg: #fca5a5;
    }
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body { font-family: system-ui, -apple-system, sans-serif; background: var(--bg); color: var(--text); display: flex; flex-direction: column; height: 100vh; }
    .header { padding: 12px 20px; background: var(--surface); border-bottom: 1px solid var(--border); display: flex; align-items: center; justify-content: space-between; gap: 12px; flex-wrap: wrap; }
    .header h2 { font-size: 15px; font-weight: 600; letter-spacing: -0.01em; }
    .stats { display: flex; gap: 8px; flex-wrap: wrap; }
    .stats span { padding: 4px 10px; border-radius: 99px; font-size: 12px; font-weight: 600; }
    .stats .added { background: var(--add-bg); color: var(--add-fg); }
    .stats .removed { background: var(--rem-bg); color: var(--rem-fg); }
    .stats .unchanged { background: color-mix(in srgb, var(--text) 8%, transparent); color: var(--muted); }
    .container { display: flex; flex: 1; min-height: 0; }
    .panel { flex: 1; min-width: 0; border-right: 1px solid var(--border); position: relative; display: flex; flex-direction: column; }
    .panel:last-child { border-right: none; }
    .panel-title { padding: 8px 14px; border-bottom: 1px solid var(--border); background: var(--surface); font-size: 12px; font-weight: 600; color: var(--muted); text-transform: uppercase; letter-spacing: 0.04em; }
    .svg-container { flex: 1; overflow: auto; padding: 16px; }
    .svg-container svg { max-width: 100%; height: auto; display: block; margin: 0 auto; }
    @media (max-width: 768px) { .container { flex-direction: column; } .panel { border-right: none; border-bottom: 1px solid var(--border); } }
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
