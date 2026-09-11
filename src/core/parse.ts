import { parseMermaid } from 'beautiful-mermaid';

export interface ParsedNode {
  id: string;
  label: string;
  shape: 'rect' | 'round' | 'diamond' | 'stadium' | 'circle' | 'cylinder' | 'hexagon';
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

const SHAPE_MAP: Record<string, ParsedNode['shape']> = {
  rectangle: 'rect', rounded: 'round', diamond: 'diamond', stadium: 'stadium',
  circle: 'circle', doublecircle: 'circle', cylinder: 'cylinder', hexagon: 'hexagon', subroutine: 'stadium',
};

const STRUCTURAL_LINE = /^(flowchart|graph|subgraph|end|classDef|class|click|style|linkStyle|%%)/i;

/** Uses the renderer parser so editing and drawing share the same connections. */
export function parseMermaidSource(source: string): ParsedGraph {
  const parsed = parseMermaid(source);
  const subgraphs: ParsedSubgraph[] = [];
  function visit(groups: typeof parsed.subgraphs) {
    for (const group of groups) {
      visit(group.children);
      subgraphs.push({ id: group.id, label: group.label, nodeIds: [...group.nodeIds] });
    }
  }
  visit(parsed.subgraphs);

  const nodes: ParsedNode[] = Array.from(parsed.nodes.values(),
    (node) => ({ id: node.id, label: node.label, shape: SHAPE_MAP[node.shape] ?? 'rect' }));
  recoverDeclarationOrderLabels(nodes, source, parsed.direction);

  return {
    direction: parsed.direction === 'TB' ? 'TD' : parsed.direction,
    nodes,
    edges: parsed.edges.map(edge => ({ from: edge.source, to: edge.target, label: edge.label,
      dashed: edge.style === 'dotted', bidirectional: edge.hasArrowStart && edge.hasArrowEnd })),
    subgraphs,
  };
}

/**
 * Works around a limitation in the beautiful-mermaid parser: when an edge
 * references a node ID before that node's own shape+label declaration (for
 * example "N0 --> N1" followed later by "N0[Auth Service]"), the parser
 * registers the ID on first sight with a placeholder label equal to its own
 * ID, then keeps that placeholder — the later real declaration is dropped.
 * See registerNode() in beautiful-mermaid's src/parser.ts, which only writes
 * a node into its map the first time an ID is seen.
 *
 * This recovers the intended label without reimplementing the parser's shape
 * grammar: it re-parses each source line on its own. A line that declares a
 * node inline (whether standalone, like "N0[Auth Service]", or combined with
 * an edge, like "N0[Auth Service] --> N1[Payment Service]") always carries
 * its own label regardless of where the rest of the diagram declares things,
 * so a single-line parse recovers the real label using the same real parser.
 * Only runs when at least one node still holds a placeholder label, so a
 * source with no declaration-order issue pays no extra parsing cost.
 */
function recoverDeclarationOrderLabels(nodes: ParsedNode[], source: string, direction: string): void {
  const placeholders = new Map(nodes.filter(node => node.label === node.id).map(node => [node.id, node]));
  if (placeholders.size === 0) return;

  const header = `flowchart ${direction}`;
  for (const rawLine of source.split('\n')) {
    if (placeholders.size === 0) break;
    const line = rawLine.trim();
    if (!line || STRUCTURAL_LINE.test(line)) continue;
    let statement;
    try {
      statement = parseMermaid(`${header}\n${line}`);
    } catch {
      continue;
    }
    for (const node of statement.nodes.values()) {
      const placeholder = placeholders.get(node.id);
      if (placeholder && node.label !== node.id) {
        placeholder.label = node.label;
        placeholder.shape = SHAPE_MAP[node.shape] ?? 'rect';
        placeholders.delete(node.id);
      }
    }
  }
}
