/**
 * The Architecture IR: one typed graph that every part of Diagramify shares.
 *
 * Before this type existed, the pipeline built a structured analysis, flattened
 * it into English prose, asked a model to rebuild it as Mermaid text, then
 * repaired the text with regular expressions. The structure was built, thrown
 * away, and guessed back.
 *
 * The IR removes that hop:
 * - `analyze` fills the IR with no model at all.
 * - A model fills the IR through a schema, so any provider gives the same shape.
 * - Every renderer reads the IR: Mermaid, SVG, HTML, PNG, PDF, draw.io, Excalidraw.
 */

import { z } from 'zod';
import { getServiceDefinition, type ServiceType } from '../icons/services.js';
import { nodeShapeSchema, readGraphDocument } from './graph-document.js';
export { nodeShapeSchema } from './graph-document.js';

export type Direction = 'TD' | 'LR' | 'BT' | 'RL';

export type NodeShape =
  | 'rect'
  | 'round'
  | 'stadium'
  | 'cylinder'
  | 'circle'
  | 'diamond'
  | 'hexagon';

export type EdgeKind = 'sync' | 'async';

export type ClaimStatus = 'observed' | 'inferred' | 'proposed';

export interface SourceReference {
  source: string;
  hint?: string;
}

/** Pixel geometry taken from a rendered diagram. A format such as Excalidraw needs it. */
export interface NodeLayout {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface IRNode {
  /** Stable identifier. Alphanumeric and underscore only, so Mermaid accepts it. */
  id: string;
  /** The name a reader sees. Use the real product name, such as `PostgreSQL`. */
  label: string;
  shape: NodeShape;
  /** Drives icon and color selection. Left undefined when nothing matched. */
  serviceType?: ServiceType;
  /** The registry key for an icon, when the label matched a known service. */
  serviceKey?: string;
  /** Identifier of the group that holds this node. */
  groupId?: string;
  /** Free-form detail shown in the viewer's detail panel. */
  description?: string;
  /** Filled after rendering. Absent before layout runs. */
  layout?: NodeLayout;
  status?: ClaimStatus;
  evidence?: SourceReference[];
}

export interface IREdge {
  id?: string;
  from: string;
  to: string;
  /** What crosses the edge, such as `REST`, `SQL`, or `events`. */
  label?: string;
  kind: EdgeKind;
  bidirectional: boolean;
  /** Filled after rendering, as a flat list of x and y pairs. */
  points?: number[];
  status?: ClaimStatus;
  evidence?: SourceReference[];
}

export interface IRGroup {
  id: string;
  label: string;
  nodeIds: string[];
}

export interface ArchitectureGraph {
  /** Schema version. A consumer checks this before it reads the graph. */
  version: 1;
  title?: string;
  direction: Direction;
  nodes: IRNode[];
  edges: IREdge[];
  groups: IRGroup[];
  meta?: {
    /** `analyzer` when no model ran. Otherwise the provider name. */
    source?: string;
    language?: string;
    framework?: string;
    generatedAt?: string;
  };
}

/* ────────────────────────────────────────────────────────────────────────────
 * Schema for constrained model output
 *
 * The model fills this shape instead of writing text. Every provider that
 * supports structured output returns the same result, so provider choice stops
 * changing quality. The schema stays deliberately small: layout, icons, and
 * colors are decided by code, never by the model.
 * ──────────────────────────────────────────────────────────────────────────── */

export const architectureGraphSchema = z.object({
  title: z.string().describe('Short title for the diagram.').optional(),
  direction: z
    .enum(['TD', 'LR', 'BT', 'RL'])
    .describe('Layout direction. Use LR for a wide system, TD for a layered one.'),
  groups: z
    .array(
      z.object({
        id: z.string().describe('Identifier. Alphanumeric and underscore only.'),
        label: z.string().describe('Group name a reader sees, such as "Data Layer".'),
      }),
    )
    .describe('Logical tiers, such as Frontend, Backend Services, Data Layer.'),
  nodes: z
    .array(
      z.object({
        id: z.string().describe('Identifier. Alphanumeric and underscore only.'),
        label: z
          .string()
          .describe('The real product name, such as "PostgreSQL", never "Database".'),
        shape: nodeShapeSchema.describe('Use "rect" unless another shape adds meaning.'),
        groupId: z.string().describe('Identifier of the owning group, or an empty string.'),
        description: z
          .string()
          .describe('One short sentence on what this component does. May be empty.'),
      }),
    )
    .describe('Components supported by the supplied evidence. Do not target a node count.'),
  edges: z
    .array(
      z.object({
        from: z.string().describe('Source node id.'),
        to: z.string().describe('Target node id.'),
        label: z
          .string()
          .describe('What crosses the edge: REST, gRPC, SQL, events, OIDC. May be empty.'),
        kind: z
          .enum(['sync', 'async'])
          .describe('Use "async" for a queue, an event, or a webhook.'),
      }),
    )
    .describe('Relationships supported by evidence. An unknown relationship must remain absent.'),
});

export type ArchitectureGraphInput = z.infer<typeof architectureGraphSchema>;

/* ────────────────────────────────────────────────────────────────────────────
 * Construction and repair
 * ──────────────────────────────────────────────────────────────────────────── */

/**
 * A store, cache, or queue reads as a cylinder whatever the model chose.
 *
 * A model picks a shape inconsistently, so the same Redis is a hexagon in one
 * diagram and a box in the next. Shape carries meaning, so code decides it.
 */
const SHAPE_BY_SERVICE_TYPE: Partial<Record<ServiceType, NodeShape>> = {
  database: 'cylinder',
  storage: 'cylinder',
  cache: 'cylinder',
};

export function shapeForLabel(label: string, requested: NodeShape): NodeShape {
  const definition = getServiceDefinition(label);
  if (definition.name.toLowerCase() === 'service') {
    return requested;
  }
  return SHAPE_BY_SERVICE_TYPE[definition.type] ?? requested;
}

/**
 * Restores the canonical product name for a known service.
 *
 * A model returns `postgresql` or `openai` as readily as `PostgreSQL` or
 * `OpenAI`. The registry already holds the right spelling, and matching it also
 * makes the icon and the colour resolve.
 */
export function canonicalLabel(raw: string): string {
  const label = raw.trim();
  if (!label) {
    return label;
  }

  const definition = getServiceDefinition(label);
  if (definition.name.toLowerCase() === 'service') {
    return label;
  }

  // Only correct the spelling. A label the author wrote differently on purpose,
  // such as "Orders PostgreSQL", keeps its own wording.
  return definition.name.toLowerCase() === label.toLowerCase() ? definition.name : label;
}

/** Makes an identifier that Mermaid accepts. */
export function safeId(raw: string, fallback = 'n'): string {
  const cleaned = raw.replace(/[^a-zA-Z0-9_]/g, '_').replace(/^_+|_+$/g, '');
  if (cleaned === '' || /^[0-9]/.test(cleaned)) {
    return `${fallback}_${cleaned || '0'}`;
  }
  return cleaned;
}

export function emptyGraph(direction: Direction = 'LR'): ArchitectureGraph {
  return { version: 1, direction, nodes: [], edges: [], groups: [] };
}

/**
 * Turns model output into a valid graph.
 *
 * A model can still name a node that does not exist, repeat an id, or leave a
 * node unconnected. Repair happens here once, so no renderer has to cope with
 * a broken graph.
 */
export function normalizeGraph(
  input: ArchitectureGraphInput,
  meta?: ArchitectureGraph['meta'],
): ArchitectureGraph {
  const groups: IRGroup[] = [];
  const groupIds = new Set<string>();

  for (const group of input.groups ?? []) {
    const id = safeId(group.id, 'g');
    if (id === '' || groupIds.has(id)) {
      continue;
    }
    groupIds.add(id);
    groups.push({ id, label: group.label?.trim() || id, nodeIds: [] });
  }

  const nodes: IRNode[] = [];
  const nodeIds = new Set<string>();
  // A model sometimes writes the original id in an edge. Keep a map back.
  const idAlias = new Map<string, string>();

  for (const node of input.nodes ?? []) {
    const id = safeId(node.id, 'n');
    if (id === '' || nodeIds.has(id)) {
      continue;
    }
    nodeIds.add(id);
    idAlias.set(node.id, id);
    idAlias.set(id, id);

    const groupId = node.groupId ? safeId(node.groupId, 'g') : undefined;
    const resolvedGroup = groupId && groupIds.has(groupId) ? groupId : undefined;

    nodes.push({
      id,
      label: canonicalLabel(node.label ?? '') || id,
      shape: shapeForLabel(node.label ?? '', node.shape ?? 'rect'),
      groupId: resolvedGroup,
      description: node.description?.trim() || undefined,
    });

    if (resolvedGroup) {
      groups.find((g) => g.id === resolvedGroup)?.nodeIds.push(id);
    }
  }

  const edges: IREdge[] = [];
  const seenEdges = new Set<string>();

  for (const edge of input.edges ?? []) {
    const from = idAlias.get(edge.from) ?? safeId(edge.from, 'n');
    const to = idAlias.get(edge.to) ?? safeId(edge.to, 'n');

    // Drop an edge that names a node the graph does not hold.
    if (!nodeIds.has(from) || !nodeIds.has(to) || from === to) {
      continue;
    }

    const key = `${from}>${to}>${edge.label ?? ''}`;
    if (seenEdges.has(key)) {
      continue;
    }
    seenEdges.add(key);

    edges.push({
      from,
      to,
      label: edge.label?.trim() || undefined,
      kind: edge.kind === 'async' ? 'async' : 'sync',
      bidirectional: false,
    });
  }

  // Drop an empty group so no renderer draws an empty box.
  const usedGroups = groups.filter((g) => g.nodeIds.length > 0);

  return {
    version: 1,
    title: input.title?.trim() || undefined,
    direction: input.direction ?? 'LR',
    nodes,
    edges,
    groups: usedGroups,
    meta: { generatedAt: new Date().toISOString(), ...meta },
  };
}

/** Reports what is wrong with a graph. An empty list means the graph is usable. */
export function validateGraph(graph: ArchitectureGraph): string[] {
  const problems: string[] = [];
  const ids = new Set(graph.nodes.map((n) => n.id));

  if (graph.nodes.length === 0) {
    problems.push('The graph holds no nodes.');
  }

  for (const edge of graph.edges) {
    if (!ids.has(edge.from)) {
      problems.push(`Edge source "${edge.from}" is not a node.`);
    }
    if (!ids.has(edge.to)) {
      problems.push(`Edge target "${edge.to}" is not a node.`);
    }
  }

  if (ids.size !== graph.nodes.length) problems.push('Node identifiers must be unique.');

  return problems;
}

/* ────────────────────────────────────────────────────────────────────────────
 * Stable serialization
 *
 * The CI drift gate compares two graphs. Key order must not change the result,
 * so every list is sorted and every object is written with fixed key order.
 * ──────────────────────────────────────────────────────────────────────────── */

/** Writes the graph as JSON with a stable order, and without layout or timestamps. */
export function serializeGraph(graph: ArchitectureGraph): string {
  const canonical = {
    version: graph.version,
    title: graph.title ?? null,
    direction: graph.direction,
    groups: [...graph.groups]
      .sort((a, b) => a.id.localeCompare(b.id))
      .map((g) => ({
        id: g.id,
        label: g.label,
        nodeIds: [...g.nodeIds].sort((a, b) => a.localeCompare(b)),
      })),
    nodes: [...graph.nodes]
      .sort((a, b) => a.id.localeCompare(b.id))
      .map((n) => ({
        id: n.id,
        label: n.label,
        shape: n.shape,
        groupId: n.groupId ?? null,
        serviceType: n.serviceType ?? null,
      })),
    edges: [...graph.edges]
      .sort((a, b) => `${a.from}>${a.to}>${a.label ?? ''}`.localeCompare(`${b.from}>${b.to}>${b.label ?? ''}`))
      .map((e) => ({
        from: e.from,
        to: e.to,
        label: e.label ?? null,
        kind: e.kind,
      })),
  };

  return `${JSON.stringify(canonical, null, 2)}\n`;
}

export function deserializeGraph(json: string): ArchitectureGraph {
  const raw = JSON.parse(json);
  if (raw?.version !== 1) {
    throw new Error(`Unsupported IR version: ${raw?.version}. This build reads version 1.`);
  }

  return readGraphDocument(raw);
}
