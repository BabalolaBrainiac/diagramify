import { describe, it, expect } from 'vitest';
import { parseMermaidSource } from '../core/parse.js';

describe('parseMermaidSource', () => {
  it('retains bare nodes and every connection in a chain', () => {
    const result = parseMermaidSource('flowchart LR\n A --> B --> C');
    expect(result.nodes.map(node => node.id)).toEqual(['A', 'B', 'C']);
    expect(result.edges.map(edge => [edge.from, edge.to])).toEqual([['A', 'B'], ['B', 'C']]);
  });

  it('retains compact group labels and arrows in both directions', () => {
    const result = parseMermaidSource('flowchart LR\n subgraph backend[Backend]\n A[App] <--> B[(Store)]\n end');
    expect(result.subgraphs[0]).toEqual({ id: 'backend', label: 'Backend', nodeIds: ['A', 'B'] });
    expect(result.edges[0].bidirectional).toBe(true);
  });

  it('rejects invalid source before a live update can remove the graph', () => {
    expect(() => parseMermaidSource('invalid source')).toThrow();
  });

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

  // beautiful-mermaid registers a node on first sight; if an edge references an
  // ID before that node's own shape+label declaration, the placeholder label it
  // assigns (the ID itself) used to stick even after the real declaration. See
  // recoverDeclarationOrderLabels() in src/core/parse.ts.
  describe('label recovery when a node is referenced before it is declared', () => {
    it('recovers a label declared entirely after the edges that reference it', () => {
      const source = `flowchart LR
        N0 --> N1
        N1 --> N2
        N0[Auth Service]
        N1[Payment Service]
        N2[Order Service]`;

      const result = parseMermaidSource(source);

      expect(result.nodes.map(node => node.label)).toEqual(['Auth Service', 'Payment Service', 'Order Service']);
    });

    it('recovers labels declared inline on the same line as an edge', () => {
      const source = `flowchart LR
        N0[Auth Service] --> N1[Payment Service]
        N1 --> N2[Order Service]`;

      const result = parseMermaidSource(source);

      expect(result.nodes.map(node => node.label)).toEqual(['Auth Service', 'Payment Service', 'Order Service']);
    });

    it('keeps an ID as the label when no declaration exists anywhere in the source', () => {
      const source = `flowchart LR
        Z --> W
        W[Worker]`;

      const result = parseMermaidSource(source);

      expect(result.nodes.map(node => node.label)).toEqual(['Z', 'Worker']);
    });

    it('leaves an intentional label that matches its own ID untouched', () => {
      const source = 'flowchart LR\n X[X] --> Y[Y]';

      const result = parseMermaidSource(source);

      expect(result.nodes.map(node => node.label)).toEqual(['X', 'Y']);
    });

  });
});
