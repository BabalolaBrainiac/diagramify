import { describe, expect, it } from 'vitest';
import { deserializeGraph, serializeGraph, type ArchitectureGraph } from '../core/ir.js';
import { serializeGraphDocument, readGraphDocument } from '../core/graph-document.js';
import { mergeInterpretation, assessGraph } from '../core/graph-quality.js';

function fixture(): ArchitectureGraph {
  return {
    version: 1, direction: 'LR', title: 'Shop', groups: [],
    nodes: [
      { id: 'Orders', label: 'Orders', shape: 'rect', status: 'observed',
        description: 'Accepts orders.', layout: { x: 20, y: 40, width: 100, height: 50 },
        evidence: [{ source: 'src/orders.ts', hint: 'Orders' }] },
      { id: 'DB', label: 'PostgreSQL', shape: 'cylinder', serviceKey: 'postgresql' },
    ],
    edges: [{ id: 'orders_db', from: 'Orders', to: 'DB', kind: 'sync', label: 'SQL',
      bidirectional: true, points: [120, 65, 220, 65], status: 'observed',
      evidence: [{ source: 'src/orders.ts', hint: 'query' }] }],
  };
}

describe('graph documents', () => {
  it('preserves editing data through saving and loading', () => {
    expect(deserializeGraph(serializeGraphDocument(fixture()))).toEqual(fixture());
  });

  it('continues to read existing architecture baselines', () => {
    const restored = deserializeGraph(serializeGraph(fixture()));
    expect(restored.nodes.map(node => node.id)).toEqual(['DB', 'Orders']);
    expect(restored.edges).toHaveLength(1);
  });

  it.each([
    (graph: ArchitectureGraph) => graph.nodes.push({ ...graph.nodes[0] }),
    (graph: ArchitectureGraph) => { graph.edges[0].to = 'missing'; },
    (graph: ArchitectureGraph) => { graph.nodes[0].layout!.x = Infinity; },
    (graph: ArchitectureGraph) => { graph.nodes[0].groupId = 'missing'; },
    (graph: ArchitectureGraph) => { graph.edges[0].points = [1, 2, 3]; },
  ])('rejects an inconsistent document', change => {
    const graph = fixture();
    change(graph);
    expect(() => readGraphDocument(graph)).toThrow('Invalid graph document');
  });

  it('keeps existing facts when an engine omits them', () => {
    const proposal: ArchitectureGraph = { version: 1, direction: 'TD', groups: [], edges: [],
      nodes: [{ id: 'Queue', label: 'RabbitMQ', shape: 'rect', status: 'observed' }] };
    const merged = mergeInterpretation(fixture(), proposal);
    expect(merged.nodes.find(node => node.id === 'Orders')).toEqual(fixture().nodes[0]);
    expect(merged.edges).toEqual(fixture().edges);
    expect(merged.nodes.find(node => node.id === 'Queue')?.status).toBe('inferred');
  });

  it('does not let a proposal replace a different component with the same identifier', () => {
    const proposal: ArchitectureGraph = { version: 1, direction: 'LR', groups: [],
      nodes: [{ id: 'Orders', label: 'Payments', shape: 'rect' }, { id: 'Database', label: 'PostgreSQL', shape: 'rect' }],
      edges: [{ from: 'Orders', to: 'Database', kind: 'sync', bidirectional: false }] };
    const merged = mergeInterpretation(fixture(), proposal);
    expect(merged.nodes.find(node => node.id === 'Orders')?.label).toBe('Orders');
    expect(merged.nodes.find(node => node.id === 'Orders_2')?.label).toBe('Payments');
    expect(merged.edges.at(-1)).toMatchObject({ from: 'Orders_2', to: 'Database', status: 'inferred' });
    expect(merged.nodes.filter(node => node.label === 'PostgreSQL')).toHaveLength(2);
    expect(readGraphDocument(merged)).toBeDefined();
  });

  it('reports unknown connections without adding them', () => {
    const graph = fixture();
    graph.nodes.push({ id: 'Unknown', label: 'Unknown', shape: 'rect' });
    expect(assessGraph(graph).isolatedNodeIds).toEqual(['Unknown']);
    expect(graph.edges).toHaveLength(1);
  });
});
