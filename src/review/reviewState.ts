import { sha256Hex } from '../utils/hashing';
import { FileReviewRecord, ReviewStatus } from './reviewTypes';

export const REVIEW_STATUSES: readonly ReviewStatus[] = [
  'NotReviewed',
  'InProgress',
  'Reviewed',
  'NeedsReReview',
];

export const STATUS_LABELS: Record<ReviewStatus, string> = {
  NotReviewed: 'Не просмотрен',
  InProgress: 'В процессе',
  Reviewed: 'Проверен',
  NeedsReReview: 'Требует повторной проверки',
};

export const STATUS_GROUP_ORDER: readonly ReviewStatus[] = [
  'NeedsReReview',
  'InProgress',
  'NotReviewed',
  'Reviewed',
];

export function isReviewStatus(value: unknown): value is ReviewStatus {
  return REVIEW_STATUSES.includes(value as ReviewStatus);
}

export interface StatusChangeContext {
  comparisonCommit: string | null;
  currentFingerprint: string | null;
  now: string;
}

export function applyStatusChange(
  record: FileReviewRecord,
  status: ReviewStatus,
  context: StatusChangeContext,
): FileReviewRecord {
  const next: FileReviewRecord = { ...record, status, updatedAt: context.now, notes: [...record.notes] };
  if (status === 'Reviewed') {
    next.reviewedAt = context.now;
  }
  if ((status === 'Reviewed' || status === 'InProgress') && context.currentFingerprint !== null) {
    next.lastReviewedFingerprint = context.currentFingerprint;
    next.lastReviewedComparisonCommit = context.comparisonCommit;
  }
  return next;
}

export function computeReviewId(
  repositoryRoot: string,
  baseRef: string,
  comparisonRef: string,
): string {
  const source = JSON.stringify([repositoryRoot, baseRef, comparisonRef]);
  return `review-${sha256Hex(source).slice(0, 24)}`;
}
