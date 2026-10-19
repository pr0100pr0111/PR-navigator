import { ReviewNote } from '../notes/noteTypes';

export type ReviewStatus = 'NotReviewed' | 'InProgress' | 'Reviewed' | 'NeedsReReview';

export type ChangeKind = 'added' | 'modified' | 'deleted' | 'renamed' | 'copied';

export interface FileReviewRecord {
  path: string;
  previousPath: string | null;
  status: ReviewStatus;
  changeKind: ChangeKind;
  lastReviewedFingerprint: string | null;
  lastReviewedComparisonCommit: string | null;
  reviewedAt: string | null;
  createdAt: string;
  updatedAt: string;
  notes: ReviewNote[];
}

export interface ReviewRepository {
  root: string;
  name: string;
}

export interface ReviewSession {
  schemaVersion: number;
  id: string;
  repository: ReviewRepository;
  baseRef: string;
  comparisonRef: string;
  baseCommit: string | null;
  comparisonCommit: string | null;
  createdAt: string;
  updatedAt: string;
  files: FileReviewRecord[];
  historical: FileReviewRecord[];
}

export const REVIEW_SCHEMA_VERSION = 1;
