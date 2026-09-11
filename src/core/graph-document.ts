import { z } from 'zod';
import type { ArchitectureGraph } from './ir.js';

export const nodeShapeSchema = z.enum(['rect', 'round', 'stadium', 'cylinder', 'circle', 'diamond', 'hexagon']);

const identifier = z.string().regex(/^[A-Za-z_][A-Za-z0-9_]*$/);
const optionalText = z.string().nullish().transform(value => value ?? undefined);
const status = z.enum(['observed', 'inferred', 'proposed']).optional();
const evidence = z.array(z.object({ source: z.string().min(1), hint: z.string().optional() })).optional();
const layout = z.object({
  x: z.number().finite(), y: z.number().finite(),
  width: z.number().finite().nonnegative(), height: z.number().finite().nonnegative(),
});

export const graphDocumentSchema = z.object({
  version: z.literal(1),
  title: optionalText,
  direction: z.enum(['TD', 'LR', 'BT', 'RL']).default('LR'),
  nodes: z.array(z.object({
    id: identifier,
    label: z.string().min(1),
    shape: nodeShapeSchema.default('rect'),
    groupId: optionalText,
    serviceType: z.enum([
      'compute', 'database', 'cache', 'messaging', 'storage', 'monitoring', 'devops',
      'network', 'auth', 'ai', 'ml', 'ui', 'middleware', 'analytics', 'security', 'other',
    ]).nullish().transform(value => value ?? undefined),
    serviceKey: optionalText,
    description: optionalText,
    layout: layout.optional(),
    status,
    evidence,
  })),
  edges: z.array(z.object({
    id: identifier.optional(),
    from: identifier,
    to: identifier,
    label: optionalText,
    kind: z.enum(['sync', 'async']).default('sync'),
    bidirectional: z.boolean().default(false),
    points: z.array(z.number().finite()).refine(value => value.length >= 4 && value.length % 2 === 0).optional(),
    status,
    evidence,
  })),
  groups: z.array(z.object({ id: identifier, label: z.string().min(1), nodeIds: z.array(identifier) })).default([]),
  meta: z.object({
    source: optionalText, language: optionalText, framework: optionalText, generatedAt: optionalText,
  }).optional(),
}).superRefine((graph, ctx) => {
  const fail = (message: string) => ctx.addIssue({ code: z.ZodIssueCode.custom, message });
  const nodeIds = new Set(graph.nodes.map(node => node.id));
  const groupIds = new Set(graph.groups.map(group => group.id));
  if (nodeIds.size !== graph.nodes.length) fail('Node identifiers must be unique.');
  if (groupIds.size !== graph.groups.length) fail('Group identifiers must be unique.');
  const edgeIds = graph.edges.flatMap(edge => edge.id ? [edge.id] : []);
  if (new Set(edgeIds).size !== edgeIds.length) fail('Connection identifiers must be unique.');
  for (const edge of graph.edges) {
    if (!nodeIds.has(edge.from) || !nodeIds.has(edge.to)) fail('A connection references a missing node.');
  }
  const owners = new Map<string, string>();
  for (const group of graph.groups) {
    for (const id of group.nodeIds) {
      if (!nodeIds.has(id)) fail('A group references a missing node.');
      if (owners.has(id)) fail('A node has more than one group membership.');
      owners.set(id, group.id);
    }
  }
  for (const node of graph.nodes) {
    if (node.groupId && !groupIds.has(node.groupId)) fail('A node references a missing group.');
    if (node.groupId && owners.get(node.id) !== node.groupId) fail('Group membership is inconsistent.');
    if (!node.groupId && owners.has(node.id)) node.groupId = owners.get(node.id);
  }
});

/** Validates complete documents and legacy architecture baselines. */
export function readGraphDocument(value: unknown): ArchitectureGraph {
  const result = graphDocumentSchema.safeParse(value);
  if (!result.success) {
    throw new Error('Invalid graph document. Check identifiers, field types, connections, and group membership.');
  }
  return result.data;
}

/** Keeps editing data separate from the reduced representation used for architecture comparison. */
export function serializeGraphDocument(graph: ArchitectureGraph): string {
  const document = readGraphDocument(graph);
  return `${JSON.stringify(document, null, 2)}\n`;
}
