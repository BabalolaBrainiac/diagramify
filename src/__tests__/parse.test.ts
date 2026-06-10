import { describe, it, expect } from 'vitest';
import { parseMermaidSource } from '../core/parse.js';

describe('parseMermaidSource', () => {
  it('parses basic node definitions', () => {
    const source = `flowchart TD
      A[Node A]
      B(Node B)
      C{Node C}`;

    const result = parseMermaidSource(source);

    expect(result.nodes).toHaveLength(3);
    expect(result.nodes[0]).toMatchObject({ id: 'A', label: 'Node A', shape: 'rect' });
    expect(result.nodes[1]).toMatchObject({ id: 'B', label: 'Node B', shape: 'round' });
    expect(result.nodes[2]).toMatchObject({ id: 'C', label: 'Node C', shape: 'diamond' });
  });

  it('parses edges with labels', () => {
    const source = `flowchart TD
      A[Source] --> B[Target]
      B -->|REST| C[Destination]`;

    const result = parseMermaidSource(source);

    expect(result.edges).toHaveLength(2);
    expect(result.edges[0]).toMatchObject({
      from: 'A',
      to: 'B',
      dashed: false,
    });
    expect(result.edges[1]).toMatchObject({
      from: 'B',
      to: 'C',
      label: 'REST',
      dashed: false,
    });
  });

  it('parses dashed edges', () => {
    const source = `flowchart TD
      A[Source] -.-> B[Target]`;

    const result = parseMermaidSource(source);

    expect(result.edges[0]).toMatchObject({
      dashed: true,
    });
  });

  it('parses subgraphs', () => {
    const source = `flowchart TD
      subgraph backend [Backend]
        A[Service A]
        B[Service B]
      end`;

    const result = parseMermaidSource(source);

    expect(result.subgraphs).toHaveLength(1);
    expect(result.subgraphs[0]).toMatchObject({
      id: 'backend',
      label: 'Backend',
    });
  });

  it('detects flow direction', () => {
    const sourceLR = `flowchart LR
      A[A] --> B[B]`;

    const sourceUD = `flowchart TD
      A[A] --> B[B]`;

    expect(parseMermaidSource(sourceLR).direction).toBe('LR');
    expect(parseMermaidSource(sourceUD).direction).toBe('TD');
  });
});
