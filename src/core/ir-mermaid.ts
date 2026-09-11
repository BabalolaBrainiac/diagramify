/**
 * Converts between the Architecture IR and Mermaid source.
 *
 * Mermaid stays the interchange format a person can read and edit by hand.
 * It is no longer what a model writes, and no longer the internal model.
 */

import {
  canonicalLabel,
  shapeForLabel,
  type ArchitectureGraph,
  type Direction,
  type IRNode,
  type NodeShape,
  emptyGraph,
  safeId,
} from './ir.js';
import { parseMermaidSource } from './parse.js';

const SHAPE_WRAPPERS: Record<NodeShape, [string, string]> = {
  rect: ['[', ']'],
  round: ['(', ')'],
  stadium: ['([', '])'],
  cylinder: ['[(', ')]'],
  circle: ['((', '))'],
  diamond: ['{', '}'],
  hexagon: ['{{', '}}'],
};

/**
 * Escapes a label for Mermaid.
 *
 * A bracket or a quote in a label breaks the parser. Mermaid accepts a quoted
 * label, and `#quot;` for a quote inside one.
 */
export function escapeLabel(label: string): string {
  const cleaned = label.replace(/"/g, '#quot;').trim();
  // Quote whenever a character could close the shape wrapper early.
  if (/[[\]{}()<>|"#]/.test(label)) {
    return `"${cleaned}"`;
  }
  return cleaned;
}

/**
 * Reverses `escapeLabel`.
 *
 * Without this, reading Mermaid back and writing it again escapes the label a
 * second time, and `#quot;` leaks into the drawing.
 */
export function unescapeLabel(label: string): string {
  let value = label.trim();

  // A file written by an older build can hold more than one layer of escaping,
  // so peel until the value stops changing.
  for (let guard = 0; guard < 8; guard += 1) {
    const before = value;

    if (value.length > 1 && value.startsWith('"') && value.endsWith('"')) {
      value = value.slice(1, -1).trim();
    }
    value = value.replace(/#quot;/g, '"').trim();

    if (value === before) {
      break;
    }
  }

  return value;
}

function renderNode(node: IRNode): string {
  const [open, close] = SHAPE_WRAPPERS[node.shape] ?? SHAPE_WRAPPERS.rect;
  return `${node.id}${open}${escapeLabel(node.label)}${close}`;
}

/** Writes Mermaid flowchart source from the graph. */
export function graphToMermaid(
  graph: ArchitectureGraph,
  options: { includeInit?: boolean } = {},
): string {
  const lines: string[] = [];

  if (options.includeInit !== false) {
    lines.push('%%{init: {"flowchart": {"nodeSpacing": 40, "rankSpacing": 70, "curve": "basis"}}}%%');
  }

  lines.push(`flowchart ${graph.direction}`);

  const grouped = new Set<string>();

  for (const group of graph.groups) {
    const members = group.nodeIds
      .map((id) => graph.nodes.find((n) => n.id === id))
      .filter((n): n is IRNode => Boolean(n));

    if (members.length === 0) {
      continue;
    }

    lines.push(`    subgraph ${group.id} [${escapeLabel(group.label)}]`);
    for (const node of members) {
      lines.push(`        ${renderNode(node)}`);
      grouped.add(node.id);
    }
    lines.push('    end');
  }

  for (const node of graph.nodes) {
    if (!grouped.has(node.id)) {
      lines.push(`    ${renderNode(node)}`);
    }
  }

  for (const edge of graph.edges) {
    const connector = edge.kind === 'async' ? '-.->' : '-->';
    const label = edge.label ? `|${escapeLabel(edge.label)}|` : '';
    lines.push(`    ${edge.from} ${connector}${label} ${edge.to}`);
  }

  return lines.join('\n');
}

/**
 * Reads Mermaid source back into the IR.
 *
 * This keeps a hand-written `.mmd` file a first-class input, so every exporter
 * works on a file that Diagramify did not generate.
 */
export function mermaidToGraph(source: string, title?: string): ArchitectureGraph {
  const parsed = parseMermaidSource(source);
  const graph = emptyGraph(parsed.direction as Direction);
  graph.title = title;

  const groupOf = new Map<string, string>();
  for (const subgraph of parsed.subgraphs) {
    const id = safeId(subgraph.id, 'g');
    graph.groups.push({ id, label: unescapeLabel(subgraph.label), nodeIds: [] });
    for (const nodeId of subgraph.nodeIds) {
      groupOf.set(nodeId, id);
    }
  }

  for (const node of parsed.nodes) {
    const groupId = groupOf.get(node.id);
    const label = canonicalLabel(unescapeLabel(node.label || node.id));
    graph.nodes.push({
      id: node.id,
      label,
      // A store keeps its cylinder however the source drew it.
      shape: shapeForLabel(label, toIRShape(node.shape)),
      groupId,
    });
    if (groupId) {
      graph.groups.find((g) => g.id === groupId)?.nodeIds.push(node.id);
    }
  }

  for (const edge of parsed.edges) {
    graph.edges.push({
      from: edge.from,
      to: edge.to,
      label: edge.label ? unescapeLabel(edge.label) : undefined,
      kind: edge.dashed ? 'async' : 'sync',
      bidirectional: edge.bidirectional,
    });
  }

  graph.groups = graph.groups.filter((g) => g.nodeIds.length > 0);
  return graph;
}

function toIRShape(shape: string): NodeShape {
  switch (shape) {
    case 'round':
      return 'round';
    case 'stadium':
      return 'stadium';
    case 'circle':
      return 'circle';
    case 'diamond':
      return 'diamond';
    case 'cylinder':
      return 'cylinder';
    case 'hexagon':
      return 'hexagon';
    default:
      return 'rect';
  }
}
