import type { ServiceType } from '../icons/services.js';

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
