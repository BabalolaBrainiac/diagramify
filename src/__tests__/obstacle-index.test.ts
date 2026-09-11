import { describe, expect, it } from 'vitest';
import { createObstacleIndex } from '../viewer/geometry.js';
import { createGraphSession } from '../core/graph-session.js';

describe('obstacle queries', () => {
  it('matches exhaustive intersection checks across negative coordinates and cell boundaries', () => {
    const boxes = Array.from({ length: 250 }, (_, i) => ({ left: i % 10 * 160 - 500, right: i % 10 * 160 - 320,
      top: Math.floor(i / 10) * 50 - 100, bottom: Math.floor(i / 10) * 50 - 60 }));
    const index = createObstacleIndex(boxes);
    for (const [left, top, right, bottom] of [[-500,-100,0,0], [160,160,160,160], [-1e6,-1e6,1e6,1e6], [0,0,600,900]]) {
      const expected = boxes.filter(b => b.left <= right && b.right >= left && b.top <= bottom && b.bottom >= top);
      expect(new Set(index.query(left, top, right, bottom))).toEqual(new Set(expected));
    }
  });

  it('reads revisions without exposing mutable session state', () => {
    const session = createGraphSession({ version: 1, direction: 'LR', groups: [], edges: [], nodes: [{ id: 'A', label: 'App', shape: 'rect' }] });
    expect(session.getRevision()).toBe(0);
    const snapshot = session.read(); snapshot.graph.nodes[0].label = 'External';
    expect(session.read().graph.nodes[0].label).toBe('App');
    session.apply([{ type: 'node.update', id: 'A', changes: { label: 'Changed' } }], session.getRevision());
    expect(session.getRevision()).toBe(1);
    session.undo(session.getRevision());
    expect(session.getRevision()).toBe(2);
    expect(session.read().graph.nodes[0].label).toBe('App');
  });
});
