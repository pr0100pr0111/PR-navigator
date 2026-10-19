import { DiffEntry, ComparisonSnapshot } from '../git/gitTypes';
import { FileReviewRecord } from './reviewTypes';

export interface DetectChangesInput {
  previousFiles: readonly FileReviewRecord[];
  previousHistorical: readonly FileReviewRecord[];
  snapshot: ComparisonSnapshot;
  now: string;
}

export interface DetectionResult {
  files: FileReviewRecord[];
  historical: FileReviewRecord[];
  addedPaths: string[];
  stalePaths: string[];
  archivedPaths: string[];
  restoredPaths: string[];
}

export function activeFingerprintOf(entry: DiffEntry): string | null {
  return entry.newFingerprint ?? entry.oldFingerprint;
}

function entryRecordPath(entry: DiffEntry): string {
  if (entry.newPath !== null) {
    return entry.newPath;
  }
  if (entry.oldPath !== null) {
    return entry.oldPath;
  }
  throw new Error('Запись diff не содержит ни одного пути.');
}

function findSourceRecord(
  entry: DiffEntry,
  active: Map<string, FileReviewRecord>,
  historical: Map<string, FileReviewRecord>,
): { record: FileReviewRecord; fromHistorical: boolean; renamed: boolean } | null {
  if (entry.newPath !== null) {
    const activeMatch = active.get(entry.newPath);
    if (activeMatch !== undefined) {
      return { record: activeMatch, fromHistorical: false, renamed: false };
    }
    const historicalMatch = historical.get(entry.newPath);
    if (historicalMatch !== undefined) {
      return { record: historicalMatch, fromHistorical: true, renamed: false };
    }
  }
  if (entry.oldPath !== null && (entry.status === 'renamed' || entry.status === 'deleted')) {
    const activeMatch = active.get(entry.oldPath);
    if (activeMatch !== undefined) {
      return {
        record: activeMatch,
        fromHistorical: false,
        renamed: entry.status === 'renamed',
      };
    }
    const historicalMatch = historical.get(entry.oldPath);
    if (historicalMatch !== undefined) {
      return {
        record: historicalMatch,
        fromHistorical: true,
        renamed: entry.status === 'renamed',
      };
    }
  }
  return null;
}

function resolveStatusOnRefresh(
  record: FileReviewRecord,
  currentFingerprint: string | null,
): FileReviewRecord['status'] {
  if (record.status !== 'Reviewed' && record.status !== 'InProgress') {
    return record.status;
  }
  if (record.lastReviewedFingerprint === null || currentFingerprint === null) {
    return record.status;
  }
  if (record.lastReviewedFingerprint !== currentFingerprint) {
    return 'NeedsReReview';
  }
  return record.status;
}

export function detectChanges(input: DetectChangesInput): DetectionResult {
  const { previousFiles, previousHistorical, snapshot, now } = input;

  const active = new Map<string, FileReviewRecord>();
  for (const record of previousFiles) {
    active.set(record.path, record);
  }
  const historical = new Map<string, FileReviewRecord>();
  for (const record of previousHistorical) {
    historical.set(record.path, record);
  }

  const files: FileReviewRecord[] = [];
  const addedPaths: string[] = [];
  const stalePaths: string[] = [];
  const archivedPaths: string[] = [];
  const restoredPaths: string[] = [];

  for (const entry of snapshot.entries) {
    const recordPath = entryRecordPath(entry);
    const currentFingerprint = activeFingerprintOf(entry);
    const source = findSourceRecord(entry, active, historical);

    if (source === null) {
      files.push({
        path: recordPath,
        previousPath: null,
        status: 'NotReviewed',
        changeKind: entry.status,
        lastReviewedFingerprint: null,
        lastReviewedComparisonCommit: null,
        reviewedAt: null,
        createdAt: now,
        updatedAt: now,
        notes: [],
      });
      addedPaths.push(recordPath);
      continue;
    }

    active.delete(source.record.path);
    historical.delete(source.record.path);

    const nextStatus = resolveStatusOnRefresh(source.record, currentFingerprint);
    const becameStale = nextStatus === 'NeedsReReview' && source.record.status !== 'NeedsReReview';
    if (becameStale) {
      stalePaths.push(recordPath);
    }
    if (source.fromHistorical) {
      restoredPaths.push(recordPath);
    }

    const nextPath = source.renamed ? recordPath : source.record.path;
    const updated: FileReviewRecord = {
      ...source.record,
      path: nextPath,
      previousPath: source.renamed
        ? source.record.path
        : source.record.previousPath,
      changeKind: entry.status,
      status: nextStatus,
      updatedAt: nextStatus !== source.record.status ? now : source.record.updatedAt,
      notes: [...source.record.notes],
    };
    files.push(updated);
  }

  const historicalRecords: FileReviewRecord[] = [];
  for (const record of active.values()) {
    historicalRecords.push({ ...record, notes: [...record.notes] });
    archivedPaths.push(record.path);
  }
  for (const record of historical.values()) {
    historicalRecords.push({ ...record, notes: [...record.notes] });
  }

  return {
    files,
    historical: historicalRecords,
    addedPaths,
    stalePaths,
    archivedPaths,
    restoredPaths,
  };
}
