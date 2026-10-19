export type AnchorSide = 'old' | 'new';

export type AnchorResolution = 'resolved' | 'ambiguous' | 'missing';

export interface LineAnchor {
  side: AnchorSide;
  line: number;
  lineText: string;
  contextBefore: string[];
  contextAfter: string[];
  contextHash: string;
  resolution: AnchorResolution;
  resolvedLine: number | null;
}

export interface ReviewNote {
  id: string;
  text: string;
  createdAt: string;
  updatedAt: string;
  anchor: LineAnchor | null;
}
