import { describe, it, expect, vi } from 'vitest';
import { createGraphSession, GraphConflictError } from '../core/graph-session.js';
import type { ArchitectureGraph } from '../core/ir.js';

function fixture(): ArchitectureGraph {
  return { version: 1, direction: 'LR', groups: [{ id: 'backend', label: 'Backend', nodeIds: ['A'] }],
    nodes: [{ id: 'A', label: 'App', shape: 'rect', groupId: 'backend' }, { id: 'B', label: 'Store', shape: 'rect' }],
    edges: [{ from: 'A', to: 'B', kind: 'sync', bidirectional: false }] };
}

describe('graph sessions', () => {
  it('previews a source merge without changing the graph or its history', () => {
    const session = createGraphSession(fixture());
    const incoming = fixture(); incoming.nodes[0].label = 'Updated';
    expect(session.previewReplacement(incoming, 0).nodes[0].label).toBe('Updated');
    expect(session.read().revision).toBe(0);
    expect(session.undo(0).graph.nodes[0].label).toBe('App');
  });

  it('uses acknowledged edits as the base for later source updates', () => {
    const session = createGraphSession(fixture());
    const accepted = session.apply([{ type: 'node.update', id: 'A', changes: { label: 'Accepted' } }], 0);
    session.apply([{ type: 'node.update', id: 'B', changes: { description: 'Pending' } }], 1);
    session.acknowledge(accepted.graph, 2);
    accepted.graph.nodes[0].label = 'Remote';
    const result = session.replace(accepted.graph, 2);
    expect(result.graph.nodes[0].label).toBe('Remote');
    expect(result.graph.nodes[1].description).toBe('Pending');
  });

  it('keeps committed edits and other listeners when a listener fails', () => {
    const session = createGraphSession(fixture());
    const log = vi.spyOn(console, 'error').mockImplementation(() => {});
    const observed: number[] = [];
    try {
      session.subscribe(() => { throw new Error('Listener failed.'); });
      session.subscribe(snapshot => observed.push(snapshot.revision));
      expect(session.apply([{ type: 'node.remove', id: 'B' }], 0).revision).toBe(1);
      expect(observed).toEqual([1]);
      expect(log).toHaveBeenCalledOnce();
    } finally { log.mockRestore(); }
  });

  it('limits undo history and clears redo after a new edit', () => {
    const session = createGraphSession(fixture(), 2);
    for (let index = 0; index < 3; index++) session.apply([{ type: 'node.update', id: 'A', changes: { label: `Name ${index}` } }], index);
    session.undo(3); session.undo(4);
    expect(session.undo(5).graph.nodes[0].label).toBe('Name 0');
    session.apply([{ type: 'node.remove', id: 'B' }], 5);
    expect(session.redo(6).revision).toBe(6);
  });

  it('removes dependent connections and restores the complete graph on undo', () => {
    const session = createGraphSession(fixture());
    const initial = session.read().graph;
    session.apply([{ type: 'node.remove', id: 'A' }], 0);
    expect(session.read().graph.edges).toEqual([]);
    expect(session.read().graph.groups[0].nodeIds).toEqual([]);
    expect(session.undo(1)).toEqual({ revision: 2, graph: initial });
    expect(session.redo(2).graph.nodes.map(node => node.id)).toEqual(['B']);
  });

  it('rejects stale edits without changing state or history', () => {
    const session = createGraphSession(fixture());
    session.apply([{ type: 'node.update', id: 'A', changes: { label: 'Orders' } }], 0);
    expect(() => session.apply([{ type: 'node.remove', id: 'B' }], 0)).toThrow(GraphConflictError);
    expect(session.read().graph.nodes).toHaveLength(2);
    expect(session.undo(1).graph.nodes[0].label).toBe('App');
  });

  it('rejects an invalid batch without applying its earlier operations', () => {
    const session = createGraphSession(fixture());
    expect(() => session.apply([
      { type: 'node.update', id: 'A', changes: { label: 'Orders' } },
      { type: 'edge.add', edge: { from: 'A', to: 'missing' } },
    ], 0)).toThrow();
    expect(session.read()).toMatchObject({ revision: 0, graph: { nodes: [{ id: 'A', label: 'App' }, { id: 'B' }] } });
  });

  it('undoes groups and connection changes as one transaction', () => {
    const session = createGraphSession(fixture());
    const initial = session.read().graph;
    const edgeId = initial.edges[0].id;
    session.apply([
      { type: 'group.update', id: 'backend', label: 'Services' },
      { type: 'node.update', id: 'B', changes: { groupId: 'backend' } },
      { type: 'edge.update', id: edgeId, changes: { label: 'events', kind: 'async' } },
    ], 0);
    expect(session.read().graph.groups[0].nodeIds).toEqual(['A', 'B']);
    expect(session.undo(1).graph).toEqual(initial);
  });

  it('does not create history for an unchanged operation', () => {
    const session = createGraphSession(fixture());
    expect(session.apply([{ type: 'node.update', id: 'A', changes: { label: 'App' } }], 0).revision).toBe(0);
  });

  it('retains local edits while adding independent source changes', () => {
    const session = createGraphSession(fixture());
    session.apply([{ type: 'node.update', id: 'A', changes: { label: 'Local name' } }], 0);
    const incoming = fixture();
    incoming.nodes[1].description = 'Remote detail.';
    const result = session.replace(incoming, 1);
    expect(result.graph.nodes[0].label).toBe('Local name');
    expect(result.graph.nodes[1].description).toBe('Remote detail.');
    expect(session.undo(2).graph.nodes[0].label).toBe('Local name');
  });

  it('rejects conflicting source changes and permits an explicit replacement', () => {
    const session = createGraphSession(fixture());
    session.apply([{ type: 'node.update', id: 'A', changes: { label: 'Local name' } }], 0);
    const incoming = fixture();
    incoming.nodes[0].label = 'Remote name';
    expect(() => session.replace(incoming, 1)).toThrow(GraphConflictError);
    expect(session.read().revision).toBe(1);
    expect(session.replace(incoming, 1, false).graph.nodes[0].label).toBe('Remote name');
  });

  it('protects internal state from changes to returned snapshots', () => {
    const session = createGraphSession(fixture());
    session.read().graph.nodes[0].label = 'Mutation';
    expect(session.read().graph.nodes[0].label).toBe('App');
  });

  it('keeps parallel connections separate after saving and loading', () => {
    const graph = fixture();
    graph.edges.push({ ...graph.edges[0] });
    const first = createGraphSession(graph).read().graph;
    expect(first.edges[0].id).not.toBe(first.edges[1].id);
    expect(createGraphSession(JSON.parse(JSON.stringify(first))).read().graph).toEqual(first);
  });
});
