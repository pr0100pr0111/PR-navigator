import { ChangeKind } from '../review/reviewTypes';

export interface DiffEntry {
  status: ChangeKind;
  oldPath: string | null;
  newPath: string | null;
  oldFingerprint: string | null;
  newFingerprint: string | null;
}

export interface ComparisonSnapshot {
  baseCommit: string;
  comparisonCommit: string;
  entries: DiffEntry[];
}

export interface GitRefInfo {
  name: string;
  full: string;
  commit: string;
  current: boolean;
}

export interface GitFileContent {
  present: boolean;
  content: Buffer;
}
